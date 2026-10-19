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
    $("engineMessage").textContent = text;
    $("engineMessage").className = `engine-message${success ? " good" : ""}`;
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

  function renderTab() {
    if (!state.data) return;
    document.querySelectorAll(".engine-tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === state.tab);
    });
    const renderers = {
      parameters: renderParameters,
      tiers: renderTiers,
      options: renderOptions,
      components: renderComponents,
    };
    $("engineContent").innerHTML = renderers[state.tab]();
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
            ? `${esc(payload.beforeValue)} → ${esc(payload.afterValue)}`
            : payload.kind === "option" || payload.kind === "tier_row"
              ? `${esc(JSON.stringify(payload.before))} → ${esc(JSON.stringify(payload.after))}`
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
  }

  async function publishSelected() {
    if (!window.confirm("Publish this draft? It becomes the active rate version used for new quotations.")) return;
    try {
      await request(`/versions/${state.selectedVersionId}/publish`, json("POST", {}));
      await loadRates();
      message("Draft published and now active.", true);
    } catch (error) { message(error.message); }
  }

  async function restoreSelected() {
    if (!window.confirm("Restore this historical version as active? The current version will remain archived and can be restored later.")) return;
    try {
      await request(`/versions/${state.selectedVersionId}/restore`, json("POST", {}));
      await loadRates();
      message(`Quotation engine restored to v${state.activeVersionId}.`, true);
    } catch (error) { message(error.message); }
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

  $("versionSelect").addEventListener("change", async (event) => {
    try {
      await loadRates(Number(event.target.value));
      message("");
    } catch (error) { message(error.message); }
  });
  $("engineTabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (!button) return;
    state.tab = button.dataset.tab;
    renderTab();
  });
  $("engineContent").addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.history) return showHistory(button.dataset.history);
    if (button.hasAttribute("data-save-parameter")) return saveParameter(button);
    if (button.hasAttribute("data-save-tier")) return saveTier(button);
    if (button.hasAttribute("data-add-tier-row")) return addTierRow(button);
    if (button.hasAttribute("data-remove-tier-row")) {
      button.closest("tr").remove();
      return;
    }
    if (button.hasAttribute("data-save-option")) return saveOption(button);
    if (button.hasAttribute("data-create-option")) return createOption(button);
    if (button.hasAttribute("data-delete-option")) return deleteOption(button);
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
