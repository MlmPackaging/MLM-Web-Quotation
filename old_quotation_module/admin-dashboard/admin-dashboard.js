const adminDashboardState = {
  quotations: [],
  recentActivity: [],
  loading: true,
  error: "",
  filter: "all",
  searchTerm: "",
  selectedQuotation: null,
  activeSection: "overview",
  viewMode: "grid",
};

const ADMIN_ACTION_SELECTOR = [
  ".button[data-admin-action='export']",
  ".table-link[data-admin-action='export']",
  "#admin-modal-pdf",
  "#admin-modal-approve",
  "#admin-modal-reject",
  "#admin-modal-review",
].join(", ");

function setAdminActionButtonsDisabled(disabled) {
  document.querySelectorAll(ADMIN_ACTION_SELECTOR).forEach((button) => {
    button.disabled = disabled;
  });
}

async function withAdminButtonLoading(button, loadingText, action) {
  if (!button || button.disabled) return;

  const originalContent = button.innerHTML;
  setAdminActionButtonsDisabled(true);
  button.dataset.loading = "true";
  button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${loadingText}</span>`;

  try {
    return await action();
  } finally {
    setAdminActionButtonsDisabled(false);
    button.dataset.loading = "false";
    button.innerHTML = originalContent;
  }
}

document.addEventListener("DOMContentLoaded", initAdminDashboard);

async function initAdminDashboard() {
  bindAdminEvents();
  await fetchAdminDashboardData();
}

function bindAdminEvents() {
  document.getElementById("admin-search").addEventListener("input", (event) => {
    adminDashboardState.searchTerm = event.target.value;
    renderAdminDashboard();
  });

  document.getElementById("admin-filter").addEventListener("change", (event) => {
    adminDashboardState.filter = event.target.value;
    renderAdminDashboard();
  });

  document.getElementById("admin-view-grid").addEventListener("click", () => {
    adminDashboardState.viewMode = "grid";
    syncViewButtons();
    renderAdminDashboard();
  });

  document.getElementById("admin-view-list").addEventListener("click", () => {
    adminDashboardState.viewMode = "list";
    syncViewButtons();
    renderAdminDashboard();
  });

  document.querySelectorAll("[data-admin-close='true']").forEach((element) => {
    element.addEventListener("click", closeAdminQuotationModal);
  });

  document.getElementById("admin-quotation-modal-close").addEventListener("click", closeAdminQuotationModal);

  document.getElementById("admin-quotation-modal-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-section]");
    if (!button || !adminDashboardState.selectedQuotation) return;
    adminDashboardState.activeSection = button.dataset.section;
    syncModalTabs();
    renderAdminQuotationDetail();
  });

  document.getElementById("admin-modal-pdf").addEventListener("click", (event) => {
    if (adminDashboardState.selectedQuotation) {
      downloadAdminQuotationPDF(adminDashboardState.selectedQuotation, event.currentTarget);
    }
  });

  document.getElementById("admin-modal-approve").addEventListener("click", (event) => {
    if (adminDashboardState.selectedQuotation) {
      updateAdminQuotationStatus(adminDashboardState.selectedQuotation.id, "approved", event.currentTarget);
    }
  });

  document.getElementById("admin-modal-reject").addEventListener("click", (event) => {
    if (adminDashboardState.selectedQuotation) {
      updateAdminQuotationStatus(adminDashboardState.selectedQuotation.id, "rejected", event.currentTarget);
    }
  });

  document.getElementById("admin-modal-review").addEventListener("click", (event) => {
    if (adminDashboardState.selectedQuotation) {
      updateAdminQuotationStatus(adminDashboardState.selectedQuotation.id, "reviewed", event.currentTarget);
    }
  });
}

function getCurrentAdminRequester() {
  const user = typeof window.getCurrentUser === "function" ? window.getCurrentUser() : null;
  return {
    id: user?.user_id || user?.id || "",
    email: user?.user_email || user?.email || "",
    role: user?.role || "User",
  };
}

async function fetchAdminDashboardData() {
  setAdminLoading(true);
  clearAdminError();

  try {
    const requester = getCurrentAdminRequester();
    const params = new URLSearchParams({
      role: requester.role,
      email: requester.email,
      userId: requester.id,
    });

    let response, data;
    let isApiFallback = false;

    try {
      // Try API first
      response = await fetch(`/api/quotations/admin/dashboard?${params.toString()}`);
      const responseText = await response.text();

      // Check if response is HTML (404 page) instead of JSON
      if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
        throw new Error('API not available, using static data');
      }

      data = JSON.parse(responseText);
    } catch (apiError) {
      // Fallback to static JSON file
      console.log('API unavailable, loading static admin data:', apiError.message);
      isApiFallback = true;
      response = await fetch('/api/quotations/admin/dashboard.json');
      data = await response.json();
    }

    if (!response.ok && !data) {
      throw new Error(data?.error || "Failed to load admin dashboard data");
    }

    // Only use static quotations from API/JSON
    // Use localStorage only if API failed completely
    const staticQuotations = data.quotations || [];
    
    if (isApiFallback) {
      // If API failed, use localStorage as additional fallback
      const localQuotations = JSON.parse(localStorage.getItem('localQuotations') || '[]');
      adminDashboardState.quotations = [...staticQuotations, ...localQuotations];
    } else {
      // If API succeeded, use ONLY database quotations
      adminDashboardState.quotations = staticQuotations;
      // Clear localStorage since we have database data now
      localStorage.removeItem('localQuotations');
    }
    
    adminDashboardState.recentActivity = data.recentActivity || [];
    renderAdminDashboard();
  } catch (error) {
    showAdminError(error.message || "Unable to load admin dashboard");
  } finally {
    setAdminLoading(false);
  }
}

function setAdminLoading(isLoading) {
  adminDashboardState.loading = isLoading;
  document.getElementById("admin-dashboard-loading").classList.toggle("is-hidden", !isLoading);
  document.getElementById("admin-dashboard-content").classList.toggle("is-hidden", isLoading);
}

function showAdminError(message) {
  adminDashboardState.error = message;
  showAdminToast(message, "error");
}

function clearAdminError() {
  adminDashboardState.error = "";
}

function renderAdminDashboard() {
  renderAdminStats();
  renderAdminRecentActivity();
  renderAdminQuotations();
}

function getAdminFilteredQuotations() {
  const search = adminDashboardState.searchTerm.trim().toLowerCase();

  return adminDashboardState.quotations.filter((quotation) => {
    const matchesFilter = adminDashboardState.filter === "all" || quotation.status === adminDashboardState.filter;
    const haystack = [
      quotation.user_company,
      quotation.quotation_number,
      quotation.user_contact_person,
      quotation.user_email,
    ].join(" ").toLowerCase();

    return matchesFilter && (!search || haystack.includes(search));
  });
}

function getAdminStats() {
  const quotations = adminDashboardState.quotations;
  const totalRevenue = quotations
    .filter((item) => ["submitted", "approved", "reviewed"].includes(item.status))
    .reduce((sum, item) => sum + Number(item.total_amount || 0), 0);

  return {
    totalQuotations: quotations.length,
    totalRevenue,
    pendingReviews: quotations.filter((item) => item.status === "submitted").length,
    activeUsers: new Set(quotations.map((item) => item.user_id)).size,
  };
}

function renderAdminStats() {
  const stats = getAdminStats();
  const cards = [
    { label: "Total Quotations", value: stats.totalQuotations, colorClass: "stat-blue", change: "Live", biIcon: "bi-bar-chart-line" },
    { label: "Total Revenue", value: `RM ${formatCurrency(stats.totalRevenue)}`, colorClass: "stat-green", change: "Temp", biIcon: "bi-cash-coin" },
    { label: "Pending Review", value: stats.pendingReviews, colorClass: "stat-orange", change: "Queue", biIcon: "bi-hourglass-split" },
    { label: "Active Users", value: stats.activeUsers, colorClass: "stat-purple", change: "Now", biIcon: "bi-people-fill" },
  ];

  document.getElementById("admin-stats").innerHTML = cards.map((stat) => `
    <article class="admin-stat-card">
      <div class="admin-stat-card__head">
        <div class="stat-icon ${stat.colorClass}">
          <i class="bi ${stat.biIcon}"></i>
        </div>
        <span class="stat-change">${escapeHtml(stat.change)}</span>
      </div>
      <h3>${escapeHtml(stat.value)}</h3>
      <p>${escapeHtml(stat.label)}</p>
    </article>
  `).join("");
}

function renderAdminRecentActivity() {
  const list = document.getElementById("admin-recent-activity");
  if (!adminDashboardState.recentActivity.length) {
    list.innerHTML = `<p class="activity-time">No quotation activity yet.</p>`;
    return;
  }

  list.innerHTML = adminDashboardState.recentActivity.map((activity) => `
    <div class="activity-item">
      <div class="activity-icon ${getActivityColorClass(activity.type)}">
        <i class="bi ${getActivityBiIcon(activity.type)}"></i>
      </div>
      <div>
        <p class="activity-name">${escapeHtml(activity.user)}</p>
        <p class="activity-time">${escapeHtml(activity.time)}</p>
        ${activity.amount ? `<p class="activity-amount">${escapeHtml(activity.amount)}</p>` : ""}
      </div>
    </div>
  `).join("");
}

function renderAdminQuotations() {
  const quotations = getAdminFilteredQuotations();
  document.getElementById("admin-quotation-count").textContent = `${quotations.length} quotations`;

  const emptyState = document.getElementById("admin-empty-state");
  const grid = document.getElementById("admin-quotation-grid");
  const tableWrap = document.getElementById("admin-quotation-table-wrap");

  if (!quotations.length) {
    emptyState.classList.remove("is-hidden");
    grid.classList.add("is-hidden");
    tableWrap.classList.add("is-hidden");
    return;
  }

  emptyState.classList.add("is-hidden");

  if (adminDashboardState.viewMode === "grid") {
    grid.classList.remove("is-hidden");
    tableWrap.classList.add("is-hidden");
    renderAdminQuotationGrid(quotations);
  } else {
    grid.classList.add("is-hidden");
    tableWrap.classList.remove("is-hidden");
    renderAdminQuotationTable(quotations);
  }
}

function renderAdminQuotationGrid(quotations) {
  const grid = document.getElementById("admin-quotation-grid");
  grid.innerHTML = quotations.map((quotation) => `
    <article class="quotation-card">
      <div class="quotation-card__head">
        <div class="quotation-card__company-wrap">
          <div class="company-icon">
            <i class="bi bi-building-fill"></i>
          </div>
          <div>
            <h3>${escapeHtml(quotation.quotation_number)}</h3>
            <p class="quotation-card__company">${escapeHtml(quotation.user_company)}</p>
            <p class="quotation-card__contact">${escapeHtml(quotation.user_contact_person)}</p>
          </div>
        </div>
        <span class="status-chip ${getStatusClassName(quotation.status)}">
          ${getStatusIconSvg(quotation.status)}
          ${escapeHtml(quotation.status)}
        </span>
      </div>
      <div class="quotation-card__meta">
        <div class="meta-row"><span>Email:</span><strong>${escapeHtml(quotation.user_email)}</strong></div>
        <div class="meta-row"><span>Amount:</span><strong class="meta-row__amount">RM ${formatCurrency(quotation.total_amount)}</strong></div>
        <div class="meta-row"><span>Date:</span><strong>${formatDate(quotation.created_at)}</strong></div>
      </div>
      <div class="quotation-card__actions">
        <button class="button button-slate" type="button" data-admin-action="view" data-id="${quotation.id}">View Details</button>
        <button class="button button-green" type="button" data-admin-action="export" data-id="${quotation.id}">PDF</button>
      </div>
    </article>
  `).join("");

  grid.querySelectorAll("[data-admin-action]").forEach((button) => {
    button.addEventListener("click", handleAdminQuotationAction);
  });
}

function renderAdminQuotationTable(quotations) {
  const tbody = document.getElementById("admin-quotation-table-body");
  tbody.innerHTML = quotations.map((quotation) => `
    <tr>
      <td>${escapeHtml(quotation.quotation_number)}</td>
      <td>${escapeHtml(quotation.user_company)}</td>
      <td>${escapeHtml(quotation.user_contact_person)}</td>
      <td>${escapeHtml(quotation.user_email)}</td>
      <td><strong>RM ${formatCurrency(quotation.total_amount)}</strong></td>
      <td><span class="status-chip ${getStatusClassName(quotation.status)}">${getStatusIconSvg(quotation.status)}${escapeHtml(quotation.status)}</span></td>
      <td>${formatDate(quotation.created_at)}</td>
      <td>
        <div class="table-actions">
          <button class="table-link table-link--view" type="button" data-admin-action="view" data-id="${quotation.id}">View Details</button>
          <button class="table-link table-link--pdf" type="button" data-admin-action="export" data-id="${quotation.id}">PDF</button>
        </div>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll("[data-admin-action]").forEach((button) => {
    button.addEventListener("click", handleAdminQuotationAction);
  });
}

function handleAdminQuotationAction(event) {
  const button = event.currentTarget;
  const quotationId = Number(button.dataset.id);
  const action = button.dataset.adminAction;
  const quotation = adminDashboardState.quotations.find((item) => item.id === quotationId);
  if (!quotation) return;

  if (action === "view") {
    openAdminQuotationModal(quotation);
    return;
  }

  if (action === "export") {
    downloadAdminQuotationPDF(quotation, button);
  }
}

function syncViewButtons() {
  document.getElementById("admin-view-grid").classList.toggle("is-active", adminDashboardState.viewMode === "grid");
  document.getElementById("admin-view-list").classList.toggle("is-active", adminDashboardState.viewMode === "list");
}

function openAdminQuotationModal(quotation) {
  adminDashboardState.selectedQuotation = quotation;
  adminDashboardState.activeSection = "overview";
  syncModalTabs();
  document.body.classList.add("modal-open");

  document.getElementById("admin-quotation-modal-title").textContent = `Quotation ${quotation.quotation_number}`;
  document.getElementById("admin-quotation-modal-subtitle").textContent = `For ${quotation.user_company}`;
  document.getElementById("admin-quotation-modal-status").innerHTML = `
    <span class="status-chip ${getStatusClassName(quotation.status)}">${getStatusIconSvg(quotation.status)}${escapeHtml(capitalize(quotation.status))}</span>
    <span>Created: ${formatDate(quotation.created_at)}</span>
  `;

  document.getElementById("admin-modal-approve").classList.toggle("is-hidden", !["submitted", "reviewed"].includes(quotation.status));
  document.getElementById("admin-modal-reject").classList.toggle("is-hidden", !["submitted", "reviewed"].includes(quotation.status));
  document.getElementById("admin-modal-review").classList.toggle("is-hidden", quotation.status !== "submitted");

  renderAdminQuotationDetail();
  document.getElementById("admin-quotation-modal").classList.remove("is-hidden");
}

function closeAdminQuotationModal() {
  adminDashboardState.selectedQuotation = null;
  document.getElementById("admin-quotation-modal").classList.add("is-hidden");
  document.body.classList.remove("modal-open");
}

function syncModalTabs() {
  document.querySelectorAll("#admin-quotation-modal-tabs .admin-tabs__button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.section === adminDashboardState.activeSection);
  });
}

function renderAdminQuotationDetail() {
  const quotation = adminDashboardState.selectedQuotation;
  if (!quotation) return;

  const data = quotation.quotation_data || {};
  const content = document.getElementById("admin-quotation-modal-content");

  if (adminDashboardState.activeSection === "specs") {
    content.innerHTML = renderAdminSpecsSection(data);
    return;
  }

  if (adminDashboardState.activeSection === "pricing") {
    content.innerHTML = renderAdminPricingSection(data, quotation);
    return;
  }

  if (adminDashboardState.activeSection === "company") {
    content.innerHTML = renderAdminCompanySection(quotation);
    return;
  }

  if (adminDashboardState.activeSection === "options") {
    content.innerHTML = renderAdminOptionsSection(data);
    return;
  }

  content.innerHTML = `
    <div class="detail-stack">
      ${renderAdminCompanySection(quotation)}
      ${renderAdminSpecsSection(data)}
      ${renderAdminPricingSection(data, quotation)}
      ${renderAdminOptionsSection(data)}
    </div>
  `;
}

function renderAdminCompanySection(quotation) {
  return `
    <section class="detail-card">
      <div class="detail-card__title">
        <span class="detail-card__bar bar-purple"></span>
        <h4>Client Information</h4>
      </div>
      <div class="two-column">
        <div class="mini-panel mini-panel--purple">
          <span class="mini-panel__label purple">Company Details</span>
          <div class="detail-col-list">
            <div class="detail-col-item"><span>Company Name:</span><strong>${escapeHtml(quotation.user_company)}</strong></div>
            <div class="detail-col-item"><span>Contact Person:</span><strong>${escapeHtml(quotation.user_contact_person)}</strong></div>
            <div class="detail-col-item"><span>User ID:</span><strong>${escapeHtml(String(quotation.user_id || "-"))}</strong></div>
          </div>
        </div>
        <div class="mini-panel mini-panel--blue">
          <span class="mini-panel__label blue">Contact Information</span>
          <div class="detail-col-list">
            <div class="detail-col-item"><span>Email:</span><strong>${escapeHtml(quotation.user_email)}</strong></div>
            <div class="detail-col-item"><span>Phone:</span><strong>${escapeHtml(quotation.user_phone || "Not provided")}</strong></div>
            <div class="detail-col-item"><span>Address:</span><strong>${escapeHtml(quotation.user_address || "Not provided")}</strong></div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderAdminSpecsSection(data) {
  const dimensions = data.input?.dimensions || {};
  const quantity = data.input?.quantity || "N/A";
  const paper = data.input?.paper || "N/A";
  const printing = data.input?.printing || "N/A";

  const cards = [
    { label: "Dimensions", value: `${dimensions.width || "N/A"}mm x ${dimensions.height || "N/A"}mm`, biIcon: "bi-arrows-fullscreen", color: "spec-blue" },
    { label: "Gusset", value: `${dimensions.gusset || "N/A"} mm`, biIcon: "bi-distribute-vertical", color: "spec-green" },
    { label: "Quantity", value: `${Number(quantity).toLocaleString()} pcs`, biIcon: "bi-stack", color: "spec-purple" },
    { label: "Paper Type", value: paper, biIcon: "bi-file-earmark-text", color: "spec-orange" },
  ];

  return `
    <section class="detail-card">
      <div class="detail-card__title">
        <span class="detail-card__bar bar-green"></span>
        <h4>Product Specifications</h4>
      </div>
      <div class="spec-grid">
        ${cards.map((item) => `
          <div class="spec-card">
            <div class="spec-card__icon ${item.color}">
              <i class="bi ${item.biIcon}"></i>
            </div>
            <label>${escapeHtml(item.label)}</label>
            <p>${escapeHtml(item.value)}</p>
          </div>
        `).join("")}
      </div>
      <div class="mini-panel mini-panel--yellow" style="margin-top: 20px;">
        <span class="mini-panel__label yellow">Printing Options</span>
        <strong>${escapeHtml(printing)}</strong>
      </div>
    </section>
  `;
}

function renderAdminPricingSection(data, quotation) {
  const summary = data.summary || {};
  const totalCost = Number(summary.totalCost || 0);
  const unitCost = Number(summary.unitCost || 0);
  const unitSellingPrice = Number(summary.unitSellingPrice || 0);
  const marginIndex = Number(summary.marginIndex || 0);
  const margin = marginIndex ? (1 - marginIndex) * 100 : 0;

  const cards = [
    { label: "Total Cost", value: `RM ${formatCurrency(totalCost)}` },
    { label: "Unit Cost", value: `RM ${unitCost.toFixed(4)}` },
    { label: "Unit Selling", value: `RM ${unitSellingPrice.toFixed(4)}` },
    { label: "Total Selling", value: `RM ${formatCurrency(quotation.total_amount)}` },
  ];

  return `
    <section class="detail-card">
      <div class="detail-card__title">
        <span class="detail-card__bar bar-yellow"></span>
        <h4>Pricing Summary</h4>
      </div>
      <div class="summary-grid">
        ${cards.map((item) => `
          <div class="summary-card">
            <label>${escapeHtml(item.label)}</label>
            <p>${escapeHtml(item.value)}</p>
          </div>
        `).join("")}
      </div>
      <div class="profit-card">
        <label>Profit Margin</label>
        <p>${margin.toFixed(1)}%</p>
      </div>
    </section>
  `;
}

function renderAdminOptionsSection(data) {
  const finishing = data.input?.finishing || data.input || {};
  const options = [];

  if (finishing.varnish && finishing.varnish !== "None") options.push(`Varnish: ${finishing.varnish}`);
  if (finishing.lamination && finishing.lamination !== "None") options.push(`Lamination: ${finishing.lamination}`);
  if (finishing.spotUV) options.push("Spot UV: Yes");
  if (finishing.stamping) options.push("Stamping: Yes");
  if (finishing.embossing) options.push("Embossing: Yes");
  if (finishing.textureEmbossing) options.push("Texture Embossing: Yes");
  if (finishing.dieCut) options.push("Die Cut: Yes");

  const display = options.length ? options : ["No additional finishing options selected"];

  return `
    <section class="detail-card">
      <div class="detail-card__title">
        <span class="detail-card__bar bar-blue"></span>
        <h4>Additional Options</h4>
      </div>
      <div class="options-list">
        ${display.map((item) => `<div class="option-pill">• <span>${escapeHtml(item)}</span></div>`).join("")}
      </div>
    </section>
  `;
}

async function downloadAdminQuotationPDF(quotation, button = null) {
  const runDownload = async () => {
  try {
    const requester = getCurrentAdminRequester();
    const params = new URLSearchParams({
      userId: requester.id,
      email: requester.email,
      role: requester.role,
      scope: "admin",
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
    showAdminError(error.message || "PDF export failed.");
  }
  };

  if (button) {
    return withAdminButtonLoading(button, "Generating PDF...", runDownload);
  }

  return runDownload();
}

async function updateAdminQuotationStatus(id, status, button = null) {
  const runUpdate = async () => {
  try {
    clearAdminError();
    const requester = getCurrentAdminRequester();

    try {
      // Try API first
      const response = await fetch(`/api/quotations/admin/${id}/status`, {
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

      adminDashboardState.quotations = data.quotations || adminDashboardState.quotations;
      adminDashboardState.recentActivity = data.recentActivity || adminDashboardState.recentActivity;
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
        await fetchAdminDashboardData();
        return;
      } else {
        throw new Error('Quotation not found in local storage');
      }
    }

    renderAdminDashboard();
    
    // Show toast feedback based on status change
    const statusMessages = {
      'reviewed': 'Quotation marked as reviewed ✓',
      'approved': 'Quotation approved ✓',
      'rejected': 'Quotation rejected ✗'
    };
    
    if (statusMessages[status]) {
      const toastType = status === 'rejected' ? 'error' : 'success';
      showAdminToast(statusMessages[status], toastType);
    }

    const updated = adminDashboardState.quotations.find((item) => item.id === id);
    if (updated) openAdminQuotationModal(updated);
    else closeAdminQuotationModal();
  } catch (error) {
    showAdminToast(error.message || "Unable to update quotation", "error");
  }
  };

  const loadingText = {
    approved: "Approving...",
    rejected: "Rejecting...",
    reviewed: "Reviewing...",
  }[status] || "Updating...";

  if (button) {
    return withAdminButtonLoading(button, loadingText, runUpdate);
  }

  return runUpdate();
}

function showAdminToast(msg, type = 'info') {
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

function getStatusClassName(status) {
  return `status-${status || "draft"}`;
}

function getActivityColorClass(type) {
  if (type === "quotation_submitted") return "activity-blue";
  if (type === "quotation_approved") return "activity-green";
  if (type === "quotation_rejected") return "activity-red";
  return "activity-purple";
}

function getActivityBiIcon(type) {
  const biIcons = {
    quotation_submitted: "bi-cloud-upload-fill",
    quotation_approved: "bi-check-circle-fill",
    quotation_rejected: "bi-x-circle-fill",
    quotation_reviewed: "bi-eye-fill",
    quotation_created: "bi-file-earmark-plus-fill",
  };
  return biIcons[type] || "bi-bell-fill";
}

function getStatusIconSvg(status) {
  const icons = {
    submitted: "M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12",
    draft: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
    approved: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    rejected: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z",
    reviewed: "M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z",
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[status] || icons.draft}"></path></svg>`;
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("en-MY", {
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
