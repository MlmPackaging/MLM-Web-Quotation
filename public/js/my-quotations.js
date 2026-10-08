(function () {
  const API = window.QuotationAPI;
  const PAGE = '/html/my-quotations.html';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // What the customer sees for each status the admin can set.
  const STATUS = {
    SUBMITTED: ['Submitted', 'MPak has received your request and will review it.'],
    IN_REVIEW: ['Under review', 'MPak is reviewing your specification.'],
    QUOTED: ['Quotation ready', 'MPak has prepared your quotation.'],
    ACCEPTED: ['Accepted', 'Your quotation has been accepted.'],
    REJECTED: ['Not approved', 'MPak was unable to approve this request. Please contact MPak for details.'],
    CANCELLED: ['Cancelled', 'This quotation has been cancelled.']
  };
  const statusName = (s) => (STATUS[s] || [String(s || '').replace(/_/g, ' ')])[0];

  const state = { rows: [], status: '', q: '' };

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

  const fmtDate = (v) => (v ? String(v).slice(0, 10) : '');
  const place = (x) => [x.delivery_area, x.delivery_state].filter(Boolean).join(', ');

  function renderChips() {
    const counts = {};
    state.rows.forEach((r) => { counts[r.quotation_status] = (counts[r.quotation_status] || 0) + 1; });
    const chip = (key, name, n) =>
      `<button type="button" class="mq-chip ${state.status === key ? 'active' : ''}" data-status="${esc(key)}">${esc(name)} (${n})</button>`;
    $('mqChips').innerHTML = chip('', 'All', state.rows.length) +
      Object.keys(counts).map((k) => chip(k, statusName(k), counts[k])).join('');
  }

  function renderRows() {
    const q = state.q.toLowerCase();
    const rows = state.rows.filter((r) =>
      (!state.status || r.quotation_status === state.status) &&
      (!q || (String(r.quotation_no) + ' ' + r.description).toLowerCase().includes(q)));
    $('mqRows').innerHTML = rows.length ? rows.map((x) => `
      <tr>
        <td><b>${esc(x.quotation_no || '#' + x.quotation_id)}</b><small>${esc(fmtDate(x.created_at))}</small></td>
        <td class="mq-bag">${esc(x.description)}</td>
        <td>${(x.quantities || []).map((n) => Number(n).toLocaleString()).join(', ')}</td>
        <td>${esc(x.delivery_country)}<small>${esc(place(x))}</small></td>
        <td><span class="mq-pill ${esc(x.quotation_status)}">${esc(statusName(x.quotation_status))}</span></td>
        <td><button class="mq-view" type="button" data-id="${x.quotation_id}">View</button></td>
      </tr>`).join('')
      : `<tr><td colspan="6" class="mq-empty">${state.rows.length ? 'No quotations match this filter.' : 'You have not made a quotation yet. Use “New quotation” to start one.'}</td></tr>`;
  }

  async function load() {
    try {
      // auth.js validates stored customer data asynchronously during startup.
      if (window.CustomerAuth && typeof window.CustomerAuth.refresh === 'function') {
        await window.CustomerAuth.refresh();
      }
      const session = getCustomerSession();
      if (!session) { goLogin(); return; }
      const r = await API.mine(session);
      state.rows = r.rows;
      renderChips(); renderRows();
    } catch (e) {
      if (e.status === 401) { goLogin(); return; }
      $('mqError').textContent = e.message;
      $('mqRows').innerHTML = '<tr><td colspan="6" class="mq-empty">Could not load your quotations.</td></tr>';
    }
  }

  function closeDrawer() { $('mqDrawer').hidden = true; $('mqScrim').hidden = true; }

  async function openDetail(id) {
    const session = getCustomerSession();
    if (!session) { goLogin(); return; }
    try {
      const { quotation: x } = await API.mineDetail(id, session);
      const [name, hint] = STATUS[x.quotation_status] || [statusName(x.quotation_status), ''];
      const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '');
      $('mqDrawer').innerHTML = `
        <button class="mq-close" id="mqClose" type="button" aria-label="Close">×</button>
        <h2>${esc(x.quotation_no || '#' + x.quotation_id)}</h2>
        <small>Requested ${esc(fmtDate(x.created_at))}</small>
        <div class="mq-status-box"><span class="mq-pill ${esc(x.quotation_status)}">${esc(name)}</span><p>${esc(hint)}</p>
          ${x.updated_at ? `<p>Last updated ${esc(fmtDate(x.updated_at))}</p>` : ''}</div>
        <dl class="mq-dl">
          ${row('Gallery bag', x.gallery_bag_no ? 'Bag ' + x.gallery_bag_no : '')}
          ${row('Size (H × W × G)', x.height_mm ? `${x.height_mm} × ${x.width_mm} × ${x.gusset_mm} mm` : '')}
          ${row('Material', x.paper_name ? (x.gsm && !/gsm/i.test(x.paper_name) ? `${x.gsm}gsm ${x.paper_name}` : x.paper_name) : '')}
          ${row('Printing', x.printing_name)}
          ${row('Handle', x.handle_name)}
          ${row('Quantities', (x.quantities || []).map((n) => Number(n).toLocaleString() + ' pcs').join(' · '))}
          ${row('Purpose', x.quotation_purpose)}
          ${row('Delivery', [place(x), x.postcode, x.delivery_country].filter(Boolean).join(' · ') || 'To be provided later')}
        </dl>`;
      $('mqDrawer').hidden = false; $('mqScrim').hidden = false;
      $('mqClose').onclick = closeDrawer;
      $('mqClose').focus();
    } catch (e) {
      if (e.status === 401) { goLogin(); return; }
      $('mqError').textContent = e.message;
    }
  }

  $('mqChips').addEventListener('click', (e) => {
    const b = e.target.closest('.mq-chip'); if (!b) return;
    state.status = b.dataset.status; renderChips(); renderRows();
  });
  $('mqRows').addEventListener('click', (e) => {
    const b = e.target.closest('.mq-view'); if (b) openDetail(b.dataset.id);
  });
  $('mqSearch').addEventListener('input', (e) => { state.q = e.target.value.trim(); renderRows(); });
  $('mqScrim').onclick = closeDrawer;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  load();
})();