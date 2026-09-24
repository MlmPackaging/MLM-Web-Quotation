// ================================
// 🔐 CUSTOMER-AUTH.JS (quotation.html)
// ================================
// Lightweight companion to auth.js, but for customer accounts rather than
// staff/admin "user" accounts. It fills in the topbar's profile chip and
// wires up the logout button. Unlike auth.js it does not hide the page
// while checking — quotation.html should keep working immediately from a
// cached session, and only bounce to customer-login.html if there truly
// is no session, or the background check finds it's no longer valid.

function getCustomerRaw() {
  const ss = sessionStorage.getItem("customer");
  if (ss) return ss;
  const ls = localStorage.getItem("customer");
  if (ls) {
    // sessionStorage is per-tab; rehydrate from localStorage for new tabs
    sessionStorage.setItem("customer", ls);
    return ls;
  }
  return null;
}

function getCurrentCustomer() {
  const raw = getCustomerRaw();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Failed to parse stored customer:", error);
    return null;
  }
}

function customerInitials(customer) {
  const source = (customer?.contact_person || customer?.company_name || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("");
  return initials || "?";
}

function redirectToCustomerLogin() {
  try {
    const here = window.location.pathname + window.location.search + window.location.hash;
    sessionStorage.setItem("post-login-return", here);
  } catch (error) {
    console.warn("Could not store return target:", error);
  }
  window.location.href = "/customer-login.html";
}

function renderProfile(customer) {
  const name = customer?.contact_person || customer?.company_name || "Customer";
  const email = customer?.customer_email || "";
  const avatar = customerInitials(customer);

  const nameEl = document.getElementById("profileName");
  const emailEl = document.getElementById("profileEmail");
  const avatarEl = document.getElementById("profileAvatar");
  const dropdownNameEl = document.getElementById("dropdownName");
  const dropdownEmailEl = document.getElementById("dropdownEmail");
  const dropdownCompanyEl = document.getElementById("dropdownCompany");

  if (nameEl) nameEl.textContent = name;
  if (emailEl) emailEl.textContent = email;
  if (avatarEl) avatarEl.textContent = avatar;
  if (dropdownNameEl) dropdownNameEl.textContent = name;
  if (dropdownEmailEl) dropdownEmailEl.textContent = email;
  if (dropdownCompanyEl) dropdownCompanyEl.textContent = customer?.company_name || "";
}

function setupProfileMenuToggle() {
  const chip = document.getElementById("profileChip");
  const dropdown = document.getElementById("profileDropdown");
  if (!chip || !dropdown) return;

  function close() {
    dropdown.hidden = true;
    chip.setAttribute("aria-expanded", "false");
  }

  chip.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = dropdown.hidden;
    dropdown.hidden = !willOpen;
    chip.setAttribute("aria-expanded", String(willOpen));
  });

  document.addEventListener("click", (event) => {
    if (!dropdown.hidden && !dropdown.contains(event.target) && event.target !== chip) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
}

async function logoutCustomer() {
  const btn = document.getElementById("logoutBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Logging out…";
  }
  try {
    const customer = getCurrentCustomer();
    await fetch("/api/customer/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: customer?.customer_email || "",
        customer_id: customer?.customer_id || "",
      }),
      keepalive: true,
    });
  } catch (error) {
    console.warn("Customer logout call failed:", error);
  }

  sessionStorage.removeItem("customer");
  localStorage.removeItem("customer");
  window.location.replace("/customer-login.html");
}

function setupLogoutButton() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    logoutCustomer();
  });
}

// Re-validates the cached session against the server in the background.
// The page already rendered from the cached copy, so this only needs to
// react when the account turns out to be gone or deactivated.
async function verifyCustomerSession(customer) {
  try {
    const res = await fetch("/api/customer/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_id: customer.customer_id,
        email: customer.customer_email,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.valid) {
      sessionStorage.removeItem("customer");
      localStorage.removeItem("customer");
      redirectToCustomerLogin();
      return;
    }
    // Keep the cached copy fresh in case details changed server-side.
    const updated = JSON.stringify(data.customer);
    if (localStorage.getItem("customer")) localStorage.setItem("customer", updated);
    sessionStorage.setItem("customer", updated);
    renderProfile(data.customer);
  } catch (error) {
    console.warn("Customer session check failed:", error);
  }
}

function initCustomerAuth() {
  const customer = getCurrentCustomer();
  if (!customer) {
    redirectToCustomerLogin();
    return;
  }
  renderProfile(customer);
  setupProfileMenuToggle();
  setupLogoutButton();
  verifyCustomerSession(customer);
}

window.addEventListener("DOMContentLoaded", initCustomerAuth);