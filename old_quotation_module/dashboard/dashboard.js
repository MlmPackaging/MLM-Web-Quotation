const dashboardState = {
  user: null,
  quotations: [],
  loading: true,
  error: "",
  selectedQuotation: null,
  activeSection: "overview",
};

let currentSort = { column: null, direction: "asc" };

const DASHBOARD_ACTION_SELECTOR = [
  ".row-button[data-action='download']",
  ".row-button[data-action='submit']",
  ".row-button[data-action='delete']",
  "#modal-download-button",
  "#modal-submit-button",
  "#modal-delete-button",
].join(", ");

function setActionButtonsDisabled(selector, disabled) {
  document.querySelectorAll(selector).forEach((button) => {
    button.disabled = disabled;
  });
}

async function withButtonLoading(button, loadingText, action) {
  if (!button || button.disabled) return;

  const originalContent = button.innerHTML;
  setActionButtonsDisabled(DASHBOARD_ACTION_SELECTOR, true);
  button.dataset.loading = "true";
  button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${loadingText}</span>`;

  try {
    return await action();
  } finally {
    setActionButtonsDisabled(DASHBOARD_ACTION_SELECTOR, false);
    button.dataset.loading = "false";
    button.innerHTML = originalContent;
  }
}

function getSortValue(quotation, column) {
  const dims = quotation.quotation_data?.input?.dimensions || {};
  switch (column) {
    case "quotationNumber": return quotation.quotation_number || "";
    case "width": return Number(dims.width || 0);
    case "height": return Number(dims.height || 0);
    case "gusset": return Number(dims.gusset || 0);
    case "totalAmount": return Number(quotation.total_amount || 0);
    case "status": return quotation.status || "";
    case "createdAt": return new Date(quotation.created_at).getTime() || 0;
    case "updatedAt": return new Date((quotation.updated_at || "").replace(" ", "T")).getTime() || 0;
    default: return "";
  }
}

function applySort(quotations) {
  if (!currentSort.column) return quotations;
  const dir = currentSort.direction === "asc" ? 1 : -1;
  return [...quotations].sort((a, b) => {
    const valA = getSortValue(a, currentSort.column);
    const valB = getSortValue(b, currentSort.column);
    if (valA < valB) return -1 * dir;
    if (valA > valB) return 1 * dir;
    return 0;
  });
}

function handleSort(column) {
  if (currentSort.column === column) {
    currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
  } else {
    currentSort.column = column;
    currentSort.direction = "asc";
  }
  updateHeaderSortUI();
  renderQuotationTable(dashboardState.quotations);
}

function updateHeaderSortUI() {
  document.querySelectorAll("#dashboard-table-wrap thead th").forEach((th) => {
    th.classList.remove("active-sort");
    const onclick = th.getAttribute("onclick") || "";
    const match = onclick.match(/handleSort\(['"](\w+)['"]\)/);
    const icon = th.querySelector(".sort-icon");
    if (!match || !icon) return;
    if (currentSort.column === match[1]) {
      th.classList.add("active-sort");
      icon.textContent = currentSort.direction === "asc" ? "▲" : "▼";
    } else {
      icon.textContent = "↕";
    }
  });
}

document.addEventListener("DOMContentLoaded", initDashboard);

async function initDashboard() {
  bindStaticEvents();
  await fetchDashboardData();
  colMgr.init();
  setupTableDragScroll();
}

function bindStaticEvents() {
  document.getElementById("dashboard-new-quotation").addEventListener("click", () => {
    window.location.href = "/quotation-form/quotation-create.html";
  });

  document.getElementById("quotation-modal-close").addEventListener("click", closeQuotationModal);
  document.querySelectorAll('[data-close-modal="true"]').forEach((element) => {
    element.addEventListener("click", closeQuotationModal);
  });

  document.getElementById("quotation-modal-tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-section]");
    if (!tab || !dashboardState.selectedQuotation) return;
    dashboardState.activeSection = tab.dataset.section;
    syncActiveTab();
    renderQuotationDetailsTab();
  });

  document.getElementById("modal-download-button").addEventListener("click", downloadSelectedQuotationPDF);
  document.getElementById("modal-submit-button").addEventListener("click", submitSelectedQuotation);
  document.getElementById("modal-delete-button").addEventListener("click", deleteSelectedQuotation);
}

function getCurrentUserPayload() {
  const user = typeof window.getCurrentUser === "function" ? window.getCurrentUser() : null;
  return {
    id: user?.user_id || user?.id || "",
    email: user?.user_email || user?.email || "",
    phone: user?.user_phone || user?.phone || "",
    role: user?.role || "User",
    contact_person: user?.user_name || user?.contact_person || user?.name || "User",
    company_name: user?.company_name || user?.company || user?.user_name || user?.user_email || "MLM Customer",
    address: user?.address || "",
  };
}

async function fetchDashboardData() {
  setLoading(true);
  clearError();

  try {
    const requester = getCurrentUserPayload();
    const params = new URLSearchParams({
      userId: requester.id,
      email: requester.email,
      role: requester.role,
      contactPerson: requester.contact_person,
      companyName: requester.company_name,
      phone: requester.phone,
      address: requester.address,
    });

    let response, data;
    let isApiFallback = false;

    try {
      // Try API first
      response = await fetch(`/api/quotations/dashboard?${params.toString()}`);
      const responseText = await response.text();

      // Check if response is HTML (404 page) instead of JSON
      if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
        throw new Error('API not available, using static data');
      }

      data = JSON.parse(responseText);
    } catch (apiError) {
      // Fallback to static JSON file
      console.log('API unavailable, loading static data:', apiError.message);
      isApiFallback = true;
      response = await fetch('/api/quotations/dashboard.json');
      data = await response.json();
    }

    if (!response.ok && !data) {
      throw new Error(data?.error || "Failed to load dashboard data");
    }

    dashboardState.user = data.user;

    // Only use static quotations from API/JSON
    // Use localStorage only if API failed completely
    const staticQuotations = data.quotations || [];
    
    if (isApiFallback) {
      // If API failed, use localStorage as additional fallback
      const localQuotations = JSON.parse(localStorage.getItem('localQuotations') || '[]');
      dashboardState.quotations = [...staticQuotations, ...localQuotations];
    } else {
      // If API succeeded, use ONLY database quotations
      dashboardState.quotations = staticQuotations;
      // Clear localStorage since we have database data now
      localStorage.removeItem('localQuotations');
    }

    renderDashboard();
  } catch (error) {
    showError(error.message || "Unable to load dashboard");
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading) {
  dashboardState.loading = isLoading;
  document.getElementById("dashboard-loading").classList.toggle("is-hidden", !isLoading);
  document.getElementById("dashboard-main").classList.toggle("is-hidden", isLoading);
}

function showError(message) {
  dashboardState.error = message;
  showToast(message, "error");
}

function clearError() {
  dashboardState.error = "";
}

function renderDashboard() {
  renderUserCard();
  renderDashboardStats(calculateStats(dashboardState.quotations));
  renderQuotationTable(dashboardState.quotations);
}

function renderUserCard() {
  const user = dashboardState.user;
  const card = document.getElementById("dashboard-user-card");

  if (!user) {
    card.innerHTML = "";
    return;
  }

  card.innerHTML = `
    <div class="avatar">${escapeHtml(String(user.contact_person || "U").charAt(0).toUpperCase())}</div>
    <div>
      <strong>${escapeHtml(user.contact_person || "User")}</strong>
      <div class="subtext">${escapeHtml(user.company_name || "MLM Customer")}</div>
    </div>
  `;
}

function calculateStats(quotations) {
  return {
    total: quotations.length,
    drafts: quotations.filter((item) => item.status === "draft").length,
    submitted: quotations.filter((item) => item.status === "submitted" || item.status === "reviewed").length,
    approved: quotations.filter((item) => item.status === "approved").length,
  };
}

function renderDashboardStats(stats) {
  const container = document.getElementById("dashboard-stats");
  const cards = [
    { label: "Total Quotations", value: stats.total, icon: "bi-card-checklist", iconBg: "#dbeafe", iconColor: "#1d4ed8" },
    { label: "Drafts", value: stats.drafts, icon: "bi-pencil-square", iconBg: "#fef9c3", iconColor: "#a16207" },
    { label: "Submitted", value: stats.submitted, icon: "bi-send-check", iconBg: "#dcfce7", iconColor: "#15803d" },
    { label: "Approved", value: stats.approved, icon: "bi-patch-check-fill", iconBg: "#f3e8ff", iconColor: "#7c3aed" },
  ];

  container.innerHTML = cards.map((card) => `
    <article class="stat-card">
      <div class="stat-icon" style="background:${card.iconBg};color:${card.iconColor}">
        <i class="bi ${card.icon}"></i>
      </div>
      <p class="eyebrow">${escapeHtml(card.label)}</p>
      <div class="stat-value">${card.value}</div>
      <p class="stat-label">${escapeHtml(getStatCaption(card.label, card.value))}</p>
    </article>
  `).join("");
}

function getStatCaption(label, value) {
  if (label === "Approved") return value > 0 ? "Ready for follow-up" : "No approvals yet";
  if (label === "Submitted") return value > 0 ? "Awaiting review" : "Nothing pending";
  if (label === "Drafts") return value > 0 ? "Can be completed later" : "All clear";
  return "Live storage";
}

function renderQuotationTable(quotations) {
  const tableWrap = document.getElementById("dashboard-table-wrap");
  const emptyState = document.getElementById("dashboard-empty-state");
  const tbody = document.getElementById("quotation-table-body");
  const pill = document.getElementById("quotation-count-pill");

  pill.textContent = `${quotations.length} quotations`;

  if (!quotations.length) {
    emptyState.classList.remove("is-hidden");
    tableWrap.classList.add("is-hidden");
    tbody.innerHTML = "";
    return;
  }

  emptyState.classList.add("is-hidden");
  tableWrap.classList.remove("is-hidden");
  const sorted = applySort(quotations);
  tbody.innerHTML = sorted.map((quotation) => {
    const dims = quotation.quotation_data?.input?.dimensions || {};
    return `
      <tr>
        <td data-col-key="quotationNumber">${escapeHtml(quotation.quotation_number)}</td>
        <td data-col-key="width">${dims.width != null ? escapeHtml(String(dims.width)) : "—"}</td>
        <td data-col-key="height">${dims.height != null ? escapeHtml(String(dims.height)) : "—"}</td>
        <td data-col-key="gusset">${dims.gusset != null ? escapeHtml(String(dims.gusset)) : "—"}</td>
        <td data-col-key="totalAmount">RM ${formatCurrency(quotation.total_amount)}</td>
        <td data-col-key="status"><span class="status-badge ${getStatusClass(quotation.status)}">${escapeHtml(capitalize(quotation.status))}</span></td>
        <td data-col-key="createdAt">${formatDate(quotation.created_at)}</td>
        <td data-col-key="updatedAt">${formatLastUpdated(quotation.updated_at)}</td>
        <td data-col-key="actions">
          <div class="row-actions">
            <button class="row-button" type="button" data-action="view" data-id="${quotation.id}">View</button>
            <button class="row-button" type="button" data-action="download" data-id="${quotation.id}">PDF</button>
            ${quotation.status === "draft" ? `<button class="row-button" type="button" data-action="submit" data-id="${quotation.id}">Submit</button>` : ""}
            ${quotation.status === "draft" ? `<button class="row-button" type="button" data-action="delete" data-id="${quotation.id}">Delete</button>` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", handleTableAction);
  });

  colMgr.refresh();
}

function handleTableAction(event) {
  const button = event.currentTarget;
  const id = Number(event.currentTarget.dataset.id);
  const action = event.currentTarget.dataset.action;
  const quotation = dashboardState.quotations.find((item) => item.id === id);
  if (!quotation) return;

  if (action === "view") {
    openQuotationModal(quotation);
    return;
  }

  if (action === "download") {
    downloadQuotationPDF(quotation, button);
    return;
  }

  if (action === "submit") {
    updateQuotationStatus(id, "submitted", button);
    return;
  }

  if (action === "delete") {
    deleteQuotation(id, button);
  }
}

function openQuotationModal(quotation) {
  dashboardState.selectedQuotation = quotation;
  dashboardState.activeSection = "overview";
  syncActiveTab();
  document.body.classList.add("modal-open");

  document.getElementById("quotation-modal-title").textContent = quotation.quotation_number;
  document.getElementById("quotation-modal-status").innerHTML = `
    <span class="status-badge ${getStatusClass(quotation.status)}">${escapeHtml(capitalize(quotation.status))}</span>
    <span class="subtext">Created ${formatDate(quotation.created_at)}</span>
  `;

  document.getElementById("modal-submit-button").classList.toggle("is-hidden", quotation.status !== "draft");
  document.getElementById("modal-delete-button").classList.toggle("is-hidden", quotation.status !== "draft");

  renderQuotationDetailsTab();
  document.getElementById("quotation-modal").classList.remove("is-hidden");
}

function closeQuotationModal() {
  dashboardState.selectedQuotation = null;
  document.getElementById("quotation-modal").classList.add("is-hidden");
  document.body.classList.remove("modal-open");
}

function syncActiveTab() {
  document.querySelectorAll("#quotation-modal-tabs .tab-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.section === dashboardState.activeSection);
  });
}

function renderQuotationDetailsTab() {
  const quotation = dashboardState.selectedQuotation;
  if (!quotation) return;

  const user = dashboardState.user || {};
  const data = quotation.quotation_data || {};
  const content = document.getElementById("quotation-modal-content");

  if (dashboardState.activeSection === "specs") {
    content.innerHTML = renderSpecsSection(data);
    return;
  }

  if (dashboardState.activeSection === "pricing") {
    content.innerHTML = renderPricingSection(data, quotation);
    return;
  }

  if (dashboardState.activeSection === "company") {
    content.innerHTML = renderCompanySection(user);
    return;
  }

  content.innerHTML = `
    <div class="overview-stack">
      ${renderCompanySection(user)}
      ${renderSpecsSection(data)}
      ${renderPricingSection(data, quotation)}
    </div>
  `;
}

function renderCompanySection(user) {
  return `
    <section class="detail-card detail-card--blue">
      <div class="section-heading">
        <div class="section-bar section-bar--blue"></div>
        <h4>Company Information</h4>
      </div>
      <div class="company-grid">
        <div class="company-sub-card company-sub-card--blue">
          <p class="sub-card-label sub-card-label--blue">Company Details</p>
          <div class="detail-list">
            <div class="detail-row"><span>Company Name:</span><strong>${escapeHtml(user.company_name || "MLM Customer")}</strong></div>
            <div class="detail-row"><span>Contact Person:</span><strong>${escapeHtml(user.contact_person || "User")}</strong></div>
          </div>
        </div>
        <div class="company-sub-card company-sub-card--green">
          <p class="sub-card-label sub-card-label--green">Contact Information</p>
          <div class="detail-list">
            <div class="detail-row"><span>Email:</span><strong>${escapeHtml(user.email || "-")}</strong></div>
            <div class="detail-row"><span>Phone:</span><strong>${escapeHtml(user.phone || "Not provided")}</strong></div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderSpecsSection(data) {
  const input = data.input || {};
  const dimensions = input.dimensions || {};
  const tiles = [
    { icon: "bi-arrows-fullscreen", iconClass: "spec-blue", label: "Width", value: `${dimensions.width || "-"} mm` },
    { icon: "bi-distribute-vertical", iconClass: "spec-green", label: "Height", value: `${dimensions.height || "-"} mm` },
    { icon: "bi-layout-sidebar-inset", iconClass: "spec-purple", label: "Gusset", value: `${dimensions.gusset || "-"} mm` },
    { icon: "bi-stack", iconClass: "spec-orange", label: "Quantity", value: `${Number(input.quantity || 0).toLocaleString()} pcs` },
  ];

  return `
    <section class="detail-card detail-card--green">
      <div class="section-heading">
        <div class="section-bar section-bar--green"></div>
        <h4>Product Specifications</h4>
      </div>
      <div class="spec-tiles">
        ${tiles.map((tile) => `
          <div class="spec-tile">
            <div class="spec-icon ${tile.iconClass}"><i class="bi ${tile.icon}"></i></div>
            <p class="spec-tile-label">${escapeHtml(tile.label)}</p>
            <p class="spec-tile-value">${escapeHtml(tile.value)}</p>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderPricingSection(data, quotation) {
  const summary = data.summary || {};
  const costs = (data.calculations && data.calculations.costs) || {};
  const marginIndex = Number(summary.marginIndex || 0);
  const margin = marginIndex ? ((1 - marginIndex) * 100).toFixed(1) : "0.0";

  const priceTiles = [
    { label: "Total Cost", value: `RM ${formatCurrency(summary.totalCost)}`, colorClass: "price-label--gray" },
    { label: "Unit Cost", value: `RM ${formatUnit(summary.unitCost)}`, colorClass: "price-label--blue" },
    { label: "Unit Selling", value: `RM ${formatUnit(summary.unitSellingPrice)}`, colorClass: "price-label--purple" },
    { label: "Total Selling", value: `RM ${formatCurrency(quotation.total_amount)}`, colorClass: "price-label--green" },
  ];

  const costRows = Object.entries(costs).map(([key, value]) => `
    <div class="detail-row">
      <span>${escapeHtml(getCostLabel(key))}</span>
      <span class="dot-fill" aria-hidden="true"></span>
      <strong>RM ${formatCurrency(value)}</strong>
    </div>
  `).join("");

  return `
    <section class="detail-card detail-card--yellow">
      <div class="section-heading">
        <div class="section-bar section-bar--yellow"></div>
        <h4>Pricing Summary</h4>
      </div>
      <div class="price-tiles">
        ${priceTiles.map((tile) => `
          <div class="price-tile">
            <p class="price-tile-label ${tile.colorClass}">${escapeHtml(tile.label)}</p>
            <p class="price-tile-value">${escapeHtml(tile.value)}</p>
          </div>
        `).join("")}
      </div>
      <div class="margin-box">
        <p class="margin-label">Profit Margin</p>
        <p class="margin-value">${margin}%</p>
      </div>
      ${costRows ? `<div class="detail-list cost-list" style="margin-top:18px;">${costRows}</div>` : ""}
    </section>
  `;
}

async function updateQuotationStatus(id, status, button = null) {
  const runUpdate = async () => {
  try {
    clearError();
    const requester = getCurrentUserPayload();

    try {
      // Try API first
      const response = await fetch(`/api/quotations/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, requester }),
      });
      const responseText = await response.text();

      // Check if response is HTML (404 page) instead of JSON
      if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
        throw new Error('API not available, using local storage');
      }

      const data = JSON.parse(responseText);

      if (!response.ok) {
        throw new Error(data.error || "Failed to update quotation status");
      }

      dashboardState.quotations = data.quotations || [];
    } catch (apiError) {
      // Fallback to localStorage update
      console.log('API unavailable, updating localStorage:', apiError.message);

      const localQuotations = JSON.parse(localStorage.getItem('localQuotations') || '[]');
      const quotationIndex = localQuotations.findIndex(q => q.id == id);

      if (quotationIndex !== -1) {
        localQuotations[quotationIndex].status = status;
        localQuotations[quotationIndex].updated_at = new Date().toISOString();
        localStorage.setItem('localQuotations', JSON.stringify(localQuotations));

        // Reload dashboard data
        await fetchDashboardData();
        return;
      } else {
        throw new Error('Quotation not found in local storage');
      }
    }

    renderDashboard();

    const updated = dashboardState.quotations.find((item) => item.id === id);
  if (updated && dashboardState.selectedQuotation && dashboardState.selectedQuotation.id === id) {
      openQuotationModal(updated);
    } else {
      closeQuotationModal();
    }
  } catch (error) {
    showToast(error.message || "Unable to update quotation", "error");
  }
  };

  if (button) {
    return withButtonLoading(button, "Submitting...", runUpdate);
  }

  return runUpdate();
}

async function deleteQuotation(id, button = null) {
  const shouldDelete = await showDeleteWarningModal();
  if (!shouldDelete) return;

  const runDelete = async () => {
  try {
    clearError();
    const requester = getCurrentUserPayload();

    try {
      // Try API first
      const response = await fetch(`/api/quotations/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requester }),
      });
      const responseText = await response.text();

      // Check if response is HTML (404 page) instead of JSON
      if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
        throw new Error('API not available, using local storage');
      }

      const data = JSON.parse(responseText);

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete quotation");
      }

      dashboardState.quotations = data.quotations || [];
    } catch (apiError) {
      // Fallback to localStorage delete
      console.log('API unavailable, deleting from localStorage:', apiError.message);

      const localQuotations = JSON.parse(localStorage.getItem('localQuotations') || '[]');
      const filteredQuotations = localQuotations.filter(q => q.id != id);

      if (filteredQuotations.length !== localQuotations.length) {
        localStorage.setItem('localQuotations', JSON.stringify(filteredQuotations));

        // Reload dashboard data
        await fetchDashboardData();
        return;
      } else {
        throw new Error('Quotation not found in local storage');
      }
    }

    renderDashboard();
    showToast("Draft quotation deleted successfully", "success");
    if (dashboardState.selectedQuotation && dashboardState.selectedQuotation.id === id) {
      closeQuotationModal();
    }
  } catch (error) {
    showToast(error.message || "Unable to delete quotation", "error");
  }
  };

  if (button) {
    return withButtonLoading(button, "Deleting...", runDelete);
  }

  return runDelete();
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
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

function showDeleteWarningModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "custom-modal-overlay";
    overlay.style = `
      position:fixed; top:0; left:0; width:100%; height:100%;
      background:rgba(15, 23, 42, 0.65); z-index:20000;
      display:flex; align-items:center; justify-content:center;
      padding:20px; backdrop-filter: blur(4px);
    `;

    const box = document.createElement("div");
    box.style = `
      background:white; padding:28px; border-radius:16px;
      width:100%; max-width:560px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      border: 1px solid #f1f5f9;
    `;

    box.innerHTML = `
      <h3 style="margin:0 0 10px 0; font-size:1.25rem; color:#0f172a; font-weight:700;">Delete Draft</h3>
      <div style="margin:0 0 24px 0; font-size:0.95rem; color:#64748b; line-height:1.6;">
        Are you sure you want to delete this draft quotation? This action cannot be undone.
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px; flex-wrap:wrap;">
        <button id="deleteCancel" style="padding:10px 18px; background:#fff; color:#64748b; border:1px solid #e2e8f0; border-radius:8px; cursor:pointer; font-weight:600;">Cancel</button>
        <button id="deleteConfirm" style="padding:10px 18px; background:#ef4444; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600;">Delete</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = (value) => {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(value);
    };

    document.getElementById('deleteCancel').onclick = () => close(false);
    document.getElementById('deleteConfirm').onclick = () => close(true);
  });
}

function submitSelectedQuotation(event) {
  if (!dashboardState.selectedQuotation) return;
  updateQuotationStatus(dashboardState.selectedQuotation.id, "submitted", event?.currentTarget);
}

function deleteSelectedQuotation(event) {
  if (!dashboardState.selectedQuotation) return;
  deleteQuotation(dashboardState.selectedQuotation.id, event?.currentTarget);
}

function downloadSelectedQuotationPDF(event) {
  if (!dashboardState.selectedQuotation) return;
  downloadQuotationPDF(dashboardState.selectedQuotation, event?.currentTarget);
}

async function downloadQuotationPDF(quotation, button = null) {
  const runDownload = async () => {
  try {
    const requester = getCurrentUserPayload();
    const params = new URLSearchParams({
      userId: requester.id,
      email: requester.email,
      scope: "user",
    });

    try {
      // Try API first
      const response = await fetch(`/api/quotations/${quotation.id}/export?${params.toString()}`);
      const contentType = response.headers.get("content-type") || "";

      // Check if response is HTML (404 page)
      if (contentType.includes("text/html")) {
        throw new Error('API not available, using client-side PDF generation');
      }

      if (!response.ok) {
        throw new Error("Failed to generate PDF");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `quotation-${quotation.quotation_number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (apiError) {
      // Use client-side PDF generation
      console.log('Using client-side PDF generation:', apiError.message);
      downloadClientSidePDF(quotation);
    }
  } catch (error) {
    showError(error.message || "PDF export failed.");
  }
  };

  if (button) {
    return withButtonLoading(button, "Generating PDF...", runDownload);
  }

  return runDownload();
}

function getCostLabel(code) {
  const labels = {
    P1: "Paper Cost",
    P2: "Printing Cost",
    P3: "Plate Cost",
    P4: "Ink Cost",
    P5: "Protection Varnish",
    P6: "Lamination",
    P7: "Spot UV",
    P8: "Stamping",
    P9: "Embossing",
    P10: "Texture Embossing",
    P11: "Die Cut",
    P12: "Die Cut Moulding",
    P13: "Handles",
    P14: "Reinforcement Board",
    P15: "Converting Labor",
    P16: "Packaging",
    P17: "Logistics",
    P18: "Mock Up",
  };

  return labels[code] || code;
}

function getStatusClass(status) {
  return `status-${status || "draft"}`;
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatUnit(value) {
  return Number(value || 0).toFixed(4);
}

function formatLastUpdated(dateString) {
  if (!dateString) return '<span class="lu-text">Not updated</span>';
  const ms = new Date(dateString.replace(' ', 'T')).getTime();
  if (isNaN(ms)) return '<span class="lu-text">Not updated</span>';
  const now = Date.now();
  const diffMs = now - ms;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const dateStr = `${dd}/${mm}/${yyyy}`;

  let relText;
  if (diffMin < 1) {
    return '<span class="lu-text">Updated just now</span>';
  } else if (diffMin < 60) {
    relText = `Updated ${diffMin} min${diffMin === 1 ? '' : 's'} ago`;
  } else if (diffHours < 48) {
    relText = `Updated ${diffHours} hr${diffHours === 1 ? '' : 's'} ago`;
  } else if (diffDays < 7) {
    relText = `Updated ${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  } else if (diffDays === 7) {
    relText = `Updated 1 week ago`;
  } else if (diffDays < 14) {
    relText = `Updated ${diffDays} days ago`;
  } else if (diffDays === 14) {
    relText = `Updated 2 weeks ago`;
  } else if (diffDays < 21) {
    relText = `Updated ${diffDays} days ago`;
  } else if (diffDays === 21) {
    relText = `Updated 3 weeks ago`;
  } else if (diffDays < 28) {
    relText = `Updated ${diffDays} days ago`;
  } else if (diffDays === 28) {
    relText = `Updated 4 weeks ago`;
  } else {
    const diffMonths = Math.floor(diffDays / 30);
    relText = `Updated ${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
  }

  return `<span class="lu-text">${relText}</span> <span class="lu-date">on ${dateStr}</span>`;
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function capitalize(text) {
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setupTableDragScroll() {
  const scrollArea = document.getElementById('dashboard-table-wrap');
  if (!scrollArea) return;
  
  let isDown = false, startX, scrollLeft;
  
  scrollArea.addEventListener('mousedown', (e) => {
    // Don't hijack clicks on buttons/inputs inside the table
    if (e.target.closest('button, input, select, a, .col-resize-handle, .th-col-arrow')) return;
    isDown = true;
    scrollArea.classList.add('dragging');
    startX = e.pageX - scrollArea.offsetLeft;
    scrollLeft = scrollArea.scrollLeft;
  });
  
  scrollArea.addEventListener('mouseleave', () => {
    isDown = false;
    scrollArea.classList.remove('dragging');
  });
  
  scrollArea.addEventListener('mouseup', () => {
    isDown = false;
    scrollArea.classList.remove('dragging');
  });
  
  scrollArea.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - scrollArea.offsetLeft;
    scrollArea.scrollLeft = scrollLeft - (x - startX) * 1.5;
  });
}

const colMgr = (() => {
  const COLS = [
    { key: 'quotationNumber', label: 'Quotation #' },
    { key: 'width', label: 'Width (mm)' },
    { key: 'height', label: 'Height (mm)' },
    { key: 'gusset', label: 'Gusset (mm)' },
    { key: 'totalAmount', label: 'Total Amount' },
    { key: 'status', label: 'Status' },
    { key: 'createdAt', label: 'Created Date' },
    { key: 'updatedAt', label: 'Last Updated' },
    { key: 'actions', label: 'Actions' },
  ];

  const LS_HIDDEN = 'qd_hiddenCols_v1';
  const LS_WIDTHS = 'qd_colWidths_v1';

  let hidden = new Set();
  let widths = {};
  let ctxMenu = null;
  let ctxKey = null;

  function load() {
    try { hidden = new Set(JSON.parse(localStorage.getItem(LS_HIDDEN) || '[]')); } catch (_) {}
    try { widths = JSON.parse(localStorage.getItem(LS_WIDTHS) || '{}'); } catch (_) {}
  }

  function save() {
    try {
      localStorage.setItem(LS_HIDDEN, JSON.stringify([...hidden]));
      localStorage.setItem(LS_WIDTHS, JSON.stringify(widths));
    } catch (_) {}
  }

  function getTable() { return document.querySelector('#dashboard-table-wrap .data-table'); }
  function getThs() { return Array.from(getTable()?.querySelectorAll('thead tr th') || []); }

  function wrapHeaders() {
    const ths = getThs();
    ths.forEach((th, i) => {
      const def = COLS[i];
      if (!def || th.dataset.colKey) return;
      th.dataset.colKey = def.key;
      th.dataset.colIndex = i;

      const existingNodes = Array.from(th.childNodes);
      const inner = document.createElement('div');
      inner.className = 'th-inner';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'th-label';

      let sortIconEl = null;
      existingNodes.forEach(n => {
        if (n.nodeType === 1 && n.classList && n.classList.contains('sort-icon')) {
          sortIconEl = n;
        } else {
          labelSpan.appendChild(n);
        }
      });

      const arrow = document.createElement('span');
      arrow.className = 'th-col-arrow';
      arrow.title = 'Column options';
      arrow.textContent = '▾';
      arrow.addEventListener('click', (e) => {
        e.stopPropagation();
        openCtxMenu(e, def.key, def.label);
      });

      inner.appendChild(labelSpan);
      if (sortIconEl) inner.appendChild(sortIconEl);
      inner.appendChild(arrow);
      th.appendChild(inner);

      if (widths[def.key]) {
        th.style.width = widths[def.key] + 'px';
        th.style.minWidth = widths[def.key] + 'px';
      }

      attachResizeHandle(th, def.key);
    });
  }

  function attachResizeHandle(th, key) {
    if (th.querySelector('.col-resize-handle')) return;
    const handle = document.createElement('div');
    handle.className = 'col-resize-handle';
    th.appendChild(handle);

    let startX, startW, animFrame;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startW = th.getBoundingClientRect().width;
      handle.classList.add('is-resizing');
      getTable()?.classList.add('col-resizing');

      const onMove = (ev) => {
        cancelAnimationFrame(animFrame);
        animFrame = requestAnimationFrame(() => {
          const newW = Math.max(30, startW + ev.clientX - startX);
          th.style.width = newW + 'px';
          th.style.minWidth = newW + 'px';
          widths[key] = newW;
        });
      };
      const onUp = () => {
        handle.classList.remove('is-resizing');
        getTable()?.classList.remove('col-resizing');
        save();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function buildCtxMenu() {
    if (ctxMenu) return;
    ctxMenu = document.createElement('div');
    ctxMenu.className = 'col-ctx-menu';
    ctxMenu.id = 'qdColCtxMenu';
    ctxMenu.innerHTML = `
      <div class="col-ctx-title" id="qdCtxColTitle">Column</div>
      <div class="col-ctx-item" id="qdCtxHideBtn"><span class="ctx-icon">🙈</span> Hide this column</div>
      <hr class="col-ctx-sep">
      <div class="col-ctx-item" id="qdCtxFitBtn"><span class="ctx-icon">↔️</span> Auto-fit width</div>
      <div class="col-ctx-item" id="qdCtxResetWidthBtn"><span class="ctx-icon">⚖️</span> Reset width</div>
      <hr class="col-ctx-sep">
      <div class="col-ctx-item" id="qdCtxShowAllBtn"><span class="ctx-icon">👁️</span> Show all columns</div>
      <div class="col-ctx-item" id="qdCtxResetAllWidthsBtn"><span class="ctx-icon">↺</span> Reset all columns width</div>
    `;
    document.body.appendChild(ctxMenu);

    document.getElementById('qdCtxHideBtn').addEventListener('click', () => { if (ctxKey) hideCol(ctxKey); closeCtxMenu(); });
    document.getElementById('qdCtxFitBtn').addEventListener('click', () => { if (ctxKey) autoFitCol(ctxKey); closeCtxMenu(); });
    document.getElementById('qdCtxResetWidthBtn').addEventListener('click', () => { if (ctxKey) resetColWidth(ctxKey); closeCtxMenu(); });
    document.getElementById('qdCtxShowAllBtn').addEventListener('click', () => { showAll(); closeCtxMenu(); });
    document.getElementById('qdCtxResetAllWidthsBtn').addEventListener('click', () => { resetAllColWidths(); closeCtxMenu(); });

    document.addEventListener('click', (e) => {
      if (ctxMenu && !ctxMenu.contains(e.target)) closeCtxMenu();
    });
  }

  function openCtxMenu(e, key, label) {
    buildCtxMenu();
    ctxKey = key;
    document.getElementById('qdCtxColTitle').textContent = label;
    const btnRect = e.target.getBoundingClientRect();
    let left = btnRect.left;
    let top = btnRect.bottom + 4;
    ctxMenu.style.display = 'block';
    const mw = ctxMenu.offsetWidth;
    const mh = ctxMenu.offsetHeight;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (top + mh > window.innerHeight - 8) top = btnRect.top - mh - 4;
    ctxMenu.style.left = left + 'px';
    ctxMenu.style.top = top + 'px';
    ctxMenu.classList.add('show');
  }

  function closeCtxMenu() {
    if (ctxMenu) { ctxMenu.classList.remove('show'); ctxMenu.style.display = 'none'; }
    ctxKey = null;
  }

  function hideCol(key) {
    const visibleReal = COLS.filter(c => !hidden.has(c.key)).length;
    if (visibleReal <= 2) return;
    hidden.add(key);
    save();
    applyVisibility();
    updateShowAllBar();
  }

  function showCol(key) {
    hidden.delete(key);
    save();
    applyVisibility();
    updateShowAllBar();
  }

  function showAll() {
    hidden.clear();
    save();
    applyVisibility();
    updateShowAllBar();
  }

  function applyVisibility() {
    const table = getTable();
    if (!table) return;

    const thead = table.querySelector('thead tr');
    const tbodyRows = Array.from(table.querySelectorAll('tbody tr'));

    COLS.forEach((def) => {
      const th = thead.querySelector(`th[data-col-key="${def.key}"]`);
      if (!th) return;
      const shouldHide = hidden.has(def.key);
      th.style.display = shouldHide ? 'none' : '';
      tbodyRows.forEach(row => {
        const td = row.querySelector(`td[data-col-key="${def.key}"]`);
        if (td) td.style.display = shouldHide ? 'none' : '';
      });
    });

    table.querySelectorAll('.col-stub-th, .col-stub-td').forEach(el => el.remove());
    insertStubs(thead, tbodyRows);
  }

  function insertStubs(thead, tbodyRows) {
    let i = 0;
    while (i < COLS.length) {
      if (hidden.has(COLS[i].key)) {
        let runStart = i;
        let runLabels = [];
        while (i < COLS.length && hidden.has(COLS[i].key)) {
          runLabels.push(COLS[i].label);
          i++;
        }
        const allThs = Array.from(thead.querySelectorAll('th[data-col-key]'));
        const refTh = allThs[i] || null;

        const stubTh = makeStub(runLabels, runStart);
        if (!refTh) continue;
        thead.insertBefore(stubTh, refTh);

        tbodyRows.forEach(row => {
          const stubTd = document.createElement('td');
          stubTd.className = 'col-stub-td';
          const refTd = row.querySelector(`td[data-col-key="${COLS[i].key}"]`);
          if (refTd) row.insertBefore(stubTd, refTd);
        });
      } else {
        i++;
      }
    }
  }

  function makeStub(labels, runStart) {
    const stubTh = document.createElement('th');
    stubTh.className = 'col-stub-th';
    const tipText = labels.length === 1
      ? `Click to show: ${labels[0]}`
      : `Click to show ${labels.length} hidden columns`;
    stubTh.setAttribute('data-tip', tipText);
    stubTh.innerHTML = `<div class="col-stub-inner"><div class="col-stub-line"></div></div>`;
    stubTh.title = tipText;
    stubTh.addEventListener('click', () => {
      labels.forEach((_, offset) => showCol(COLS[runStart + offset].key));
    });
    return stubTh;
  }

  function autoFitCol(key) {
    const idx = COLS.findIndex(c => c.key === key);
    if (idx < 0) return;
    const table = getTable();
    if (!table) return;
    const cells = [
      table.querySelector(`th[data-col-index="${idx}"]`),
      ...Array.from(table.querySelectorAll(`tbody tr td:nth-child(${idx + 1})`))
    ].filter(Boolean);
    let maxW = 40;
    cells.forEach(cell => {
      const clone = cell.cloneNode(true);
      clone.style.cssText = 'width:auto;min-width:0;position:absolute;visibility:hidden;white-space:nowrap;';
      document.body.appendChild(clone);
      maxW = Math.max(maxW, clone.scrollWidth + 16);
      document.body.removeChild(clone);
    });
    const th = table.querySelector(`th[data-col-index="${idx}"]`);
    if (th) {
      th.style.width = maxW + 'px';
      th.style.minWidth = maxW + 'px';
      widths[key] = maxW;
      save();
    }
  }

  function resetColWidth(key) {
    const idx = COLS.findIndex(c => c.key === key);
    const table = getTable();
    if (!table || idx < 0) return;
    const th = table.querySelector(`th[data-col-index="${idx}"]`);
    if (th) { th.style.width = ''; th.style.minWidth = ''; }
    delete widths[key];
    save();
  }

  function resetAllColWidths() {
    const table = getTable();
    if (!table) return;
    table.querySelectorAll('thead tr th[data-col-key]').forEach(th => {
      th.style.width = '';
      th.style.minWidth = '';
    });
    widths = {};
    save();
  }

  function updateShowAllBar() {
    const bar = document.getElementById('colShowAllBar');
    if (!bar) return;
    bar.querySelectorAll('.col-show-chip').forEach(c => c.remove());
    if (hidden.size === 0) { bar.classList.remove('has-hidden'); return; }
    bar.classList.add('has-hidden');
    const showAllBtn = bar.querySelector('.col-show-all-btn');
    COLS.forEach(def => {
      if (!hidden.has(def.key)) return;
      const chip = document.createElement('span');
      chip.className = 'col-show-chip';
      chip.innerHTML = `${def.label} <span class="chip-x">✕</span>`;
      chip.title = `Click to show "${def.label}"`;
      chip.addEventListener('click', () => showCol(def.key));
      bar.insertBefore(chip, showAllBtn);
    });
  }

  function refresh() {
    wrapHeaders();
    applyVisibility();
    updateShowAllBar();
  }

  function init() {
    load();
    refresh();
  }

  return { hideCol, showCol, showAll, autoFitCol, refresh, init };
})();
