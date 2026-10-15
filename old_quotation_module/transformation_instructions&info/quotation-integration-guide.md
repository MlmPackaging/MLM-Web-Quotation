# Quotation → database: integration guide

The find/replace blocks below are the original migration reference; the changes described have now been applied. Do not apply them a second time.

Runtime modules remain in `transformation_instructions&info` and are loaded by `quotation-backend.js`. Run the SQL scripts once, in this order: `quotation_schema.sql`, then `quotation_seed.sql`.

## Integration status

The runtime integration is wired into the application:

- `quotation-backend.js` loads the engine and config service from this folder.
- `/api/quotation/config` and `/api/quotation/calculate` provide the database-driven form config and server calculation.
- The config endpoint and each calculation/save reload the active rate card from MySQL; config responses are marked `no-store`, so a page refresh does not reuse a stale in-memory or HTTP-cached rate card.
- Saving a quotation recalculates from the submitted form and records the selected `rate_version_id`; client totals are not accepted.
- Rate-editor routes require a signed admin token and a currently active account with the `Admin` role.
- The legacy form builds its options, limits, and layout preview from the active rate version. The browser no longer loads `/quotation.js`.

The schema and seed scripts remain one-time deployment steps. On application startup, the legacy quotation backend checks for the `rate_version_id` column on an existing quotations table and warms the active rate-card cache. Calculation handlers remain the built-in functions in `quotation-engine.js`; rate values, tier tables, options, limits, and component labels are database-configurable.

## PostgreSQL quotation page

The newer page at `/html/quotation.html` loads its material, printing, and handle dropdowns from the active PostgreSQL rate-card options (`quotation_options`, grouped as `paper`, `printing`, and `handle`). These are the same option types used by the legacy quotation engine; the separate `paper_master`, `printing_master`, and `handle_master` tables are not used to populate the customer form. The option endpoint reloads the active rate card and disables HTTP caching. The page sends the selected option keys to `/api/quotation/estimate` and quotation creation, and the server calculates from those keys using the legacy `quotation-engine.js`; browser-submitted prices are never trusted.

For the PostgreSQL database, run `quotation_schema.postgresql.sql` and then `quotation_seed.postgresql.sql`. The schema also adds `quotation.rate_version_id`, nullable `quotation_item` master IDs and rate-option key/label columns, and per-quantity estimate columns to the existing quotation tables. Re-run the updated schema script before deploying the rate-option-backed page if you previously ran an older version of the PostgreSQL script. The seed runs in one PostgreSQL `DO` block and preserves the source seed values while using `RETURNING ... INTO` instead of MySQL session variables.

The new page calculates all four selected quantities through `/api/quotation/estimate`. When the quotation is submitted, the server recalculates them using the current active PostgreSQL rate version and saves each unit estimate, total estimate, full calculation breakdown, selected rate-option keys and labels, and the rate version in the same transaction as the quotation. Customer and admin quotation views use the stored labels, including for quotations whose master IDs are null. Admin edits use active rate-card options for new quotations and continue to resolve legacy master selections to their matching rate-card options. Estimates exclude delivery and remain subject to MPak's artwork and specification review. Optional finishing choices not present in this form are not charged.

---

## 1. Database

1. Run `quotation_schema.sql` once. Its final `ALTER TABLE` is not idempotent; application startup separately adds `rate_version_id` when upgrading an existing quotations table.
2. Run `quotation_seed.sql`. It creates one **active** rate version holding every value that used to be hardcoded.
3. Check: `SELECT COUNT(*) FROM quotation_parameters;` → 53, `SELECT COUNT(*) FROM quotation_tier_rows;` → 360.

---

## 2. Backend – `quotation-backend.js`

### 2.1 Top of file – add two requires
**Find**
```js
const PDFDocument = require("pdfkit");
```
**Replace with**
```js
const PDFDocument = require("pdfkit");
const { createQuotationRateService } = require("./quotation-config-service");
const { calculateQuotation } = require("./quotation-engine");
```

### 2.2 `createQuotationBackend({ ... })` – accept an admin check
**Find**
```js
function createQuotationBackend({
  database,
  logger,
```
**Replace with**
```js
function createQuotationBackend({
  database,
  logger,
  authorizeAdmin, // async (req) => true/false. MUST verify a real session/token server-side.
```

### 2.3 Right after `const router = express.Router();`
**Add**
```js
  const rates = createQuotationRateService({
    database, logger, authorizeAdmin, addAuditLogEntryWithRetry, resolveAuditAccount,
  });
  router.use(rates.router);

  // Pricing breakdown for the PDF, built from the REAL cost lines (P1..P18) grouped by report_group
  async function buildPricingBreakdown(quotation) {
    const costs = quotation.quotation_data?.calculations?.costs || {};
    const cfg = await rates.getRateConfig(quotation.rate_version_id || undefined);
    const totals = {};
    for (const c of cfg.components) {
      const g = c.report_group || "Other";
      totals[g] = (totals[g] || 0) + Number(costs[c.code] || 0);
    }
    return Object.entries(totals)
      .filter(([, amount]) => amount > 0)
      .map(([description, amount]) => ({ description, amount }));
  }
```

### 2.4 `insertQuotation` – store which rate card priced it
**Find**
```js
        (quotation_number, status, total_amount, user_id, user_email, user_phone,
         user_name, user_company, user_contact_person, user_address, quotation_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quotation.quotation_number,
        quotation.status,
        quotation.total_amount,
```
**Replace with**
```js
        (quotation_number, status, total_amount, rate_version_id, user_id, user_email, user_phone,
         user_name, user_company, user_contact_person, user_address, quotation_data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quotation.quotation_number,
        quotation.status,
        quotation.total_amount,
        quotation.rate_version_id || null,
```

### 2.5 `POST /api/quotations` – recalculate on the server (stop trusting the browser's total)
**Find**
```js
      const { status, quotation_data, requester } = req.body;

      if (!status || !quotation_data) {
        return res.status(400).json({ error: "Missing required fields: status, quotation_data" });
      }
```
**Replace with**
```js
      const { status, form, requester } = req.body;

      if (!status || !form) {
        return res.status(400).json({ error: "Missing required fields: status, form" });
      }

      let quotation_data;
      let rateConfig;
      try {
        rateConfig = await rates.getRateConfig();
        quotation_data = calculateQuotation(form, rateConfig);
      } catch (calcError) {
        return res.status(400).json({ error: calcError.message });
      }
```
**Find**
```js
        total_amount: quotation_data.summary?.totalSellingPrice || 0,
```
**Replace with**
```js
        total_amount: quotation_data.summary?.totalSellingPrice || 0,
        rate_version_id: rateConfig.versionId,
```

### 2.6 PDF – use the real breakdown instead of the fixed 40/30/20/10 split
**Find**
```js
  function generateProfessionalPDF(quotation) {
```
**Replace with**
```js
  function generateProfessionalPDF(quotation, breakdownItems = []) {
```
**Find**
```js
        const pricingItems = [
          { description: "Material Cost", amount: totalCost * 0.4 },
          { description: "Printing Cost", amount: totalCost * 0.3 },
          { description: "Production Cost", amount: totalCost * 0.2 },
          { description: "Handling & Packaging", amount: totalCost * 0.1 },
          { description: "Subtotal", amount: totalCost },
        ];
```
**Replace with**
```js
        const pricingItems = [
          ...breakdownItems,
          { description: "Subtotal", amount: totalCost },
        ];
```
In `GET /api/quotations/:id/export`:

**Find**
```js
      const pdfBuffer = await generateProfessionalPDF(quotation);
```
**Replace with**
```js
      const breakdown = await buildPricingBreakdown(quotation);
      const pdfBuffer = await generateProfessionalPDF(quotation, breakdown);
```
(The PDF heights are fixed for 5 rows; with more groups, raise the `ensureSpace(250)` before "PRICING BREAKDOWN" to about `ensureSpace(150 + 25 * (breakdownItems.length + 1))`.)

### 2.7 End of `initializeQuotationTables` and the return value
**Add as the last lines inside `initializeQuotationTables`**
```js
    try {
      await rates.ensureLoaded();
    } catch (error) {
      console.error("[Quotation] Rate card not loaded - run quotation_schema.sql and quotation_seed.sql:", error.message);
    }
```
**Find**
```js
  return { router, initializeQuotationTables };
```
**Replace with**
```js
  return { router, initializeQuotationTables, rates };
```

### 2.8 Where you call `createQuotationBackend(...)` in your main server file
Add an `authorizeAdmin` that checks your **server-side** session/token, for example:
```js
authorizeAdmin: async (req) => {
  const user = await getUserFromSession(req);       // your existing auth
  return Boolean(user && user.role === "admin");
},
```
Until you add this, every rate-editing endpoint answers 403 (deny by default). The existing admin dashboard route currently trusts a `role` sent by the browser; do not copy that pattern for rate editing.

---

## 3. Frontend – `quotation-form.js`

### 3.1 Remove the old engine import
**Find and delete**
```js
import {
  calculateQuotation,
  getPaperTypes,
  getPrintingOptions,
  getMarginIndices,
  getHandleTypes,
  getReinforcementBoardTypes
} from "/quotation.js";
```
You can also delete the `FOIL_TYPES`, `EMBOSSING_TYPES` and `TEXTURE_TYPES` constants at the top (they now come from the database).

### 3.2 Load the config before the form starts
**Find**
```js
const paperTypes = getPaperTypes();
const printingOptions = getPrintingOptions();
const marginIndices = getMarginIndices();
const handleTypes = getHandleTypes();
const boardTypes = getReinforcementBoardTypes();
const els = {};

document.addEventListener("DOMContentLoaded", initQuotationForm);

function initQuotationForm() {
  cacheElements();
```
**Replace with**
```js
let cfg = null;
let paperTypes = [];
let printingOptions = [];
let marginIndices = [];
let handleTypes = [];
let boardTypes = [];
const els = {};

async function loadQuotationConfig() {
  const response = await fetch("/api/quotation/config");
  if (!response.ok) throw new Error("Unable to load quotation rates");
  cfg = await response.json();
  paperTypes = cfg.paperTypes;
  printingOptions = cfg.printingOptions;
  marginIndices = cfg.marginIndices;
  handleTypes = cfg.handleTypes;
  boardTypes = cfg.boardTypes;
  Object.assign(COST_LABELS, cfg.costLabels);
}

document.addEventListener("DOMContentLoaded", () => {
  initQuotationForm().catch((error) => showToast(error.message || "Unable to load quotation form", "error"));
});

async function initQuotationForm() {
  await loadQuotationConfig();
  cacheElements();
```

### 3.3 `seedSelectOptions` – dropdowns from the database
**Find**
```js
  populateSelect("foilType", FOIL_TYPES.map((foil) => ({
    value: foil.value,
    label: foil.label
  })));

  populateSelect("embossingType", EMBOSSING_TYPES.map((type) => ({
    value: type,
    label: type
  })));

  populateSelect("textureType", TEXTURE_TYPES.map((type) => ({
    value: type,
    label: type === "standard" ? "Standard Texture" : "Custom Texture"
  })));
```
**Replace with**
```js
  populateSelect("foilType", cfg.foilTypes);
  populateSelect("embossingType", cfg.embossingTypes.map((type) => ({ value: type, label: type })));
  populateSelect("textureType", cfg.textureTypes);
  populateSelect("inkType", cfg.inkTypes);
  populateSelect("varnish", cfg.varnishTypes);
  populateSelect("lamination", cfg.laminationTypes);
  applyLimitsToInputs();
```
**Add this new function right below `seedSelectOptions`**
```js
function applyLimitsToInputs() {
  const L = cfg.limits;
  [
    ["width", "width"], ["height", "height"], ["gusset", "gusset"], ["quantity", "quantity"],
    ["stampingHeight", "foilSize"], ["stampingWidth", "foilSize"],
    ["embossingHeight", "foilSize"], ["embossingWidth", "foilSize"]
  ].forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) { el.min = L[key][0]; el.max = L[key][1]; }
  });
}
```
In `quotation-create.html` you can now delete the hardcoded `<option>` lines inside `#inkType`, `#varnish` and `#lamination` (including the "RM60/kg" labels), and the `min`/`max` attributes on the number inputs.

### 3.4 `handleCalculate` – calculate on the server
**Find**
```js
function handleCalculate(event) {
```
**Replace with**
```js
async function handleCalculate(event) {
```
**Find**
```js
    appState.result = calculateQuotation(normalizeFormToEngine(appState.form));
```
**Replace with**
```js
    const response = await fetch("/api/quotation/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ form: appState.form })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "An error occurred during calculation");
    appState.result = data.result;
```

### 3.5 `saveQuotation` – send the form, not the result
**Find**
```js
        quotation_data: result,
```
**Replace with**
```js
        form: appState.form,
```

### 3.6 `validateForm` and `isInputValid` – limits from the database
**Find** the whole `validateForm` function and the whole `isInputValid` function, **replace with**
```js
function validateForm() {
  const errors = [];
  const L = cfg.limits;
  if (!isInputValid("width", Number(appState.form.width))) errors.push(`Width must be between ${L.width[0]}mm and ${L.width[1]}mm`);
  if (!isInputValid("height", Number(appState.form.height))) errors.push(`Height must be between ${L.height[0]}mm and ${L.height[1]}mm`);
  if (!isInputValid("gusset", Number(appState.form.gusset))) errors.push(`Gusset must be between ${L.gusset[0]}mm and ${L.gusset[1]}mm`);
  if (!isInputValid("quantity", Number(appState.form.quantity))) errors.push(`Quantity must be between ${L.quantity[0].toLocaleString()} and ${L.quantity[1].toLocaleString()} pieces`);
  return errors;
}

function isInputValid(name, value) {
  const range = cfg?.limits?.[name];
  return range ? value >= range[0] && value <= range[1] : true;
}
```

### 3.7 Live layout preview – `getBagsPerSheet`, `calcSheetSize`, `validateLayout`, `getSuitableLayouts`
**Find** these four functions (they sit together near the bottom, above `normalizeFormToEngine`) and **replace all four with**
```js
function getLayoutConfig(layout) {
  return cfg.layoutGeometry.layouts.find((item) => item.key === layout);
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
```

### 3.8 `renderFinishingState` – converting helper no longer hardcodes 115 / 0.02 / 1.1
**Find** the whole `if (Boolean(appState.form.convertingLabor)) { ... }` block (the one that builds `volume` and `glueLength`) and **replace with**
```js
  if (Boolean(appState.form.convertingLabor)) {
    const d = cfg.display;
    const height = Number(appState.form.height);
    const width = Number(appState.form.width);
    const gusset = Number(appState.form.gusset) || d.convertingDefaultGusset;
    const volume = ((height * width * gusset) / 1_000_000_000).toFixed(6);
    const glueLength = ((height / 1000) + (2 * width / 1000) + (gusset / 1000) - d.convertingGlueDeduction).toFixed(3);
    els["converting-helper"].innerHTML = `
      <div>Bag Volume: ${volume} m³</div>
      <div>Glue Length: ${glueLength} m</div>
      <div><em>Rate = (Converting + Glue + Handling) x ${d.convertingYearMultiplier} (annual uplift)</em></div>
    `;
  } else {
    els["converting-helper"].textContent = "";
  }
```

### 3.9 Delete `normalizeFormToEngine`
Remove the whole `normalizeFormToEngine` function from `quotation-form.js`. The server does this now (inside `quotation-engine.js`).

---

## 4. Remove the old engine from the browser

Stop serving `/quotation.js` publicly (move it out of the static folder, e.g. to `quotation.legacy.js`, until you have compared a few quotes). While it is served, every rate stays readable by anyone who opens the browser dev tools.

## 5. Compare before you switch off the old one

Quote the same 5–10 bags on the old and new versions. They match exactly except in the edge cases listed in the analysis document under "Problems found" (those are the cases where the old code fell back to the last table row).
