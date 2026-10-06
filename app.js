"use strict";

const DATA_URL = "data/jokers.json";
const STORAGE_KEY = "balatro-tier-list:v1";
const TIERS = [
  { id: "S", label: "S", className: "tier-s" },
  { id: "A", label: "A", className: "tier-a" },
  { id: "B", label: "B", className: "tier-b" },
  { id: "C", label: "C", className: "tier-c" },
  { id: "D", label: "D", className: "tier-d" },
  { id: "F", label: "F", className: "tier-f" },
];
const RARITY_ORDER = ["일반", "희귀", "레어", "전설"];
const RARITY_CLASS = {
  일반: "rarity-common",
  희귀: "rarity-uncommon",
  레어: "rarity-rare",
  전설: "rarity-legendary",
};

const state = {
  cards: [],
  cardsById: new Map(),
  lists: {},
  filters: {
    query: "",
    rarity: "all",
    trait: "all",
    sort: "index",
  },
  selectedId: null,
  selectedList: "pool",
  tierNotes: {},
  draggedId: null,
  dragPreview: null,
  showUsage: false,
  usageById: new Map(),
};

let dropIndicator = null;

const els = {
  sourceMeta: document.querySelector("#sourceMeta"),
  searchInput: document.querySelector("#searchInput"),
  traitFilter: document.querySelector("#traitFilter"),
  sortMode: document.querySelector("#sortMode"),
  rarityFilters: document.querySelector("#rarityFilters"),
  tierBoard: document.querySelector("#tierBoard"),
  poolGrid: document.querySelector("#poolGrid"),
  selectedPanel: document.querySelector("#selectedPanel"),
  exportButton: document.querySelector("#exportButton"),
  importButton: document.querySelector("#importButton"),
  resetButton: document.querySelector("#resetButton"),
  importFile: document.querySelector("#importFile"),
  cardTemplate: document.querySelector("#cardTemplate"),
  compareButton: document.querySelector("#compareButton"),
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  createTierRows();
  bindControls();

  try {
    const payload = await loadMetadata();
    state.cards = payload.cards || [];
    state.cardsById = new Map(state.cards.map((card) => [card.id, card]));
    setupUsageComparison();
    setupFilters();
    hydrateLists();
    render();
    updateSourceMeta(payload);
  } catch (error) {
    els.sourceMeta.textContent = "메타데이터를 불러오지 못했습니다.";
    els.selectedPanel.textContent = `데이터 로드 실패: ${error.message}`;
    showToast(`데이터 로드 실패: ${error.message}`);
  }
}

async function loadMetadata() {
  // Local files cannot fetch JSON; classic scripts work without a web server.
  if (window.location.protocol === "file:") {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "data/jokers.js";
      script.onload = () => {
        const payload = window.BALATRO_JOKERS;
        if (Array.isArray(payload?.cards) && payload.cards.length) {
          resolve(payload);
        } else {
          reject(new Error("data/jokers.js의 조커 데이터가 올바르지 않습니다."));
        }
        script.remove();
      };
      script.onerror = () => {
        script.remove();
        reject(new Error("data/jokers.js 파일을 찾을 수 없습니다. 앱 폴더 전체가 필요합니다."));
      };
      document.head.append(script);
    });
  }

  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function createTierRows() {
  const fragment = document.createDocumentFragment();

  for (const tier of TIERS) {
    const row = document.createElement("section");
    row.className = "tier-row";
    row.dataset.tierRow = tier.id;

    const label = document.createElement("div");
    label.className = `tier-label ${tier.className}`;
    label.innerHTML = `
      <strong>${tier.label}</strong>
      <input
        data-tier-note="${tier.id}"
        type="text"
        maxlength="18"
        placeholder="코멘트"
        aria-label="${tier.label} 티어 코멘트"
      />
      <span data-count-for="${tier.id}">0장</span>
    `;

    const cards = document.createElement("div");
    cards.className = "tier-cards drop-zone";
    cards.dataset.tier = tier.id;
    cards.setAttribute("aria-label", `${tier.label} 티어`);

    row.append(label, cards);
    fragment.append(row);
  }

  els.tierBoard.append(fragment);
}

function bindControls() {
  els.compareButton.addEventListener("click", () => {
    state.showUsage = !state.showUsage;
    els.compareButton.setAttribute("aria-pressed", String(state.showUsage));
    render();
  });
  els.searchInput.addEventListener("input", () => {
    state.filters.query = normalizeSearch(els.searchInput.value);
    state.selectedId = firstIdInList(state.selectedList);
    render();
  });

  els.traitFilter.addEventListener("change", () => {
    state.filters.trait = els.traitFilter.value;
    state.selectedId = firstIdInList(state.selectedList);
    render();
  });

  els.sortMode.addEventListener("change", () => {
    state.filters.sort = els.sortMode.value;
    persist();
    render();
  });

  els.rarityFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-rarity]");
    if (!button) return;

    state.filters.rarity = button.dataset.rarity;
    state.selectedId = firstIdInList(state.selectedList);
    for (const chip of els.rarityFilters.querySelectorAll(".filter-chip")) {
      chip.classList.toggle("active", chip === button);
    }
    render();
  });

  els.tierBoard.addEventListener("input", (event) => {
    const input = event.target.closest("[data-tier-note]");
    if (!input) return;

    state.tierNotes[input.dataset.tierNote] = input.value;
    persist();
  });

  document.addEventListener("dragstart", handleDragStart);
  document.addEventListener("dragend", handleDragEnd);
  document.addEventListener("scroll", refreshDropIndicator, true);
  window.addEventListener("resize", clearDropIndicator);

  for (const zone of document.querySelectorAll(".drop-zone")) {
    zone.addEventListener("dragover", handleDragOver);
    zone.addEventListener("dragleave", handleDragLeave);
    zone.addEventListener("drop", handleDrop);
    zone.addEventListener("click", handleZoneClick);
  }

  els.exportButton.addEventListener("click", exportTierList);
  els.importButton.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", importTierList);
  els.resetButton.addEventListener("click", resetTierList);
}

function setupFilters() {
  const rarities = [...new Set(state.cards.map((card) => card.rarity).filter(Boolean))];
  for (const rarity of rarities.sort((a, b) => rarityRank(a) - rarityRank(b))) {
    const chip = document.createElement("button");
    chip.className = "filter-chip";
    chip.type = "button";
    chip.dataset.rarity = rarity;
    chip.textContent = rarity;
    els.rarityFilters.append(chip);
  }

  const traits = [
    ...new Set(state.cards.flatMap((card) => card.traits || []).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "ko"));

  for (const trait of traits) {
    const option = document.createElement("option");
    option.value = trait;
    option.textContent = trait;
    els.traitFilter.append(option);
  }
}

function hydrateLists() {
  const saved = readSavedState();
  if (["manual", "index", "name", "rarity", "cost"].includes(saved?.poolSort)) {
    state.filters.sort = saved.poolSort;
    els.sortMode.value = saved.poolSort;
  }
  state.tierNotes = normalizeTierNotes(saved?.tierNotes);
  if (!saved) {
    const defaults = window.BALATRO_DEFAULT_TIER_LIST;
    if (!defaults?.tiers) {
      throw new Error("기본 티어 데이터가 없습니다. data/default-tier-list.js 파일을 확인해 주세요.");
    }
    state.lists = normalizeImportedLists(defaults.tiers);
    state.tierNotes = normalizeTierNotes(defaults.tier_notes);
    if (["manual", "index", "name", "rarity", "cost"].includes(defaults.pool_sort)) {
      state.filters.sort = defaults.pool_sort;
      els.sortMode.value = defaults.pool_sort;
    }
    persist();
    return;
  }

  const savedLists = saved?.lists && typeof saved.lists === "object" ? saved.lists : saved;
  const knownIds = new Set(state.cards.map((card) => card.id));
  const assigned = new Set();
  const lists = Object.fromEntries([...TIERS.map((tier) => tier.id), "pool"].map((key) => [key, []]));

  for (const key of Object.keys(lists)) {
    const ids = Array.isArray(savedLists[key]) ? savedLists[key] : [];
    for (const id of ids) {
      if (knownIds.has(id) && !assigned.has(id)) {
        lists[key].push(id);
        assigned.add(id);
      }
    }
  }

  for (const id of knownIds) {
    if (!assigned.has(id)) {
      lists.pool.push(id);
    }
  }

  state.lists = lists;
}

function readSavedState() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function normalizeTierNotes(raw = {}) {
  return Object.fromEntries(
    TIERS.map((tier) => [tier.id, normalizeSpace(raw?.[tier.id] || "").slice(0, 18)])
  );
}

function render() {
  const activeDetailId = getActiveDetailId();

  for (const tier of TIERS) {
    const zone = document.querySelector(`[data-tier="${tier.id}"]`);
    const row = document.querySelector(`[data-tier-row="${tier.id}"]`);
    row.classList.toggle("active-list", state.selectedList === tier.id);
    renderList(zone, state.lists[tier.id] || [], activeDetailId);
    const count = document.querySelector(`[data-count-for="${tier.id}"]`);
    count.textContent = `${(state.lists[tier.id] || []).length}장`;
    const note = document.querySelector(`[data-tier-note="${tier.id}"]`);
    if (note && document.activeElement !== note) {
      note.value = state.tierNotes[tier.id] || "";
    }
  }

  els.poolGrid.closest(".pool-panel").classList.toggle("active-list", state.selectedList === "pool");
  renderList(els.poolGrid, sortedPoolIds(), activeDetailId);
  renderSelected(activeDetailId);
}

function renderList(container, ids, activeDetailId) {
  container.replaceChildren();

  const fragment = document.createDocumentFragment();
  let visibleCount = 0;

  for (const id of ids) {
    const card = state.cardsById.get(id);
    if (!card) continue;

    const node = createCardNode(card, activeDetailId);
    const visible = matchesFilters(card);
    node.classList.toggle("is-hidden", !visible);
    if (visible) visibleCount += 1;
    fragment.append(node);
  }

  container.append(fragment);

  if (visibleCount === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-zone";
    empty.textContent = "표시할 조커가 없습니다";
    container.append(empty);
  }
}

function createCardNode(card, activeDetailId) {
  const node = els.cardTemplate.content.firstElementChild.cloneNode(true);
  const image = node.querySelector("img");
  const name = node.querySelector(".card-name");

  node.dataset.cardId = card.id;
  node.title = `${card.name_ko}${card.name_en ? ` (${card.name_en})` : ""}`;
  node.classList.toggle("selected", card.id === activeDetailId);
  image.src = card.image_path;
  image.draggable = false;
  image.alt = card.name_ko;
  image.addEventListener("error", () => {
    image.style.visibility = "hidden";
  });
  name.textContent = card.name_ko;
  if (state.showUsage) {
    const overlay = document.createElement("span");
    overlay.className = "usage-overlay";
    overlay.textContent = usageCountText(card.id);
    overlay.setAttribute("aria-label", usageCountLabel(card.id));
    node.querySelector(".card-frame").append(overlay);
  }

  node.addEventListener("click", (event) => {
    event.stopPropagation();
    state.selectedId = card.id;
    state.selectedList = findCardList(card.id);
    render();
  });

  return node;
}

function setupUsageComparison() {
  const records = window.BALATRO_JOKER_USAGE?.cards || {};
  state.usageById = new Map(Object.entries(records).filter(([id, record]) =>
    state.cardsById.has(id) && Number.isInteger(record?.count) && record.count >= 0
  ));
  els.compareButton.disabled = state.usageById.size === 0;
  if (els.compareButton.disabled) els.compareButton.title = "대조할 사용 기록이 없습니다";
}

function usageCountText(id) {
  const usage = state.usageById.get(id);
  return usage ? usage.count.toLocaleString("ko-KR") : "-";
}

function usageCountLabel(id) {
  return state.usageById.has(id) ? `사용 ${usageCountText(id)}회` : "사용 기록 없음";
}

function sortedPoolIds() {
  const ids = [...(state.lists.pool || [])];
  if (state.filters.sort === "manual") return ids;
  return ids.sort((a, b) => compareCards(state.cardsById.get(a), state.cardsById.get(b)));
}

function compareCards(a, b) {
  if (!a || !b) return 0;

  if (state.filters.sort === "name") {
    return a.name_ko.localeCompare(b.name_ko, "ko") || a.index - b.index;
  }

  if (state.filters.sort === "rarity") {
    return rarityRank(a.rarity) - rarityRank(b.rarity) || a.index - b.index;
  }

  if (state.filters.sort === "cost") {
    return costValue(a.cost) - costValue(b.cost) || a.index - b.index;
  }

  return a.index - b.index;
}

function getActiveDetailId() {
  if (state.selectedId && state.cardsById.has(state.selectedId)) {
    return state.selectedId;
  }

  return firstIdInList(state.selectedList);
}

function firstIdInList(listKey) {
  const ids = listKey === "pool" ? sortedPoolIds() : state.lists[listKey] || [];
  return ids.find((id) => {
    const card = state.cardsById.get(id);
    return card && matchesFilters(card);
  }) || null;
}

function nextPoolIdAfterClassifying(id, poolOrderBefore) {
  const remaining = poolOrderBefore.filter((cardId) => cardId !== id && state.cardsById.has(cardId));
  if (!remaining.length) {
    return null;
  }

  const previousIndex = poolOrderBefore.indexOf(id);
  if (previousIndex === -1) {
    return remaining[0];
  }

  return remaining[previousIndex] || remaining[previousIndex - 1] || remaining[0];
}

function findCardList(id) {
  for (const key of Object.keys(state.lists)) {
    if ((state.lists[key] || []).includes(id)) {
      return key;
    }
  }

  return "pool";
}

function matchesFilters(card) {
  const query = state.filters.query;
  const rarityMatch = state.filters.rarity === "all" || card.rarity === state.filters.rarity;
  const traitMatch =
    state.filters.trait === "all" || (card.traits || []).includes(state.filters.trait);

  if (!query) {
    return rarityMatch && traitMatch;
  }

  const haystack = normalizeSearch(
    [
      card.name,
      card.name_ko,
      card.name_en,
      card.effect,
      card.unlock,
      card.rarity,
      card.cost,
      ...(card.traits || []),
    ]
      .filter(Boolean)
      .join(" ")
  );

  return rarityMatch && traitMatch && haystack.includes(query);
}

function renderSelected(activeDetailId) {
  const card = state.cardsById.get(activeDetailId);
  if (!card) {
    els.selectedPanel.innerHTML = `
      <div class="empty-detail">
        <strong>조커 상세 정보</strong>
        <span>선택 없음</span>
      </div>
    `;
    return;
  }

  const traits = (card.traits || []).length ? card.traits : ["특성 없음"];
  const variants =
    (card.name_ko_variants || []).length > 1
      ? `<p>${escapeHtml(card.name_ko_variants.join(" / "))}</p>`
      : "";

  els.selectedPanel.innerHTML = `
    <article class="detail-card">
      <div class="detail-art">
        <img src="${escapeAttribute(card.image_path)}" alt="${escapeAttribute(card.name_ko)}" />
        ${state.showUsage ? `<span class="usage-overlay" aria-label="${usageCountLabel(card.id)}">${usageCountText(card.id)}</span>` : ""}
      </div>
      <div class="detail-title">
        <h2>${escapeHtml(card.name_ko)}</h2>
        <p>${escapeHtml(card.name_en || "영문명 없음")}</p>
        ${variants}
        <div class="badges">
          <span class="badge ${RARITY_CLASS[card.rarity] || ""}">${escapeHtml(card.rarity || "희귀도 없음")}</span>
          <span class="badge">${escapeHtml(card.cost || "가격 없음")}</span>
          ${traits.map((trait) => `<span class="badge">${escapeHtml(trait)}</span>`).join("")}
        </div>
      </div>
      <p class="detail-text"><strong>효과</strong><br />${escapeHtml(card.effect || "효과 정보 없음")}</p>
      ${
        card.unlock
          ? `<p class="detail-text"><strong>해금</strong><br />${escapeHtml(card.unlock)}</p>`
          : ""
      }
      <div class="quick-move">
        ${TIERS.map((tier) => `<button type="button" data-move-to="${tier.id}">${tier.label}</button>`).join("")}
        <button type="button" data-move-to="pool">미분류</button>
      </div>
    </article>
  `;

  for (const button of els.selectedPanel.querySelectorAll("[data-move-to]")) {
    button.addEventListener("click", () => {
      moveCard(card.id, button.dataset.moveTo);
    });
  }
}

function handleDragStart(event) {
  const card = event.target.closest("[data-card-id]");
  if (!card) return;

  clearDropIndicator();
  state.draggedId = card.dataset.cardId;
  state.selectedId = state.draggedId;
  state.selectedList = findCardList(state.draggedId);
  card.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", state.draggedId);
}

function handleDragEnd(event) {
  const card = event.target.closest("[data-card-id]");
  if (card) card.classList.remove("dragging");

  for (const zone of document.querySelectorAll(".drop-zone")) {
    zone.classList.remove("drag-over");
  }
  state.draggedId = null;
  clearDropIndicator();
}

function handleDragOver(event) {
  if (!state.draggedId) return;
  const zone = event.currentTarget;
  event.preventDefault();
  zone.classList.add("drag-over");
  event.dataTransfer.dropEffect = "move";
  state.dragPreview = { zone, x: event.clientX, y: event.clientY };
  refreshDropIndicator();
}

function handleDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    event.currentTarget.classList.remove("drag-over");
    if (state.dragPreview?.zone === event.currentTarget) clearDropIndicator();
  }
}

function handleDrop(event) {
  if (!state.draggedId) return;
  const zone = event.currentTarget;
  event.preventDefault();
  zone.classList.remove("drag-over");

  const id = state.draggedId;
  if (!id || !state.cardsById.has(id)) return;

  const targetTier = zone.dataset.tier;
  const { index } = getDropPlacement(zone, event.clientX, event.clientY, id);
  if (targetTier === "pool") {
    // Preserve the displayed order before switching from automatic sorting.
    state.lists.pool = sortedPoolIds();
    state.filters.sort = "manual";
    els.sortMode.value = "manual";
  }
  clearDropIndicator();
  state.draggedId = null;
  moveCard(id, targetTier, index);
}

function handleZoneClick(event) {
  const zone = event.currentTarget;
  if (event.target.closest("[data-card-id]")) return;
  state.selectedList = zone.dataset.tier;
  if (!state.selectedId) return;

  moveCard(state.selectedId, zone.dataset.tier);
}

function getDropPlacement(container, x, y, draggedId) {
  const cards = [...container.querySelectorAll("[data-card-id]:not(.is-hidden)")].filter(
    (node) => node.dataset.cardId !== draggedId
  );
  const ids = (container.dataset.tier === "pool"
    ? sortedPoolIds()
    : state.lists[container.dataset.tier] || []).filter((id) => id !== draggedId);
  const bounds = container.getBoundingClientRect();
  if (!cards.length) {
    return { index: ids.length, x: bounds.left + 8, y: bounds.top + 8, height: 80 };
  }

  // Resolve the wrapped row first; vertical position within a card must not
  // override the pointer's horizontal position in that row.
  const rows = [];
  for (const node of cards) {
    const rect = node.getBoundingClientRect();
    let row = rows[rows.length - 1];
    if (!row || rect.top >= row.bottom - 1) {
      row = { top: rect.top, bottom: rect.bottom, cards: [] };
      rows.push(row);
    }
    row.bottom = Math.max(row.bottom, rect.bottom);
    row.cards.push({ id: node.dataset.cardId, rect });
  }
  let row = rows[rows.length - 1];
  for (let i = 0; i < rows.length - 1; i += 1) {
    if (y < (rows[i].bottom + rows[i + 1].top) / 2) {
      row = rows[i];
      break;
    }
  }
  let next = row.cards.find(({ rect }) => x < rect.left + rect.width / 2);
  if (y < rows[0].top) next = rows[0].cards[0];
  if (y > rows[rows.length - 1].bottom) next = null;
  const anchor = next || row.cards[row.cards.length - 1];
  return {
    index: ids.indexOf(anchor.id) + (next ? 0 : 1),
    x: next ? anchor.rect.left - 4 : anchor.rect.right + 4,
    y: anchor.rect.top,
    height: anchor.rect.height,
  };
}

function clearDropIndicator() {
  if (state.dragPreview) state.dragPreview.zone.classList.remove("drag-over");
  state.dragPreview = null;
  if (dropIndicator) dropIndicator.hidden = true;
}

function refreshDropIndicator() {
  if (!state.draggedId || !state.dragPreview) return;
  const { zone, x, y } = state.dragPreview;
  const bounds = zone.getBoundingClientRect();
  if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) {
    clearDropIndicator();
    return;
  }
  const placement = getDropPlacement(zone, x, y, state.draggedId);
  if (!dropIndicator) {
    dropIndicator = document.createElement("div");
    dropIndicator.className = "drop-indicator";
    dropIndicator.setAttribute("aria-hidden", "true");
    dropIndicator.append(document.createElement("span"));
    document.body.append(dropIndicator);
  }
  dropIndicator.hidden = false;
  dropIndicator.style.left = `${Math.max(4, Math.min(window.innerWidth - 4, placement.x))}px`;
  const top = Math.max(0, bounds.top, placement.y);
  const bottom = Math.min(window.innerHeight, bounds.bottom, placement.y + placement.height);
  dropIndicator.style.top = `${top}px`;
  dropIndicator.style.height = `${Math.max(0, bottom - top)}px`;
  dropIndicator.classList.toggle("label-left", placement.x > window.innerWidth - 70);
  dropIndicator.firstElementChild.textContent = `${placement.index + 1}번`;
}

function moveCard(id, targetList, index = null) {
  const sourceList = findCardList(id);
  const poolOrderBefore = sourceList === "pool" ? sortedPoolIds() : [];

  for (const key of Object.keys(state.lists)) {
    state.lists[key] = state.lists[key].filter((cardId) => cardId !== id);
  }

  const resolvedList = state.lists[targetList] ? targetList : "pool";
  const list = state.lists[resolvedList];
  if (Number.isInteger(index)) {
    list.splice(Math.max(0, Math.min(index, list.length)), 0, id);
  } else {
    list.push(id);
  }

  if (sourceList === "pool" && resolvedList !== "pool") {
    state.selectedId = nextPoolIdAfterClassifying(id, poolOrderBefore);
    state.selectedList = "pool";
  } else {
    state.selectedId = id;
    state.selectedList = resolvedList;
  }

  persist();
  render();
}

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        lists: state.lists,
        tierNotes: state.tierNotes,
        poolSort: state.filters.sort,
      })
    );
  } catch (error) {
    console.warn("Tier list could not be saved", error);
    showToast("자동 저장을 사용할 수 없습니다. 내보내기로 티어 리스트를 보관해 주세요.");
  }
}

function exportTierList() {
  const payload = {
    exported_at: new Date().toISOString(),
    tier_notes: state.tierNotes,
    pool_sort: state.filters.sort,
    tiers: Object.fromEntries(
      Object.entries(state.lists).map(([key, ids]) => [
        key,
        ids.map((id) => {
          const card = state.cardsById.get(id);
          return {
            id,
            name_ko: card?.name_ko,
            name_en: card?.name_en,
            rarity: card?.rarity,
          };
        }),
      ])
    ),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `balatro-tier-list-${dateStamp()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("티어 리스트를 내보냈습니다.");
}

async function importTierList() {
  const file = els.importFile.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const imported = normalizeImportedLists(payload.tiers || payload);
    state.lists = imported;
    state.tierNotes = normalizeTierNotes(payload.tier_notes || payload.tierNotes);
    if (["manual", "index", "name", "rarity", "cost"].includes(payload.pool_sort)) {
      state.filters.sort = payload.pool_sort;
      els.sortMode.value = payload.pool_sort;
    }
    state.selectedId = null;
    state.selectedList = "pool";
    persist();
    render();
    showToast("티어 리스트를 가져왔습니다.");
  } catch (error) {
    showToast(`가져오기 실패: ${error.message}`);
  } finally {
    els.importFile.value = "";
  }
}

function normalizeImportedLists(raw) {
  const knownIds = new Set(state.cards.map((card) => card.id));
  const assigned = new Set();
  const lists = Object.fromEntries([...TIERS.map((tier) => tier.id), "pool"].map((key) => [key, []]));

  for (const key of Object.keys(lists)) {
    const values = Array.isArray(raw?.[key]) ? raw[key] : [];
    for (const item of values) {
      const id = typeof item === "string" ? item : item?.id;
      if (knownIds.has(id) && !assigned.has(id)) {
        lists[key].push(id);
        assigned.add(id);
      }
    }
  }

  for (const id of knownIds) {
    if (!assigned.has(id)) {
      lists.pool.push(id);
    }
  }

  return lists;
}

function resetTierList() {
  const confirmed = window.confirm("모든 티어 배치를 초기화할까요?");
  if (!confirmed) return;

  state.lists = Object.fromEntries(TIERS.map((tier) => [tier.id, []]));
  state.lists.pool = state.cards.map((card) => card.id);
  state.tierNotes = normalizeTierNotes();
  state.selectedId = null;
  state.selectedList = "pool";
  persist();
  render();
  showToast("초기화했습니다.");
}

function updateSourceMeta(payload) {
  const count = payload.count || state.cards.length;
  const sourceName = payload.source?.name || "메타데이터";
  els.sourceMeta.textContent = `${sourceName} · ${count}장`;
}

function normalizeSearch(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ko");
}

function normalizeSpace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function rarityRank(value) {
  const index = RARITY_ORDER.indexOf(value);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function costValue(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function dateStamp() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 2600);
}
