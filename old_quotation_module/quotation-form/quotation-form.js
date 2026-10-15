const PAPER_IMAGES = {
  "Art Card 190": "/images/paper-art-bag.jpg",
  "Brown Kraft 100": "/images/paper-kraft-bag.jpg",
  "Brown Kraft 120": "/images/paper-kraft-bag.jpg",
  "Brown Kraft 140": "/images/paper-kraft-bag.jpg",
  "Brown Kraft 170": "/images/paper-kraft-bag.jpg",
  "White Kraft 100": "/images/paper-white-kraft-bag.jpg",
  "White Kraft 120": "/images/paper-white-kraft-bag.jpg",
  "White Kraft 150": "/images/paper-white-kraft-bag.jpg",
  "White Kraft 180": "/images/paper-white-kraft-bag.jpg",
  "Art Paper 157": "/images/paper-art-bag.jpg",
  "Art Card 210": "/images/paper-art-bag.jpg",
  "Art Card 230": "/images/paper-art-bag.jpg",
  "Sack Kraft 100": "/images/paper-sack-bag.jpg"
};

const QUOTATION_FORM_ACTION_SELECTOR = [
  "#quotation-save-draft",
  "#quotation-submit-sales",
].join(", ");

function setFormActionButtonsDisabled(disabled) {
  document.querySelectorAll(QUOTATION_FORM_ACTION_SELECTOR).forEach((button) => {
    button.disabled = disabled;
  });
}

async function withFormButtonLoading(button, loadingText, action) {
  if (!button || button.disabled) return;

  const originalContent = button.innerHTML;
  setFormActionButtonsDisabled(true);
  button.dataset.loading = "true";
  button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${loadingText}</span>`;

  try {
    return await action();
  } finally {
    setFormActionButtonsDisabled(false);
    button.dataset.loading = "false";
    button.innerHTML = originalContent;
  }
}

const COST_LABELS = {
  P1: "Paper Cost",
  P2: "Printing Cost",
  P3: "Plate Cost",
  P4: "Ink Cost",
  P5: "Varnish Cost",
  P6: "Lamination Cost",
  P7: "Spot UV Cost",
  P8: "Stamping Cost",
  P9: "Embossing Cost",
  P10: "Texture Embossing",
  P11: "Die Cut Cost",
  P12: "DC Moulding Cost",
  P13: "Handles",
  P14: "Reinforcement Board",
  P15: "Converting Labor (2026)",
  P16: "Packaging Cost",
  P17: "Logistics Cost",
  P18: "Mock Up Cost"
};

const DEFAULT_FORM = {
  width: 150,
  height: 300,
  gusset: 100,
  quantity: 1000,
  paperName: "Art Card 190",
  printingOption: "process 4c x 0c",
  inkType: "normal",
  marginIndex: 0.96,
  varnish: "None",
  lamination: "None",
  spotUV: false,
  stamping: false,
  embossing: false,
  textureEmbossing: false,
  dieCut: false,
  foilType: "gold",
  stampingHeight: 50,
  stampingWidth: 50,
  embossingHeight: 50,
  embossingWidth: 50,
  embossingType: "Standard Embossing",
  textureType: "standard",
  dcMoulding: "None",
  handles: false,
  handleType: "round_pp_tipping",
  reinforcementBoard: false,
  boardType: "eb_bb_350",
  convertingLabor: false,
  packaging: false,
  mockUp: false
};

const appState = {
  form: { ...DEFAULT_FORM },
  result: null,
  error: "",
  activeTab: "basic",
  zoomImage: null
};

let cfg = null;
let paperTypes = [];
let printingOptions = [];
let marginIndices = [];
let handleTypes = [];
let boardTypes = [];
const els = {};

async function loadQuotationConfig() {
  const response = await fetch("/api/quotation/config");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load quotation rates");

  cfg = data;
  paperTypes = cfg.paperTypes;
  printingOptions = cfg.printingOptions;
  marginIndices = cfg.marginIndices;
  handleTypes = cfg.handleTypes;
  boardTypes = cfg.boardTypes;
  Object.assign(COST_LABELS, cfg.costLabels);

  const useAvailableValue = (current, options, getValue) =>
    options.some((option) => String(getValue(option)) === String(current))
      ? current
      : getValue(options[0]) ?? "";
  appState.form.paperName = useAvailableValue(appState.form.paperName, paperTypes, (item) => item.name);
  appState.form.printingOption = useAvailableValue(appState.form.printingOption, printingOptions, (item) => item.name);
  appState.form.marginIndex = useAvailableValue(appState.form.marginIndex, marginIndices, (item) => item);
  appState.form.foilType = useAvailableValue(appState.form.foilType, cfg.foilTypes, (item) => item.value);
  appState.form.embossingType = useAvailableValue(appState.form.embossingType, cfg.embossingTypes, (item) => item);
  appState.form.textureType = useAvailableValue(appState.form.textureType, cfg.textureTypes, (item) => item.value);
  appState.form.inkType = useAvailableValue(appState.form.inkType, cfg.inkTypes, (item) => item.value);
  appState.form.varnish = useAvailableValue(appState.form.varnish, cfg.varnishTypes, (item) => item.value);
  appState.form.lamination = useAvailableValue(appState.form.lamination, cfg.laminationTypes, (item) => item.value);
  appState.form.handleType = useAvailableValue(appState.form.handleType, handleTypes, (item) => item.id);
  appState.form.boardType = useAvailableValue(appState.form.boardType, boardTypes, (item) => item.id);
}

document.addEventListener("DOMContentLoaded", () => {
  initQuotationForm().catch((error) => showToast(error.message || "Unable to load quotation form", "error"));
});

async function initQuotationForm() {
  await loadQuotationConfig();
  cacheElements();
  seedSelectOptions();
  bindEvents();
  writeFormToDom();
  renderAll();
  refreshVisualizationFromState(true);
  document.getElementById("footer-year").textContent = new Date().getFullYear();
}

function cacheElements() {
  [
    "quotation-form",
    "quotation-error",
    "quotation-results",
    "layout-selection-summary",
    "cost-summary",
    "result-specifications",
    "quick-actions",
    "cost-breakdown",
    "layout-comparisons",
    "layout-preview-list",
    "layout-count-badge",
    "paper-image-list",
    "paper-zoom-modal",
    "paper-zoom-image",
    "paper-zoom-title",
    "paper-zoom-close",
    "stamping-options",
    "embossing-options",
    "texture-options",
    "handle-options",
    "board-options",
    "converting-helper",
    "stamping-area-note",
    "embossing-area-note",
    "handle-helper",
    "board-helper"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function seedSelectOptions() {
  populateSelect("paperName", paperTypes.map((paper) => ({
    value: paper.name,
    label: `${paper.name} (RM${paper.pricePerKg}/kg)`
  })));

  populateSelect("printingOption", printingOptions.map((option) => ({
    value: option.name,
    label: `${option.name} (${option.processColors}P${option.spotColors}S)`
  })));

  populateSelect("marginIndex", marginIndices.map((index) => ({
    value: index,
    label: `${index} (${((1 - index) * 100).toFixed(1)}% margin)`
  })));

  populateSelect("foilType", cfg.foilTypes);
  populateSelect("embossingType", cfg.embossingTypes.map((type) => ({
    value: type,
    label: type
  })));
  populateSelect("textureType", cfg.textureTypes);
  populateSelect("inkType", cfg.inkTypes);
  populateSelect("varnish", cfg.varnishTypes);
  populateSelect("lamination", cfg.laminationTypes);

  populateSelect("handleType", handleTypes.map((handle) => ({
    value: handle.id,
    label: `${handle.label} - RM ${handle.pricePerPair.toFixed(3)}/pair`
  })));

  populateSelect("boardType", boardTypes.map((board) => ({
    value: board.id,
    label: board.label
  })));

  applyLimitsToInputs();
}

function applyLimitsToInputs() {
  const limits = cfg.limits;
  [
    ["width", "width", "mm"],
    ["height", "height", "mm"],
    ["gusset", "gusset", "mm"],
    ["quantity", "quantity", "pcs"],
    ["stampingHeight", "foilSize", "mm"],
    ["stampingWidth", "foilSize", "mm"],
    ["embossingHeight", "foilSize", "mm"],
    ["embossingWidth", "foilSize", "mm"]
  ].forEach(([id, key, unit]) => {
    const field = document.getElementById(id);
    if (!field) return;
    const [min, max] = limits[key];
    field.min = min;
    field.max = max;
    const hint = field.closest(".field")?.querySelector("small");
    if (hint) {
      const format = (value) => key === "quantity" ? Number(value).toLocaleString() : value;
      hint.textContent = `${format(min)} - ${format(max)} ${unit}`;
    }
  });
}

function populateSelect(id, items) {
  const select = document.getElementById(id);
  select.innerHTML = items
    .map((item) => `<option value="${escapeHtml(String(item.value))}">${escapeHtml(item.label)}</option>`)
    .join("");
}

function bindEvents() {
  els["quotation-form"].addEventListener("submit", handleCalculate);
  document.getElementById("quotation-reset").addEventListener("click", handleReset);
  els["paper-zoom-close"].addEventListener("click", closeZoom);
  els["paper-zoom-modal"].addEventListener("click", (event) => {
    if (event.target === els["paper-zoom-modal"]) closeZoom();
  });

  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    button.addEventListener("click", () => {
      appState.activeTab = button.dataset.tabTarget;
      renderTabs();
    });
  });

  document.querySelectorAll("#quotation-form input, #quotation-form select").forEach((field) => {
    const type = field.type;
    field.addEventListener(type === "checkbox" ? "change" : "input", handleFieldChange);
    if (type !== "checkbox") field.addEventListener("change", handleFieldChange);
  });
}

function handleFieldChange(event) {
  const field = event.target;
  const { name, type } = field;
  if (!name || name === "foil" || name.startsWith("foilOffset")) return;

  appState.form[name] = type === "checkbox" ? field.checked : field.value;
  syncDerivedVisualizationFields();
  renderAll();
}

async function handleCalculate(event) {
  event.preventDefault();
  const validationErrors = validateForm();
  if (validationErrors.length) {
    appState.error = validationErrors.join(", ");
    appState.result = null;
    renderError();
    renderResults();
    return;
  }

  appState.error = "";
  renderError();

  try {
    const response = await fetch("/api/quotation/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ form: appState.form })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "An error occurred during calculation");
    appState.result = data.result;
  } catch (error) {
    appState.result = null;
    appState.error = error.message || "An error occurred during calculation";
  }

  renderError();
  renderResults();
}

function handleReset() {
  appState.form = { ...DEFAULT_FORM };
  appState.result = null;
  appState.error = "";
  writeFormToDom();
  renderAll();
  refreshVisualizationFromState(true);
}

function writeFormToDom() {
  Object.entries(appState.form).forEach(([key, value]) => {
    const field = document.getElementById(key);
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value;
  });

  syncDerivedVisualizationFields();
}

function renderAll() {
  renderTabs();
  renderFieldValidation();
  renderPaperCard();
  renderLayoutPreview();
  renderFinishingState();
  renderError();
  renderResults();
}

function renderTabs() {
  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tabTarget === appState.activeTab);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `tab-${appState.activeTab}`);
  });
}

function renderFieldValidation() {
  ["width", "height", "gusset", "quantity"].forEach((name) => {
    const field = document.getElementById(name);
    const wrapper = field.closest(".field");
    wrapper.classList.toggle("is-invalid", !isInputValid(name, Number(field.value)));
  });
}

function renderPaperCard() {
  const paper = paperTypes.find((item) => item.name === appState.form.paperName);
  const image = PAPER_IMAGES[appState.form.paperName];

  els["paper-image-list"].innerHTML = `
    <img class="paper-card__media" src="${escapeAttribute(image || "")}" alt="${escapeAttribute(appState.form.paperName)}">
    <div class="paper-card__content">
      <h4>${escapeHtml(appState.form.paperName)}</h4>
      <p>${paper ? `RM${paper.pricePerKg}/kg` : "Select a paper type"}</p>
      <button type="button" class="text-button" id="paper-zoom-trigger">View larger image</button>
    </div>
  `;

  const zoomTrigger = document.getElementById("paper-zoom-trigger");
  if (zoomTrigger) zoomTrigger.addEventListener("click", () => openZoom(appState.form.paperName));
}

function renderLayoutPreview() {
  const layouts = getSuitableLayouts();
  els["layout-count-badge"].textContent = `${layouts.length} efficient layout${layouts.length === 1 ? "" : "s"} available`;

  if (!layouts.length) {
    els["layout-preview-list"].innerHTML = `
      <div class="callout callout-warning">
        <strong>No suitable layouts found.</strong> Your dimensions do not fit standard sheet sizes. Try adjusting width, height, or gusset.
      </div>
    `;
    return;
  }

  els["layout-preview-list"].innerHTML = layouts.map((layoutData) => {
    const sheetsNeeded = Math.ceil(Number(appState.form.quantity) / layoutData.bagsPerSheet);
    const materialEfficiency = Math.min(
      100,
      Number(((layoutData.bagsPerSheet / (layoutData.sheetWidth * layoutData.sheetHeight)) * 100).toFixed(0))
    );

    return `
      <article class="layout-preview-card">
        <div class="layout-preview-card__head">
          <span class="layout-name">${layoutData.layout}</span>
          <span class="layout-pill ${layoutData.bagsPerSheet > 1 ? "is-efficient" : ""}">
            ${layoutData.bagsPerSheet} bag${layoutData.bagsPerSheet > 1 ? "s" : ""}/sheet
          </span>
        </div>
        <div class="layout-metric"><span>Sheet Size</span><strong>${(layoutData.sheetWidth * 1000).toFixed(0)}mm x ${(layoutData.sheetHeight * 1000).toFixed(0)}mm</strong></div>
        <div class="layout-metric"><span>Sheets Needed</span><strong>${sheetsNeeded.toLocaleString()}</strong></div>
        <div class="layout-metric"><span>Material Efficiency</span><strong>${materialEfficiency}%</strong></div>
        <div class="layout-bar"><span style="width:${materialEfficiency}%"></span></div>
      </article>
    `;
  }).join("");
}

function renderFinishingState() {
  toggleOption("stamping", "stamping-options");
  toggleOption("embossing", "embossing-options");
  toggleOption("textureEmbossing", "texture-options");
  toggleOption("handles", "handle-options");
  toggleOption("reinforcementBoard", "board-options");
  toggleOption("convertingLabor", "converting-helper");
  ["spotUV", "dieCut", "packaging", "mockUp"].forEach((name) => {
    const card = document.querySelector(`[data-toggle-card="${name}"]`);
    if (card) card.classList.toggle("is-active", Boolean(appState.form[name]));
  });

  els["stamping-area-note"].innerHTML = `
    <strong>Stamping Area:</strong> ${escapeHtml(String(appState.form.stampingHeight))}mm x ${escapeHtml(String(appState.form.stampingWidth))}mm
  `;
  els["embossing-area-note"].innerHTML = `
    <strong>Embossing Area:</strong> ${escapeHtml(String(appState.form.embossingHeight))}mm x ${escapeHtml(String(appState.form.embossingWidth))}mm
  `;

  const handle = handleTypes.find((item) => item.id === appState.form.handleType);
  const handleEstimate = handle ? (handle.pricePerPair * Number(appState.form.quantity || 0)).toFixed(2) : "0.00";
  els["handle-helper"].innerHTML = `
    ${handle?.needsBB ? '<div class="callout callout-warning">PTH handles require Reinforcement Board (BB). Enable P14 below.</div>' : ""}
    <div>Estimated: RM ${handleEstimate}</div>
  `;

  const board = boardTypes.find((item) => item.id === appState.form.boardType);
  els["board-helper"].textContent = board?.note || "";

  if (Boolean(appState.form.convertingLabor)) {
    const display = cfg.display;
    const height = Number(appState.form.height);
    const width = Number(appState.form.width);
    const gusset = Number(appState.form.gusset) || display.convertingDefaultGusset;
    const volume = ((height * width * gusset) / 1_000_000_000).toFixed(6);
    const glueLength = ((height / 1000) + (2 * width / 1000) + (gusset / 1000) - display.convertingGlueDeduction).toFixed(3);
    els["converting-helper"].innerHTML = `
      <div>Bag Volume: ${volume} m³</div>
      <div>Glue Length: ${glueLength} m</div>
      <div><em>Rate = (Converting + Glue + Handling) x ${display.convertingYearMultiplier} (annual uplift)</em></div>
    `;
  } else {
    els["converting-helper"].textContent = "";
  }
}

function toggleOption(stateKey, detailId) {
  const active = Boolean(appState.form[stateKey]);
  const detail = els[detailId];
  const card = document.querySelector(`[data-toggle-card="${stateKey}"]`);
  if (detail) detail.classList.toggle("is-hidden", !active);
  if (card) card.classList.toggle("is-active", active);
}

function renderError() {
  if (appState.error) {
    showToast(appState.error, "error");
  }
  els["quotation-error"].classList.add("is-hidden");
}

function renderResults() {
  const result = appState.result;
  els["quotation-results"].classList.toggle("is-hidden", !result);
  if (!result) return;

  renderLayoutSummary(result);
  renderCostSummary(result);
  renderSpecifications(result);
  renderQuickActions(result);
  renderCostBreakdown(result);
  renderLayoutComparisons(result);
}

function renderLayoutSummary(result) {
  els["layout-selection-summary"].innerHTML = `
    <h3>Auto Layout Selection</h3>
    <ul class="summary-list">
      <li><span>Suitable Layouts</span><span class="summary-value">${escapeHtml((result?.layoutSelection?.suitableLayouts || []).join(", ") || "None")}</span></li>
      <li><span>Selected Layout</span><span class="summary-value is-blue">${escapeHtml(result?.layoutSelection?.selectedLayout || "Not selected")}</span></li>
      <li><span>Layout Count</span><span class="summary-value">${(result?.layoutSelection?.suitableLayouts || []).length} suitable</span></li>
    </ul>
  `;
}

function renderCostSummary(result) {
  const marginPercent = (1 - Number(result?.summary?.marginIndex || 0)) * 100;
  const items = [
    ["Total Cost", formatCurrency(result?.summary?.totalCost)],
    ["Unit Cost", formatSmallCurrency(result?.summary?.unitCost)],
    ["Unit Selling Price", formatSmallCurrency(result?.summary?.unitSellingPrice)],
    ["Total Selling Price", formatCurrency(result?.summary?.totalSellingPrice)],
    ["Margin", `${marginPercent.toFixed(1)}%`]
  ];

  els["cost-summary"].innerHTML = `
    <h3>Cost Summary</h3>
    <ul class="summary-list">
      ${items.map(([label, value]) => `
        <li>
          <span>${escapeHtml(label)}</span>
          <span class="summary-value ${label.includes("Selling") ? "is-green" : label === "Margin" ? "is-blue" : ""}">${escapeHtml(value)}</span>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderSpecifications(result) {
  const dimensions = result?.input?.dimensions || {};
  const items = [
    ["Dimensions", `${dimensions.width || 0}mm x ${dimensions.height || 0}mm`],
    ["Gusset", `${dimensions.gusset || 0}mm`],
    ["Paper", result?.input?.paper || "Not specified"],
    ["Printing", result?.input?.printing || "Not specified"],
    ["Quantity", `${Number(result?.input?.quantity || 0).toLocaleString()} pcs`]
  ];

  els["result-specifications"].innerHTML = `
    <h3>Specifications</h3>
    <ul class="summary-list">
      ${items.map(([label, value]) => `
        <li>
          <span>${escapeHtml(label)}</span>
          <span class="summary-value">${escapeHtml(value)}</span>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderQuickActions(result) {
  els["quick-actions"].innerHTML = `
    <h3>Quick Actions</h3>
    <div class="stack">
      <button type="button" id="quotation-save-draft" class="button button-secondary">Save as Draft</button>
      <button type="button" id="quotation-submit-sales" class="button button-primary">Submit to Sales</button>
      <a class="button button-ghost" href="/dashboard/quotation-dashboard.html">Back to Dashboard</a>
    </div>
  `;

  document.getElementById("quotation-save-draft").addEventListener("click", (event) => {
    saveQuotation("draft", event.currentTarget);
  });

  document.getElementById("quotation-submit-sales").addEventListener("click", (event) => {
    saveQuotation("submitted", event.currentTarget);
  });
}

function renderCostBreakdown(result) {
  const costs = result?.calculations?.costs || {};
  const content = Object.keys(costs).length
    ? Object.entries(costs).map(([key, value]) => `
      <div class="cost-chip">
        <div class="cost-chip__label">${escapeHtml(COST_LABELS[key] || key)}</div>
        <div class="cost-chip__value">${formatCurrency(value)}</div>
      </div>
    `).join("")
    : "<p>No cost breakdown available</p>";

  els["cost-breakdown"].innerHTML = `
    <h3>Cost Breakdown</h3>
    <div class="cost-breakdown-grid">${content}</div>
  `;
}

function renderLayoutComparisons(result) {
  const container = els["layout-comparisons"];
  const layouts = result?.calculations?.allLayouts || [];
  container.classList.toggle("is-hidden", layouts.length <= 1);
  if (layouts.length <= 1) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <h3>Layout Comparisons</h3>
    <div class="comparison-grid">
      ${layouts.map((layoutCalc) => `
        <article class="comparison-item">
          <div class="comparison-item__title">${escapeHtml(layoutCalc.layout)}</div>
          <div class="comparison-metric"><span>Sheet Size</span><strong>${layoutCalc.sheetSize?.width}m x ${layoutCalc.sheetSize?.height}m</strong></div>
          <div class="comparison-metric"><span>Bags / Sheet</span><strong>${layoutCalc.bagsPerSheet}</strong></div>
          <div class="comparison-metric"><span>Sheets Needed</span><strong>${Math.ceil(layoutCalc.sheetsNeeded || 0).toLocaleString()}</strong></div>
          <div class="comparison-metric"><span>Unit Cost</span><strong>${formatSmallCurrency(layoutCalc.summary?.unitCost || 0)}</strong></div>
        </article>
      `).join("")}
    </div>
  `;
}

function getRequesterPayload() {
  const user = typeof window.getCurrentUser === "function" ? window.getCurrentUser() : null;
  return {
    user_id: user?.user_id || user?.id || "",
    user_email: user?.user_email || user?.email || "",
    user_phone: user?.user_phone || user?.phone || "",
    user_name: user?.user_name || user?.name || "User",
    role: user?.role || "User",
    company_name: user?.company_name || user?.company || user?.user_name || user?.user_email || "MLM Customer",
    address: user?.address || ""
  };
}

async function saveQuotation(status, button = null) {
  const runSave = async () => {
  try {
    const response = await fetch("/api/quotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status,
        form: appState.form,
        requester: getRequesterPayload()
      })
    });
    const contentType = response.headers.get("content-type") || "";
    const responseText = await response.text();

    if (contentType.includes("text/html") || responseText.trim().startsWith("<!DOCTYPE") || responseText.trim().startsWith("<html")) {
      throw new Error("Quotation API is not available on this deployment.");
    }

    const data = responseText ? JSON.parse(responseText) : {};

    if (!response.ok) {
      throw new Error(data.error || "Unable to save quotation to database");
    }

    const actionText = status === "draft" ? "saved as draft" : "submitted to quotation dashboard";
    showToast(`Quotation ${actionText}. Reference: ${data.quotation?.quotation_number || data.quotation?.id}`, "success");
    setTimeout(() => {
      window.location.href = "/dashboard/quotation-dashboard.html";
    }, 2000);
  } catch (error) {
    appState.error = error.message || "Unable to save quotation";
    showToast(error.message || "Unable to save quotation", "error");
    renderError();
  }
  };

  const loadingText = status === "draft" ? "Saving..." : "Submitting...";
  if (button) {
    return withFormButtonLoading(button, loadingText, runSave);
  }

  return runSave();
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  let icon = type === 'error' ? '⚠️' : (type === 'success' ? '✅' : 'ℹ️');
  toast.innerHTML = `<span>${icon} ${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'fadeOutUp 0.5s forwards';
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

function openZoom(paperName) {
  const src = PAPER_IMAGES[paperName];
  if (!src) return;
  appState.zoomImage = { src, name: paperName };
  els["paper-zoom-image"].src = src;
  els["paper-zoom-image"].alt = paperName;
  els["paper-zoom-title"].textContent = paperName;
  els["paper-zoom-modal"].classList.remove("is-hidden");
}

function closeZoom() {
  appState.zoomImage = null;
  els["paper-zoom-modal"].classList.add("is-hidden");
}

function syncDerivedVisualizationFields() {
  const foilEnabled = document.getElementById("foil");
  const foilWidth = document.getElementById("foilWidth");
  const foilHeight = document.getElementById("foilHeight");

  foilEnabled.checked = Boolean(appState.form.stamping);
  foilWidth.value = appState.form.stampingWidth;
  foilHeight.value = appState.form.stampingHeight;

  ["foil", "foilWidth", "foilHeight"].forEach((id) => {
    const field = document.getElementById(id);
    if (!field) return;
    const eventName = field.type === "checkbox" ? "change" : "input";
    field.dispatchEvent(new Event(eventName, { bubbles: true }));
  });
}

function refreshVisualizationFromState(fullRefresh = false) {
  syncDerivedVisualizationFields();
  if (!fullRefresh) return;

  ["width", "height", "gusset", "handles"].forEach((id) => {
    const field = document.getElementById(id);
    if (!field) return;
    const eventName = field.type === "checkbox" ? "change" : "input";
    field.dispatchEvent(new Event(eventName, { bubbles: true }));
  });
}

function validateForm() {
  const errors = [];
  const limits = cfg.limits;
  if (!isInputValid("width", Number(appState.form.width))) errors.push(`Width must be between ${limits.width[0]}mm and ${limits.width[1]}mm`);
  if (!isInputValid("height", Number(appState.form.height))) errors.push(`Height must be between ${limits.height[0]}mm and ${limits.height[1]}mm`);
  if (!isInputValid("gusset", Number(appState.form.gusset))) errors.push(`Gusset must be between ${limits.gusset[0]}mm and ${limits.gusset[1]}mm`);
  if (!isInputValid("quantity", Number(appState.form.quantity))) errors.push(`Quantity must be between ${limits.quantity[0].toLocaleString()} and ${limits.quantity[1].toLocaleString()} pieces`);
  return errors;
}

function isInputValid(name, value) {
  const range = cfg?.limits?.[name];
  return range ? value >= range[0] && value <= range[1] : true;
}

function getBagsPerSheet(layout) {
  return getLayoutConfig(layout)?.bagsPerSheet ?? 1;
}

function calcSheetSize({ width, height, gusset, layout }) {
  const geo = cfg.layoutGeometry;
  const item = getLayoutConfig(layout);
  const w = Number(width) / 1000;
  const h = Number(height) / 1000;
  const g = Number(gusset) / 1000;
  return {
    sheetWidth: Number((item.widthMult * (w + g) + geo.edgeAllowance).toFixed(3)),
    sheetHeight: Number((item.heightMult * (h + geo.gussetFactor * g + geo.heightAllowance)).toFixed(3))
  };
}

function getLayoutConfig(layout) {
  return cfg.layoutGeometry.layouts.find((item) => item.key === layout);
}

function validateLayout({ sheetWidth, sheetHeight, layout }) {
  const ranges = getLayoutConfig(layout)?.validRanges || [];
  return {
    valid: ranges.some(([wMin, wMax, hMin, hMax]) =>
      sheetWidth >= wMin && sheetWidth <= wMax && sheetHeight >= hMin && sheetHeight <= hMax)
  };
}

function getSuitableLayouts() {
  return cfg.layoutGeometry.layouts
    .map((item) => {
      const { sheetWidth, sheetHeight } = calcSheetSize({
        width: appState.form.width,
        height: appState.form.height,
        gusset: appState.form.gusset,
        layout: item.key
      });
      return { layout: item.key, sheetWidth, sheetHeight, bagsPerSheet: item.bagsPerSheet };
    })
    .filter((item) => validateLayout(item).valid);
}

function formatCurrency(value) {
  return `RM ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSmallCurrency(value) {
  return `RM ${Number(value || 0).toFixed(4)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
