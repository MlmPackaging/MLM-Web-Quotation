(function () {
  "use strict";

  const BASE = "/api/admin/quotation-engine";
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
  const state = { versions: [], activeVersionId: null, selectedVersionId: null, data: null, tab: "parameters" };

  function authHeaders() {
    try {
      const raw = localStorage.getItem("user") || sessionStorage.getItem("user");
      const user = raw ? JSON.parse(raw) : null;
      return user?.auth_token ? { Authorization: `Bearer ${user.auth_token}` } : {};
    } catch (error) {
      console.error("Unable to read the staff session.", error);
      return {};
    }
  }

  async function request(path, options = {}) {
    const response = await fetch(`${BASE}${path}`, {
      credentials: "same-origin",
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) },
    });
    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error(`Server returned an invalid response (${response.status}).`);
    }
    if (!response.ok) {
      if (response.status === 401) {
        const returnTo = `${location.pathname}${location.search}`;
        location.href = `/login.html?returnTo=${encodeURIComponent(returnTo)}`;
      }
      throw new Error(data.error || `Request failed (${response.status}).`);
    }
    return data;
  }

  const json = (method, body) => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  function message(text, success = false) {
    // success → toast only; errors also stay inline so they aren't missed
    $("engineMessage").textContent = success ? "" : text;
    $("engineMessage").className = "engine-message";
    if (!text) return;
    toast(text, success ? "good" : "bad");
    if (!success && $("engineContent").querySelector(".skeleton-card")) {
      $("engineContent").innerHTML = '<p class="empty-engine">Could not load the quotation engine.</p>';
    }
  }

  function versionLabel(version) {
    const status = String(version.status || "").toUpperCase();
    const created = version.created_at ? ` · ${String(version.created_at).slice(0, 16)}` : "";
    const actor = version.created_by ? ` · ${version.created_by}` : "";
    return `${version.version_label} · v${version.version_id} · ${status}${created}${actor}`;
  }

  async function loadRates(versionId) {
    const query = versionId ? `?version_id=${encodeURIComponent(versionId)}` : "";
    const data = await request(`/rates${query}`);
    state.data = data;
    state.versions = data.versions;
    state.activeVersionId = Number(data.activeVersionId);
    state.selectedVersionId = Number(data.selectedVersionId);
    const [tierRows, optionRows] = await Promise.all([
      Promise.all(data.tierSets.map(async (set) => {
        const result = await request(`/tier-sets/${set.tier_set_id}/rows`);
        return [String(set.tier_set_id), result.rows];
      })),
      Promise.all(data.groups.map(async (group) => {
        const result = await request(`/option-groups/${group.group_id}/options`);
        return [String(group.group_id), result.options];
      })),
    ]);
    if (!state.data || (versionId && Number(versionId) !== state.selectedVersionId)) {
      state.animate = true;   // fresh load or version switch: skeleton + entrance animation
      showSkeleton();
    }
    data.rowsBySetId = Object.fromEntries(tierRows);
    data.optionsByGroupId = Object.fromEntries(optionRows);
    renderVersionControls();
    renderTab();
  }

  function renderVersionControls() {
    const selected = state.versions.find((version) => Number(version.version_id) === state.selectedVersionId);
    const active = state.versions.find((version) => Number(version.version_id) === state.activeVersionId);
    $("versionSelect").innerHTML = state.versions.map((version) =>
      `<option value="${esc(version.version_id)}" ${Number(version.version_id) === state.selectedVersionId ? "selected" : ""}>${esc(versionLabel(version))}</option>`,
    ).join("");
    $("versionSummary").textContent = selected
      ? `${versionLabel(selected)}${selected.notes ? ` · ${selected.notes}` : ""}`
      : "No version selected.";
    const isDraft = selected?.status === "draft";
    const isHistorical = selected && selected.status === "archived";
    $("publishVersion").hidden = !isDraft;
    $("restoreVersion").hidden = !isHistorical;
    $("cloneVersion").disabled = !selected || isDraft;
    $("publishVersion").disabled = !isDraft;
    $("restoreVersion").disabled = !isHistorical;
    $("versionNotice").textContent = isDraft
      ? "Draft changes are private until published."
      : isHistorical
        ? `Read-only preview. Active version: ${active ? versionLabel(active) : "unknown"}.`
        : "This is the active published version. Create a draft to make changes.";

    const status = String(selected?.status || "").toLowerCase();
    $("versionStatus").textContent = status;
    $("versionStatus").className = `status-pill ${status}`;
    document.querySelector(".engine-version").dataset.status = status;
    const chip = $("modeChip");
    if (isDraft) {
      chip.className = "mode-chip edit";
      chip.innerHTML = '<i class="bi bi-pencil-square" aria-hidden="true"></i> Editing draft';
    } else if (isHistorical) {
      chip.className = "mode-chip";
      chip.innerHTML = '<i class="bi bi-lock-fill" aria-hidden="true"></i> Read-only · archived version';
    } else {
      chip.className = "mode-chip live";
      chip.innerHTML = '<i class="bi bi-broadcast" aria-hidden="true"></i> Live version · read-only';
    }
  }

  function historyButton(identifier, label = "History") {
    return `<button type="button" class="engine-action" data-history="${esc(identifier)}">${esc(label)}</button>`;
  }

  function editable() {
    const version = state.versions.find((item) => Number(item.version_id) === state.selectedVersionId);
    return version?.status === "draft";
  }

  function parameterValue(parameter) {
    if (parameter.value_type === "number") return parameter.value_number ?? "";
    if (parameter.value_type === "boolean") return Number(parameter.value_number) !== 0;
    return parameter.value_text ?? "";
  }

  function renderParameters() {
    const groups = new Map();
    for (const parameter of state.data.parameters) {
      if (!groups.has(parameter.group_code)) groups.set(parameter.group_code, []);
      groups.get(parameter.group_code).push(parameter);
    }
    if (!state.data.parameters.length) return '<p class="empty-engine">No parameters in this version.</p>';
    return [...groups].map(([group, parameters]) => `
      <section class="engine-card">
        <div class="engine-card-head"><div><h3>${esc(group)}</h3><p>${parameters.length} values</p></div></div>
        <div class="engine-fields">
          ${parameters.map((parameter) => {
            const input = parameter.value_type === "boolean"
              ? `<select class="control" data-value>${[true, false].map((value) => `<option value="${value}" ${parameterValue(parameter) === value ? "selected" : ""}>${value ? "True" : "False"}</option>`).join("")}</select>`
              : `<input class="control" data-value type="${parameter.value_type === "number" ? "number" : "text"}" ${parameter.value_type === "number" ? 'step="any"' : ""} value="${esc(parameterValue(parameter))}" ${parameter.min_allowed != null ? `min="${esc(parameter.min_allowed)}"` : ""} ${parameter.max_allowed != null ? `max="${esc(parameter.max_allowed)}"` : ""}>`;
            return `<article class="parameter-card" data-parameter-id="${esc(parameter.param_id)}">
              <label>${esc(parameter.label)}${parameter.unit ? ` (${esc(parameter.unit)})` : ""}${Number(parameter.is_locked) ? " · locked" : ""}
                ${input}
              </label>
              <div class="engine-meta">${esc(parameter.param_key)}${parameter.description ? ` · ${esc(parameter.description)}` : ""}${parameter.min_allowed != null || parameter.max_allowed != null ? ` · allowed ${esc(parameter.min_allowed ?? "−∞")} to ${esc(parameter.max_allowed ?? "∞")}` : ""}</div>
              <div class="engine-actions">${historyButton(parameter.param_key)}<button type="button" class="engine-action" data-save-parameter ${!editable() || Number(parameter.is_locked) ? "disabled" : ""}>Save value</button></div>
            </article>`;
          }).join("")}
        </div>
      </section>`).join("");
  }

  function renderTiers() {
    if (!state.data.tierSets.length) return '<p class="empty-engine">No calculation tiers in this version.</p>';
    return state.data.tierSets.map((set) => {
      const rows = state.data.rowsBySetId[String(set.tier_set_id)] || [];
      const columns = [
        ["range_max", "Range max"], ["value1", set.value1_label || "Value 1"],
        ...(set.value2_label ? [["value2", set.value2_label]] : []),
        ...(set.value3_label ? [["value3", set.value3_label]] : []),
      ];
      return `<section class="engine-card tier-set" data-tier-set-id="${esc(set.tier_set_id)}">
        <div class="engine-card-head"><div><h3>${esc(set.label)}</h3><p>${esc(set.set_key)} · Lookup by ${esc(set.lookup_basis)} · Below minimum: ${esc(set.below_min_behavior)}</p>${set.description ? `<p>${esc(set.description)}</p>` : ""}</div>${historyButton(set.set_key, "Table history")}</div>
        <div class="table-scroll"><table class="tier-table">
          <thead><tr><th>Range min</th>${columns.map(([, label]) => `<th>${esc(label)}</th>`).join("")}<th>Actions</th></tr></thead>
          <tbody>${rows.map((row) => `<tr data-range-min="${esc(row.range_min)}">
            <td>${esc(row.range_min)}<button type="button" class="tier-history" data-history="tier:${esc(set.set_key)}:${Number(row.range_min)}:row" aria-label="View row history">History</button></td>
            ${columns.map(([field]) => {
              const identifier = `tier:${set.set_key}:${Number(row.range_min)}:${field}`;
              const value = row[field] == null ? "" : row[field];
              return `<td><div class="tier-edit"><input class="control" type="number" step="any" data-field="${field}" value="${esc(value)}" ${editable() ? "" : "disabled"} aria-label="${esc(`${field} at range ${row.range_min}`)}"><button type="button" class="tier-history" data-history="${esc(identifier)}" aria-label="View history for ${esc(field)} at range ${esc(row.range_min)}" title="View cell history">History</button></div></td>`;
            }).join("")}
            <td><button type="button" class="engine-action delete" data-remove-tier-row ${editable() ? "" : "disabled"}>Delete row</button></td>
          </tr>`).join("")}</tbody>
        </table></div>
        <div class="engine-actions"><button type="button" class="engine-action" data-add-tier-row ${editable() ? "" : "disabled"}>Add tier row</button><button type="button" class="engine-action" data-save-tier ${editable() ? "" : "disabled"}>Save tier table</button></div>
      </section>`;
    }).join("");
  }

  function renderOptions() {
    if (!state.data.groups.length) return '<p class="empty-engine">No options in this version.</p>';
    return state.data.groups.map((group) => {
      const options = state.data.optionsByGroupId[String(group.group_id)] || [];
      return `<section class="engine-card option-group" data-group-id="${esc(group.group_id)}">
        <div class="engine-card-head"><div><h3>${esc(group.label)}</h3><p>${esc(group.group_key)} · ${options.length} options</p></div></div>
        <div class="engine-content">
          ${options.map((option) => `<article class="option-card" data-option-id="${esc(option.option_id)}">
            <div class="engine-card-head"><div><h3>${esc(option.label)}</h3><p>${esc(option.option_key)} · ${Number(option.is_active) ? "Active" : "Inactive"}</p></div>${historyButton(`option:${group.group_key}:${option.option_key}`)}</div>
            <div class="option-fields">
              <label>Label<input class="control" data-option-label value="${esc(option.label)}" ${editable() ? "" : "disabled"}></label>
              <label>Sort order<input class="control" type="number" step="1" data-option-order value="${esc(option.sort_order)}" ${editable() ? "" : "disabled"}></label>
              <label>Active<select class="control" data-option-active ${editable() ? "" : "disabled"}><option value="1" ${Number(option.is_active) ? "selected" : ""}>Yes</option><option value="0" ${Number(option.is_active) ? "" : "selected"}>No</option></select></label>
              <label class="wide">Attributes (JSON)<textarea class="control" data-option-attributes ${editable() ? "" : "disabled"}>${esc(JSON.stringify(option.attributes, null, 2))}</textarea></label>
            </div>
            <div class="engine-actions">
              <button type="button" class="engine-action delete" data-delete-option ${editable() ? "" : "disabled"}>Delete option</button>
              <button type="button" class="engine-action" data-save-option ${editable() ? "" : "disabled"}>Save option</button>
            </div>
          </article>`).join("")}
        </div>
        <details class="option-create" ${editable() ? "" : "hidden"}>
          <summary>Add an option</summary>
          <div class="option-fields">
            <label>Option key<input class="control" data-new-key placeholder="unique_key"></label>
            <label>Label<input class="control" data-new-label></label>
            <label class="wide">Attributes (JSON)<textarea class="control" data-new-attributes>{}</textarea></label>
          </div>
          <div class="engine-actions"><button class="engine-action" type="button" data-create-option>Create option</button></div>
        </details>
      </section>`;
    }).join("");
  }

  function renderComponents() {
    return `<p class="readonly-note">Calculation behavior is implemented by named handlers in the server-side engine. This screen exposes the database-driven inputs that those handlers use; arbitrary formula text is not executed from the database.</p>
      <section class="engine-card"><div class="engine-card-head"><div><h3>Pricing components</h3><p>Reporting groups and calculation handler references for this version.</p></div></div>
        <div class="component-grid">${state.data.components.map((component) => `<article class="component-card">
          <strong>${esc(component.label)} ${component.is_active ? "" : "(inactive)"}</strong>
          <code>${esc(component.code)} · ${esc(component.handler)}</code>
          <p>${esc(component.report_group || "Other")}${component.toggle_field ? ` · toggle ${esc(component.toggle_field)}` : ""}</p>
        </article>`).join("") || '<p class="empty-engine">No components in this version.</p>'}</div>
      </section>`;
  }

  const TAB_RENDERERS = () => ({
    parameters: renderParameters,
    tiers: renderTiers,
    options: renderOptions,
    components: renderComponents,
  });

  function renderTab() {
    if (!state.data) return;
    document.querySelectorAll(".engine-tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === state.tab);
    });
    const content = $("engineContent");
    content.innerHTML = TAB_RENDERERS()[state.tab]();
    content.classList.toggle("read-only", !editable());
    enhanceCards();
    buildSectionNav();
    applySearch();
    refreshDirtyState();
    if (state.animate) {
      state.animate = false;
      content.querySelectorAll(":scope > .engine-card").forEach((card, index) => card.style.setProperty("--i", Math.min(index, 8)));
      content.classList.add("animate-in");
      setTimeout(() => content.classList.remove("animate-in"), 1100);
    }
  }

  async function showHistory(identifier) {
    $("historyTitle").textContent = "Change history";
    $("historyIdentifier").textContent = identifier;
    $("historyEntries").innerHTML = '<p class="history-empty">Loading history…</p>';
    $("historyBackdrop").hidden = false;
    $("historyPanel").hidden = false;
    try {
      const result = await request(`/history/${encodeURIComponent(identifier)}`);
      $("historyEntries").innerHTML = result.history.length ? result.history.map((entry) => {
        const payload = entry.data_payload || {};
        const revertible = ["parameter", "tier", "option", "tier_row"].includes(payload.kind);
        return `<article class="history-entry">
          <strong>${esc(entry.action)} · ${esc(entry.change_summary || "")}</strong>
            <p>${payload.kind === "tier" || payload.kind === "parameter"
            ? `<span class="diff-old">${esc(payload.beforeValue)}</span> → <span class="diff-new">${esc(payload.afterValue)}</span>`
            : payload.kind === "option" || payload.kind === "tier_row"
              ? `<span class="diff-old">${esc(JSON.stringify(payload.before))}</span> → <span class="diff-new">${esc(JSON.stringify(payload.after))}</span>`
              : ""}</p>
          <small>${esc(entry.account)} · ${esc(entry.event_timestamp)}</small>
          ${revertible ? `<div class="engine-actions"><button type="button" class="engine-action" data-revert-audit="${esc(entry.audit_id)}">Revert as a new version</button></div>` : ""}
        </article>`;
      }).join("") : '<p class="history-empty">No recorded changes for this value yet.</p>';
    } catch (error) {
      $("historyEntries").innerHTML = `<p class="history-empty">${esc(error.message)}</p>`;
    }
  }

  async function cloneSelected() {
    const label = window.prompt("Name the new draft version:", `Draft from v${state.selectedVersionId}`);
    if (label === null) return;
    try {
      const result = await request("/versions/clone", json("POST", { from_version_id: state.selectedVersionId, label }));
      await loadRates(result.version_id);
      message("Draft created. Changes will not take effect until you publish it.", true);
    } catch (error) { message(error.message); }
    if (!guardUnsaved("continue")) return;
  }

  async function publishSelected() {
    if (!window.confirm("Publish this draft? It becomes the active rate version used for new quotations.")) return;
    try {
      await request(`/versions/${state.selectedVersionId}/publish`, json("POST", {}));
      await loadRates();
      message("Draft published and now active.", true);
    } catch (error) { message(error.message); }
    if (!guardUnsaved("continue")) return;
  }

  async function restoreSelected() {
    if (!window.confirm("Restore this historical version as active? The current version will remain archived and can be restored later.")) return;
    try {
      await request(`/versions/${state.selectedVersionId}/restore`, json("POST", {}));
      await loadRates();
      message(`Quotation engine restored to v${state.activeVersionId}.`, true);
    } catch (error) { message(error.message); }
    if (!guardUnsaved("continue")) return;
  }

  async function saveParameter(button) {
    const card = button.closest("[data-parameter-id]");
    const input = card.querySelector("[data-value]");
    const value = input.tagName === "SELECT" ? input.value === "true" : input.value;
    try {
      await request(`/parameters/${card.dataset.parameterId}`, json("PUT", { value }));
      await loadRates(state.selectedVersionId);
      message("Parameter saved.", true);
    } catch (error) { message(error.message); }
  }

  async function saveTier(button) {
    const card = button.closest(".tier-set");
    const set = state.data.tierSets.find((item) => String(item.tier_set_id) === card.dataset.tierSetId);
    const rows = [...card.querySelectorAll("tbody tr")].map((row) => {
      const values = Object.fromEntries([...row.querySelectorAll("[data-field]")].map((input) => [
        input.dataset.field,
        input.value === "" ? null : Number(input.value),
      ]));
      const min = row.querySelector("[data-range-min-input]")?.value ?? row.dataset.rangeMin;
      return { range_min: min === "" || min == null ? null : Number(min), ...values };
    });
    try {
      await request(`/tier-sets/${set.tier_set_id}/rows`, json("PUT", { rows }));
      await loadRates(state.selectedVersionId);
      message("Calculation tier table saved.", true);
    } catch (error) { message(error.message); }
  }

  function addTierRow(button) {
    const card = button.closest(".tier-set");
    const set = state.data.tierSets.find((item) => String(item.tier_set_id) === card.dataset.tierSetId);
    const columns = [
      "range_max", "value1",
      ...(set.value2_label ? ["value2"] : []),
      ...(set.value3_label ? ["value3"] : []),
    ];
    const row = document.createElement("tr");
    row.innerHTML = `<td><input class="control" type="number" step="any" data-range-min-input aria-label="New range minimum"></td>
      ${columns.map((field) => `<td><input class="control" type="number" step="any" data-field="${field}" aria-label="${field}"></td>`).join("")}
      <td><button type="button" class="engine-action delete" data-remove-tier-row>Remove</button></td>`;
    card.querySelector("tbody").append(row);
  }

  async function saveOption(button) {
    const card = button.closest("[data-option-id]");
    let attributes;
    try {
      attributes = JSON.parse(card.querySelector("[data-option-attributes]").value);
      if (!attributes || Array.isArray(attributes) || typeof attributes !== "object") throw new Error("Attributes must be a JSON object.");
    } catch (error) {
      message(error.message || "Attributes must be valid JSON.");
      return;
    }
    const payload = {
      label: card.querySelector("[data-option-label]").value.trim(),
      sort_order: Number(card.querySelector("[data-option-order]").value),
      is_active: card.querySelector("[data-option-active]").value === "1",
      attributes,
    };
    try {
      await request(`/options/${card.dataset.optionId}`, json("PUT", payload));
      await loadRates(state.selectedVersionId);
      message("Option saved.", true);
    } catch (error) { message(error.message); }
  }

  async function createOption(button) {
    const group = button.closest(".option-group");
    let attributes;
    try {
      attributes = JSON.parse(group.querySelector("[data-new-attributes]").value);
      if (!attributes || Array.isArray(attributes) || typeof attributes !== "object") throw new Error("Attributes must be a JSON object.");
    } catch (error) {
      message(error.message || "Attributes must be valid JSON.");
      return;
    }
    const payload = {
      option_key: group.querySelector("[data-new-key]").value.trim(),
      label: group.querySelector("[data-new-label]").value.trim(),
      attributes,
    };
    try {
      await request(`/option-groups/${group.dataset.groupId}/options`, json("POST", payload));
      await loadRates(state.selectedVersionId);
      message(`Option ${payload.option_key} created.`, true);
    } catch (error) { message(error.message); }
  }

  async function deleteOption(button) {
    const card = button.closest("[data-option-id]");
    const option = state.data.optionsByGroupId[button.closest(".option-group").dataset.groupId]
      .find((item) => String(item.option_id) === card.dataset.optionId);
    if (!window.confirm(`Delete option “${option.label}” from this draft?`)) return;
    try {
      await request(`/options/${card.dataset.optionId}`, { method: "DELETE" });
      await loadRates(state.selectedVersionId);
      message("Option deleted from the draft.", true);
    } catch (error) { message(error.message); }
  }

  async function revertHistory(button) {
    if (!window.confirm("Revert this value? A new quotation-engine version will be created and published.")) return;
    try {
      const result = await request(`/history/${button.dataset.revertAudit}/revert`, json("POST", {}));
      closeHistory();
      await loadRates();
      message(`Reverted in new active version v${result.version_id}.`, true);
    } catch (error) { message(error.message); }
  }

  function closeHistory() {
    $("historyBackdrop").hidden = true;
    $("historyPanel").hidden = true;
  }

  /* ---------- Section navigator (jump + scroll-spy + collapse) ---------- */
  const NAV_COLLAPSE_KEY = "quotationEngineNavCollapsed";
  const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // First matching keyword wins (skipping icons already used). Edit freely.
  const ICON_RULES = [
    [/paper|board|gsm|material|stock/, "bi-layers"],
    [/print|ink|colou?r/, "bi-palette"],
    [/handle|rope|cord|ribbon/, "bi-link-45deg"],
    [/labou?r|worker|staff|manpower/, "bi-people"],
    [/machine|production|speed/, "bi-gear"],
    [/waste|wastage|scrap|spoil/, "bi-recycle"],
    [/margin|profit|markup/, "bi-graph-up-arrow"],
    [/freight|deliver|shipping|transport|lorry/, "bi-truck"],
    [/pack|carton|bundle/, "bi-box-seam"],
    [/tax|sst|gst|vat/, "bi-percent"],
    [/discount|promo/, "bi-tag"],
    [/plate|die|tool|setup|set-up/, "bi-tools"],
    [/lamin|coat|finish|varnish/, "bi-brush"],
    [/glue|adhesive|paste/, "bi-droplet"],
    [/window|emboss|foil|special/, "bi-stars"],
    [/size|dimension|width|height|gusset/, "bi-rulers"],
    [/qty|quantity|moq|volume/, "bi-123"],
    [/cost|price|rate|currency|overhead/, "bi-currency-dollar"],
  ];
  // Used when no keyword matches, so unmatched sections still get distinct icons.
  const ICON_POOL = {
    parameters: ["bi-sliders", "bi-calculator", "bi-cash-coin", "bi-clipboard-data", "bi-speedometer2", "bi-bullseye"],
    tiers: ["bi-table", "bi-bar-chart-steps", "bi-list-ol", "bi-diagram-3", "bi-grid-3x3-gap", "bi-stack"],
    options: ["bi-ui-checks-grid", "bi-toggles", "bi-card-checklist", "bi-puzzle", "bi-collection", "bi-gem"],
  };
  const ICON_DEFAULT = { parameters: "bi-sliders", tiers: "bi-table", options: "bi-ui-checks-grid" };

  const nav = { sections: [], activeId: null, locked: false, lockTimer: null, ticking: false };

  function pickIcon(tab, text, used) {
    const rule = ICON_RULES.find(([pattern, icon]) => pattern.test(text) && !used.has(icon));
    const pooled = (ICON_POOL[tab] || []).find((icon) => !used.has(icon));
    const icon = rule ? rule[1] : (pooled || ICON_DEFAULT[tab] || "bi-dot");
    used.add(icon);
    return icon;
  }

  function buildSectionNav() {
    const cards = state.tab === "components"
      ? []
      : [...$("engineContent").querySelectorAll(":scope > .engine-card")];
    $("engineLayout").classList.toggle("no-nav", cards.length === 0);
    const used = new Set();
    nav.sections = [];
    nav.activeId = null;
    $("sectionNavList").innerHTML = cards.map((card, index) => {
      const raw = card.querySelector("h3")?.textContent.trim() || `Section ${index + 1}`;
      const label = raw.replace(/[_-]+/g, " ");
      const id = `engine-section-${state.tab}-${index}`;
      card.id = id;
      nav.sections.push({ id, card });
      const icon = pickIcon(state.tab, raw.toLowerCase(), used);
      return `<li><button type="button" class="section-nav-item" data-target="${id}" title="${esc(label)}" aria-label="Jump to ${esc(label)}"><i class="bi ${icon}" aria-hidden="true"></i><span>${esc(label)}</span></button></li>`;
    }).join("");
    updateActiveSection();
  }

  function setActiveSection(id) {
    if (nav.activeId === id) return;
    nav.activeId = id;
    const list = $("sectionNavList");
    let activeButton = null;
    list.querySelectorAll(".section-nav-item").forEach((button) => {
      const isActive = button.dataset.target === id;
      button.classList.toggle("active", isActive);
      if (isActive) { button.setAttribute("aria-current", "true"); activeButton = button; }
      else button.removeAttribute("aria-current");
    });
    if (!activeButton) return;
    // keep the highlighted item visible inside the nav's own scroll area
    const top = activeButton.offsetTop;
    const bottom = top + activeButton.offsetHeight;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    if (top < list.scrollTop) list.scrollTo({ top: Math.max(0, top - 8), behavior });
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTo({ top: bottom - list.clientHeight + 8, behavior });
  }

  function updateActiveSection() {
    const visible = nav.sections.filter((section) => !section.card.hidden);
    if (!visible.length) return;
    const offset = 140;
    let current = visible[0];
    for (const section of visible) {
      if (section.card.getBoundingClientRect().top - offset <= 0) current = section;
      else break;
    }
    const scrollable = document.documentElement.scrollHeight > window.innerHeight + 8;
    if (scrollable && window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
      current = visible[visible.length - 1];
    }
    setActiveSection(current.id);
  }

  function releaseNavLock() {
    nav.locked = false;
    updateActiveSection();
  }

  function jumpToSection(id) {
    const card = $(id);
    if (!card) return;
    setActiveSection(id);
    // Hold the highlight on the clicked item while the smooth scroll passes other sections.
    nav.locked = true;
    clearTimeout(nav.lockTimer);
    nav.lockTimer = setTimeout(releaseNavLock, 400);
    if (card.classList.contains("collapsed")) toggleCard(card, false);
    card.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    card.classList.remove("nav-flash");
    void card.offsetWidth; // restart the animation if clicked twice
    card.classList.add("nav-flash");
    card.addEventListener("animationend", () => card.classList.remove("nav-flash"), { once: true });
  }

  function onPageScroll() {
    if (nav.locked) {
      clearTimeout(nav.lockTimer);
      nav.lockTimer = setTimeout(releaseNavLock, 160); // unlock once scrolling stops
      return;
    }
    if (nav.ticking) return;
    nav.ticking = true;
    requestAnimationFrame(() => { nav.ticking = false; updateActiveSection(); });
  }

  function setNavCollapsed(collapsed, persist = true) {
    $("sectionNav").classList.toggle("collapsed", collapsed);
    const toggle = $("sectionNavToggle");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Expand section navigation" : "Collapse section navigation");
    toggle.title = collapsed ? "Expand" : "Collapse";
    if (persist) {
      try { localStorage.setItem(NAV_COLLAPSE_KEY, collapsed ? "1" : "0"); } catch (error) { /* storage unavailable */ }
    }
  }

  $("sectionNavList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-target]");
    if (button) jumpToSection(button.dataset.target);
  });
  $("sectionNavToggle").addEventListener("click", () => {
    setNavCollapsed(!$("sectionNav").classList.contains("collapsed"));
  });
  window.addEventListener("scroll", onPageScroll, { passive: true });
  window.addEventListener("resize", updateActiveSection);

  (function initNavState() {
    let saved = null;
    try { saved = localStorage.getItem(NAV_COLLAPSE_KEY); } catch (error) { /* ignore */ }
    setNavCollapsed(saved === null ? window.matchMedia("(max-width: 760px)").matches : saved === "1", false);
  })();

  /* ================= UX layer ================= */
  const TRACKED = "input.control, select.control, textarea.control";
  const UNTRACKED = "[data-new-key], [data-new-label], [data-new-attributes]";
  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const topCards = () => [...$("engineContent").querySelectorAll(":scope > .engine-card")];

  /* ---- toast / skeleton / busy ---- */
  function toast(text, kind) {
    const stack = $("toastStack");
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.setAttribute("role", kind === "bad" ? "alert" : "status");
    el.innerHTML = `<i class="bi ${kind === "good" ? "bi-check-circle-fill" : "bi-exclamation-triangle-fill"}" aria-hidden="true"></i><span>${esc(text)}</span>`;
    stack.append(el);
    while (stack.children.length > 4) stack.firstElementChild.remove();
    const close = () => { el.classList.add("leaving"); setTimeout(() => el.remove(), 260); };
    el.addEventListener("click", close);
    setTimeout(close, kind === "good" ? 3500 : 7000);
  }

  function showSkeleton() {
    $("engineContent").innerHTML = Array.from({ length: 3 }, () => '<div class="skeleton-card"></div>').join("");
    $("sectionNavList").innerHTML = "";
    nav.sections = [];
    nav.activeId = null;
    state.dirtyIds = [];
    $("dirtyBar").classList.remove("show");
  }

  async function withBusy(button, task) {
    button.classList.add("is-busy");
    button.disabled = true;
    try { await task(); }
    finally {
      if (button.isConnected) { button.classList.remove("is-busy"); button.disabled = false; }
    }
  }

  /* ---- card enhancement (collapse wrapper, tools, locked params, JSON button) ---- */
  function enhanceCards() {
    const content = $("engineContent");
    content.querySelectorAll(":scope > .engine-card").forEach((card) => {
      const head = card.querySelector(":scope > .engine-card-head");
      if (!head || card.querySelector(":scope > .card-collapse")) return;
      const wrap = document.createElement("div");
      wrap.className = "card-collapse";
      const inner = document.createElement("div");
      inner.className = "card-collapse-inner";
      while (head.nextSibling) inner.append(head.nextSibling);
      wrap.append(inner);
      head.after(wrap);
      const tools = document.createElement("div");
      tools.className = "card-head-tools";
      tools.innerHTML = `<span class="dirty-pill"><i class="bi bi-circle-fill" aria-hidden="true"></i> Unsaved</span>
        <button type="button" class="engine-action" data-discard-card title="Discard unsaved changes in this section"><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i> Discard</button>
        <button type="button" class="card-toggle" data-toggle-card aria-expanded="true" aria-label="Collapse or expand section" title="Collapse / expand"><i class="bi bi-chevron-down" aria-hidden="true"></i></button>`;
      const existingHistory = head.querySelector(":scope > [data-history]");
      if (existingHistory) tools.prepend(existingHistory);
      head.append(tools);
    });
    content.querySelectorAll(".parameter-card").forEach((card) => {
      const save = card.querySelector("[data-save-parameter]");
      const input = card.querySelector("[data-value]");
      const blocked = Boolean(save?.disabled);
      card.classList.toggle("is-locked", blocked);
      if (input && blocked) input.disabled = true;
    });
    content.querySelectorAll("textarea[data-option-attributes], textarea[data-new-attributes]").forEach((area) => {
      const label = area.closest("label");
      if (!label || label.nextElementSibling?.matches("[data-format-json]")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "engine-action wide json-format";
      button.setAttribute("data-format-json", "");
      button.innerHTML = '<i class="bi bi-braces" aria-hidden="true"></i> Format JSON';
      button.disabled = area.disabled;
      label.after(button);
    });
  }

  function toggleCard(card, force) {
    if (!card) return;
    const collapsed = force ?? !card.classList.contains("collapsed");
    card.classList.toggle("collapsed", collapsed);
    card.querySelector(":scope > .engine-card-head [data-toggle-card]")?.setAttribute("aria-expanded", String(!collapsed));
    setTimeout(updateActiveSection, 320);
  }

  function formatJson(button) {
    const area = button.previousElementSibling?.querySelector("textarea");
    if (!area) return;
    try {
      area.value = JSON.stringify(JSON.parse(area.value), null, 2);
      area.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (error) {
      setFieldNote(area, "Invalid JSON");
    }
  }

  /* ---- dirty tracking ---- */
  function fieldIsDirty(el) {
    if (el.tagName === "SELECT") return [...el.options].some((option) => option.selected !== option.defaultSelected);
    if (el.type === "number") {
      const now = el.value === "" ? "" : Number(el.value);
      const was = el.defaultValue === "" ? "" : Number(el.defaultValue);
      return now !== was;
    }
    return el.value !== el.defaultValue;
  }

  function refreshCardDirty(card) {
    let dirty = card.dataset.structure === "1";
    card.querySelectorAll(TRACKED).forEach((el) => {
      if (el.matches(UNTRACKED)) return;
      const changed = !el.disabled && fieldIsDirty(el);
      el.classList.toggle("is-dirty", changed);
      if (changed) dirty = true;
    });
    card.classList.toggle("is-dirty", dirty);
    return dirty;
  }

  function refreshDirtyState() {
    const dirtyIds = [];
    topCards().forEach((card) => { if (refreshCardDirty(card)) dirtyIds.push(card.id); });
    state.dirtyIds = dirtyIds;
    $("sectionNavList").querySelectorAll(".section-nav-item").forEach((button) => {
      button.classList.toggle("has-changes", dirtyIds.includes(button.dataset.target));
    });
    $("dirtyBar").classList.toggle("show", dirtyIds.length > 0);
    $("dirtyBarText").textContent = `${dirtyIds.length} section${dirtyIds.length === 1 ? "" : "s"} with unsaved changes`;
  }

  const hasUnsaved = () => (state.dirtyIds || []).length > 0;
  const guardUnsaved = (action) => !hasUnsaved()
    || window.confirm(`You have unsaved changes that will be lost if you ${action}. Continue?`);

  function confirmOtherChanges(scope) {
    const content = $("engineContent");
    const strayFields = [...content.querySelectorAll(".control.is-dirty")].filter((el) => !scope.contains(el)).length;
    const strayStructure = [...content.querySelectorAll(':scope > .engine-card[data-structure="1"]')].filter((card) => !card.contains(scope)).length;
    if (!strayFields && !strayStructure) return true;
    return window.confirm("Saving reloads the data, so your other unsaved edits on this page will be lost. Save anyway?");
  }

  function discardCard(card) {
    const index = topCards().indexOf(card);
    const holder = document.createElement("div");
    holder.innerHTML = TAB_RENDERERS()[state.tab]();
    const fresh = holder.querySelectorAll(":scope > .engine-card")[index];
    if (!fresh) return;
    card.replaceWith(fresh);
    enhanceCards();
    buildSectionNav();
    applySearch();
    refreshDirtyState();
    toast("Changes discarded.", "good");
  }

  /* ---- validation + helpers ---- */
  function setFieldNote(el, problem) {
    el.classList.toggle("is-invalid", Boolean(problem));
    const anchor = el.closest(".tier-edit") || el;
    let note = anchor.nextElementSibling?.matches(".field-note.invalid") ? anchor.nextElementSibling : null;
    if (problem) {
      if (!note) {
        note = document.createElement("small");
        note.className = "field-note invalid";
        anchor.after(note);
      }
      note.textContent = problem;
    } else if (note) note.remove();
  }

  function validateField(el) {
    if (el.matches("[data-range-min-input]")) return true;
    let problem = "";
    if (el.matches("[data-value]") && el.type === "number" && el.value !== "") {
      const n = Number(el.value);
      if (el.min !== "" && n < Number(el.min)) problem = `Must be at least ${el.min}`;
      else if (el.max !== "" && n > Number(el.max)) problem = `Must be at most ${el.max}`;
    } else if (el.matches("[data-option-attributes], [data-new-attributes]")) {
      try {
        const parsed = JSON.parse(el.value);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") problem = "Must be a JSON object";
      } catch (error) { problem = "Invalid JSON"; }
    }
    setFieldNote(el, problem);
    return !problem;
  }

  function validateTierMins(card) {
    if (!card) return;
    const entries = [...card.querySelectorAll("tbody tr")].map((row) => {
      const input = row.querySelector("[data-range-min-input]");
      return { input, key: String(Number(input ? input.value : row.dataset.rangeMin)), empty: input && input.value === "" };
    });
    entries.forEach((entry) => {
      if (!entry.input) return;
      const duplicates = entries.filter((other) => !other.empty && other.key === entry.key).length > 1;
      setFieldNote(entry.input, !entry.empty && duplicates ? "Duplicate range min" : "");
    });
  }

  function validateCard(scope) {
    scope.querySelectorAll("input.control, select.control, textarea.control").forEach((el) => validateField(el));
    validateTierMins(scope.closest(".tier-set"));
    return !scope.querySelector(".is-invalid");
  }

  function updateDelta(el) {
    const card = el.closest("[data-parameter-id]");
    if (!card || el.type !== "number") return;
    let chip = card.querySelector(".delta-chip");
    const before = el.defaultValue === "" ? NaN : Number(el.defaultValue);
    const after = el.value === "" ? NaN : Number(el.value);
    if (!Number.isFinite(before) || !Number.isFinite(after) || before === after) { chip?.remove(); return; }
    if (!chip) {
      chip = document.createElement("div");
      chip.className = "delta-chip";
      card.querySelector(".engine-actions").before(chip);
    }
    const diff = Number((after - before).toFixed(6));
    const pct = before !== 0 ? ` (${diff > 0 ? "+" : ""}${((diff / Math.abs(before)) * 100).toFixed(1)}%)` : "";
    chip.innerHTML = `<i class="bi ${diff > 0 ? "bi-arrow-up-right" : "bi-arrow-down-right"}" aria-hidden="true"></i> Was ${esc(before)} · ${diff > 0 ? "+" : ""}${diff}${pct}`;
  }

  function afterTierRowAdded(card) {
    const rows = card.querySelectorAll("tbody tr");
    const row = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    const minInput = row.querySelector("[data-range-min-input]");
    const prevMax = prev?.querySelector('[data-field="range_max"]')?.value;
    if (minInput && prevMax) minInput.value = prevMax;
    row.classList.add("row-new");
    card.dataset.structure = "1";
    validateTierMins(card);
    refreshDirtyState();
    row.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    (prevMax ? row.querySelector('[data-field="range_max"]') : minInput)?.focus({ preventScroll: true });
  }

  function handleFieldEvent(event) {
    const el = event.target;
    if (!el.matches?.(TRACKED)) return;
    if (el.matches("[data-new-key]")) {
      el.dataset.touched = "1";
      const cleaned = slug(el.value);
      if (cleaned !== el.value) el.value = cleaned;
    } else if (el.matches("[data-new-label]")) {
      const key = el.closest(".option-create")?.querySelector("[data-new-key]");
      if (key && !key.dataset.touched) key.value = slug(el.value).replace(/^_+|_+$/g, "");
    }
    validateField(el);
    if (el.matches("[data-range-min-input]")) validateTierMins(el.closest(".tier-set"));
    updateDelta(el);
    refreshDirtyState();
  }

  /* ---- search ---- */
  function applySearch() {
    const query = $("engineSearch").value.trim().toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    const content = $("engineContent");
    content.classList.toggle("is-searching", tokens.length > 0);
    const matches = (el) => { const text = el.textContent.toLowerCase(); return tokens.every((t) => text.includes(t)); };
    const cards = topCards();
    let total = 0;
    let shown = 0;
    cards.forEach((card) => {
      const items = [...card.querySelectorAll(".parameter-card, .option-card")];
      const titleBlock = card.querySelector(":scope > .engine-card-head > div:first-child");
      const headHit = !tokens.length || (titleBlock ? matches(titleBlock) : false);
      let visible;
      if (!items.length) {
        visible = headHit || matches(card);
      } else {
        items.forEach((item) => { item.hidden = !(headHit || matches(item)); });
        const visibleItems = items.filter((item) => !item.hidden).length;
        visible = visibleItems > 0;
        total += items.length;
        shown += visibleItems;
      }
      card.hidden = !visible;
    });
    const visibleCards = cards.filter((card) => !card.hidden).length;
    $("searchCount").textContent = tokens.length
      ? (total ? `${shown} of ${total} match` : `${visibleCards} of ${cards.length} match`)
      : "";
    $("searchEmpty").hidden = !(tokens.length && cards.length && visibleCards === 0);
    nav.sections.forEach((section) => {
      const li = $("sectionNavList").querySelector(`[data-target="${section.id}"]`)?.parentElement;
      if (li) li.hidden = section.card.hidden;
    });
    updateActiveSection();
  }

  /* ---- listeners (these replace the three old ones) ---- */
  $("versionSelect").addEventListener("change", async (event) => {
    if (!guardUnsaved("switch version")) { renderVersionControls(); return; }
    try {
      await loadRates(Number(event.target.value));
      message("");
    } catch (error) { message(error.message); }
  });

  $("engineTabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (!button || button.dataset.tab === state.tab) return;
    if (!guardUnsaved("switch tabs")) return;
    state.tab = button.dataset.tab;
    state.animate = true;
    renderTab();
  });

  $("engineContent").addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const card = button.closest("#engineContent > .engine-card");
    if (button.hasAttribute("data-toggle-card")) return toggleCard(card);
    if (button.hasAttribute("data-discard-card")) return discardCard(card);
    if (button.hasAttribute("data-format-json")) return formatJson(button);
    if (button.dataset.history) return showHistory(button.dataset.history);
    if (button.hasAttribute("data-add-tier-row")) {
      addTierRow(button);
      afterTierRowAdded(card);
      return;
    }
    if (button.hasAttribute("data-remove-tier-row")) {
      button.closest("tr").remove();
      card.dataset.structure = "1";
      validateTierMins(card);
      refreshDirtyState();
      return;
    }
    const action = [
      ["data-save-parameter", saveParameter],
      ["data-save-tier", saveTier],
      ["data-save-option", saveOption],
      ["data-create-option", createOption],
      ["data-delete-option", deleteOption],
    ].find(([attribute]) => button.hasAttribute(attribute));
    if (!action) return;
    const scope = button.closest("[data-parameter-id], [data-option-id], .tier-set, .option-create") || card;
    if (action[0] !== "data-delete-option" && !validateCard(scope)) {
      message("Please fix the highlighted fields first.");
      scope.querySelector(".is-invalid")?.focus();
      return;
    }
    if (!confirmOtherChanges(scope)) return;
    await withBusy(button, () => action[1](button));
  });

  ["input", "change"].forEach((type) => $("engineContent").addEventListener(type, handleFieldEvent));
  $("engineContent").addEventListener("wheel", (event) => {
    // stop accidental number changes while scrolling the page
    if (event.target.matches?.('input[type="number"]') && document.activeElement === event.target) event.target.blur();
  }, { passive: true });

  $("engineSearch").addEventListener("input", applySearch);
  $("collapseAll").addEventListener("click", () => topCards().forEach((card) => toggleCard(card, true)));
  $("expandAll").addEventListener("click", () => topCards().forEach((card) => toggleCard(card, false)));
  $("dirtyJump").addEventListener("click", () => { if (state.dirtyIds?.[0]) jumpToSection(state.dirtyIds[0]); });
  $("dirtyDiscard").addEventListener("click", () => {
    if (window.confirm("Discard all unsaved changes on this tab?")) { renderTab(); toast("Changes discarded.", "good"); }
  });
  $("backToTop").addEventListener("click", () => window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" }));
  window.addEventListener("scroll", () => $("backToTop").classList.toggle("show", window.scrollY > 600), { passive: true });
  window.addEventListener("beforeunload", (event) => {
    if (hasUnsaved()) { event.preventDefault(); event.returnValue = ""; }
  });

  document.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && key === "k") {
      event.preventDefault();
      $("engineSearch").focus();
      $("engineSearch").select();
      return;
    }
    if (mod && key === "s") {
      event.preventDefault();
      const scope = document.activeElement?.closest?.("[data-parameter-id], [data-option-id], .tier-set");
      const save = scope?.querySelector("[data-save-parameter], [data-save-option], [data-save-tier]");
      if (save && !save.disabled) save.click();
      else toast("Click into a field of the section you want to save, then press Ctrl+S.", "bad");
      return;
    }
    if (event.key === "Enter" && event.target.matches?.("[data-parameter-id] input[data-value]")) {
      event.preventDefault();
      event.target.closest("[data-parameter-id]").querySelector("[data-save-parameter]:not(:disabled)")?.click();
      return;
    }
    if (event.key === "Escape") {
      const el = event.target;
      if (el === $("engineSearch")) {
        if (el.value) { el.value = ""; applySearch(); } else el.blur();
      } else if (!$("historyPanel").hidden) {
        closeHistory();
      } else if (el.matches?.("#engineContent input.control") && fieldIsDirty(el)) {
        el.value = el.defaultValue;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  });

  $("historyEntries").addEventListener("click", (event) => {
    const button = event.target.closest("[data-revert-audit]");
    if (button) revertHistory(button);
  });
  $("versionSelect").addEventListener("change", (event) => { event.target.blur(); });
  $("cloneVersion").addEventListener("click", cloneSelected);
  $("versionHistory").addEventListener("click", () => showHistory(`version:${state.selectedVersionId}`));
  $("publishVersion").addEventListener("click", publishSelected);
  $("restoreVersion").addEventListener("click", restoreSelected);
  $("closeHistory").addEventListener("click", closeHistory);
  $("historyBackdrop").addEventListener("click", closeHistory);
  $("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("user");
    sessionStorage.removeItem("user");
    location.href = "/login.html";
  });
  try {
    const raw = localStorage.getItem("user") || sessionStorage.getItem("user");
    const user = raw ? JSON.parse(raw) : null;
    $("adminName").textContent = user?.user_name || user?.name || user?.user_email || "";
  } catch (error) {
    console.error("Unable to display staff profile.", error);
  }
  loadRates().catch((error) => message(error.message));
})();
