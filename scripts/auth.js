// customerAuth.js
// Shared by any customer-facing page that includes the standard
// .profile-menu topbar markup (currently quotation.html).
//
// Session storage contract (matches customer-login.html / register-customer.html):
//   localStorage.customer   -> persisted session ("remember me")
//   sessionStorage.customer -> tab-only session
// Both hold the JSON object returned by the API as `customer`.
(function () {
  "use strict";

  function readStoredCustomer() {
    try {
      const raw = localStorage.getItem("customer") || sessionStorage.getItem("customer");
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearStoredCustomer() {
    try { localStorage.removeItem("customer"); } catch (e) {}
    try { sessionStorage.removeItem("customer"); } catch (e) {}
  }

  function initials(customer) {
    const source = (customer.contact_person || customer.company_name || customer.customer_email || "?").trim();
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return source.slice(0, 2).toUpperCase() || "?";
  }

  function loginUrl(returnPath) {
    const target = returnPath || (window.location.pathname + window.location.search);
    return "/customerlogin.html?returnTo=" + encodeURIComponent(target);
  }

  const els = {
    chip: document.getElementById("profileChip"),
    avatar: document.getElementById("profileAvatar"),
    name: document.getElementById("profileName"),
    email: document.getElementById("profileEmail"),
    menu: document.getElementById("profileMenu"),
    dropdown: document.getElementById("profileDropdown"),
    dropdownName: document.getElementById("dropdownName"),
    dropdownEmail: document.getElementById("dropdownEmail"),
    dropdownCompany: document.getElementById("dropdownCompany"),
    logoutBtn: document.getElementById("logoutBtn"),
    signInBtn: document.getElementById("dropdownSignIn"),
    registerBtn: document.getElementById("dropdownRegister"),
  };

  // Nothing to do if this page doesn't have the profile markup.
  if (!els.chip) {
    window.CustomerAuth = {
      isLoggedIn: function () { return false; },
      getCustomer: function () { return null; },
      requireLogin: function (returnPath) { window.location.href = loginUrl(returnPath); },
      logout: function () { return Promise.resolve(); },
      refresh: function () { return Promise.resolve(); },
    };
    return;
  }

  let currentCustomer = null;

  function renderGuest() {
    currentCustomer = null;
    els.avatar.textContent = "G";
    els.name.textContent = "Guest";
    els.email.textContent = "Not signed in";
    els.dropdownName.textContent = "Browsing as a guest";
    els.dropdownEmail.textContent = "Sign in to submit a quotation request.";
    els.dropdownCompany.textContent = "";
    if (els.logoutBtn) els.logoutBtn.hidden = true;
    if (els.signInBtn) els.signInBtn.hidden = false;
    if (els.registerBtn) els.registerBtn.hidden = false;
    document.dispatchEvent(new CustomEvent("customerauth:change", { detail: { loggedIn: false, customer: null } }));
  }

  function renderCustomer(customer) {
    currentCustomer = customer;
    const name = customer.contact_person || customer.company_name || "Your account";
    els.avatar.textContent = initials(customer);
    els.name.textContent = name;
    els.email.textContent = customer.customer_email || "";
    els.dropdownName.textContent = name;
    els.dropdownEmail.textContent = customer.customer_email || "";
    els.dropdownCompany.textContent = customer.company_name || "";
    if (els.logoutBtn) els.logoutBtn.hidden = false;
    if (els.signInBtn) els.signInBtn.hidden = true;
    if (els.registerBtn) els.registerBtn.hidden = true;
    document.dispatchEvent(new CustomEvent("customerauth:change", { detail: { loggedIn: true, customer: customer } }));
  }

  async function refresh() {
    const stored = readStoredCustomer();
    if (!stored) { renderGuest(); return; }
    try {
      const res = await fetch("/api/customer/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: stored.customer_id, email: stored.customer_email }),
      });
      const data = await res.json().catch(function () { return {}; });
      if (res.ok && data.valid) {
        renderCustomer(data.customer || stored);
      } else {
        clearStoredCustomer();
        renderGuest();
      }
    } catch (err) {
      // Network hiccup: trust the cached session rather than bouncing a real
      // customer down to guest just because one check request failed.
      renderCustomer(stored);
    }
  }

  async function logout() {
    if (els.logoutBtn) { els.logoutBtn.disabled = true; els.logoutBtn.textContent = "Signing out…"; }
    try { await fetch("/api/customer/logout", { method: "POST" }); } catch (e) {}
    clearStoredCustomer();
    if (els.logoutBtn) { els.logoutBtn.disabled = false; els.logoutBtn.textContent = "Log out"; }
    closeDropdown();
    renderGuest();
  }

  function openDropdown() {
    els.dropdown.hidden = false;
    els.chip.setAttribute("aria-expanded", "true");
  }
  function closeDropdown() {
    els.dropdown.hidden = true;
    els.chip.setAttribute("aria-expanded", "false");
  }

  els.chip.addEventListener("click", function (e) {
    e.stopPropagation();
    if (els.dropdown.hidden) openDropdown(); else closeDropdown();
  });
  document.addEventListener("click", function (e) {
    if (els.menu && !els.menu.contains(e.target)) closeDropdown();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeDropdown();
  });
  if (els.logoutBtn) els.logoutBtn.addEventListener("click", logout);
  if (els.signInBtn) els.signInBtn.addEventListener("click", function () { window.location.href = loginUrl(); });
  if (els.registerBtn) els.registerBtn.addEventListener("click", function () { window.location.href = "/register-customer.html"; });

  window.CustomerAuth = {
    isLoggedIn: function () { return !!currentCustomer; },
    getCustomer: function () { return currentCustomer; },
    requireLogin: function (returnPath) { window.location.href = loginUrl(returnPath); },
    logout: logout,
    refresh: refresh,
  };

  refresh();
})();