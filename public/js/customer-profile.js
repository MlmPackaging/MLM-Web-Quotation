(function () {
  const BASE = '/api/customer-profile';
  const PAGE = '/html/customer-profile.html';
  const $ = (id) => document.getElementById(id);
  const FIELDS = ['company_name', 'company_registration_no', 'address', 'contact_person', 'phone'];

  // Same session contract as quotation.js and /scripts/auth.js.
  function getCustomerSession() {
    const a = window.CustomerAuth; if (!a) return null;
    const c = (typeof a.getCustomer === 'function' && a.getCustomer()) || (typeof a.getUser === 'function' && a.getUser()) || a.customer || null;
    const id = c && c.customer_id, email = c && (c.customer_email || c.email);
    return id && email ? { customer_id: id, email } : null;
  }
  function goLogin() {
    if (window.CustomerAuth && window.CustomerAuth.requireLogin) window.CustomerAuth.requireLogin(PAGE);
    else location.href = '/customerlogin.html?returnTo=' + encodeURIComponent(PAGE);
  }

  async function post(path, body) {
    const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = {}; try { data = await res.json(); } catch (e) {}
    if (!res.ok || data.success === false) { const err = new Error(data.message || 'Request failed (' + res.status + ')'); err.status = res.status; throw err; }
    return data;
  }

  function fill(c) {
    FIELDS.concat(['customer_code', 'email']).forEach((k) => { $(k).value = c[k] || ''; });
  }

  // Keep the copy saved in this browser in step, so other pages show the new details.
  function updateStoredCustomer(c) {
    ['localStorage', 'sessionStorage'].forEach((s) => {
      try {
        const raw = window[s].getItem('customer'); if (!raw) return;
        window[s].setItem('customer', JSON.stringify(Object.assign(JSON.parse(raw), c)));
      } catch (e) {}
    });
  }

  async function load() {
    try {
      if (window.CustomerAuth && typeof window.CustomerAuth.refresh === 'function') await window.CustomerAuth.refresh();
      const session = getCustomerSession();
      if (!session) { goLogin(); return; }
      fill((await post('/me', session)).customer);
    } catch (e) {
      if (e.status === 401) { goLogin(); return; }
      $('pfMsg').textContent = e.message;
    }
  }

  $('pfForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = $('pfMsg'); msg.textContent = ''; msg.className = 'pf-msg';
    const session = getCustomerSession(); if (!session) { goLogin(); return; }
    $('pfSave').disabled = true;
    try {
      const body = Object.assign({}, session);
      FIELDS.forEach((k) => { body[k] = $(k).value; });
      const c = (await post('/update', body)).customer;
      fill(c); updateStoredCustomer(c);
      msg.textContent = 'Saved. New quotations will use these details.'; msg.className = 'pf-msg good';
    } catch (e) {
      if (e.status === 401) { goLogin(); return; }
      msg.textContent = e.message;
    } finally { $('pfSave').disabled = false; }
  });

  load();
})();