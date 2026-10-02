(function () {
  const API = window.AdminQuotationAPI;
  // Change these to match your staff login / logout.
  const LOGIN_URL = '/login.html';
  const LOGOUT_URL = '/api/logout';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = { status: '', q: '', page: 1, limit: 15, total: 0 };
  const label = (s) => String(s).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

  function handleError(err, target) {
    if (err.status === 401) {
      localStorage.removeItem('user');
      sessionStorage.removeItem('user');
      location.href = LOGIN_URL;
      return;
    }
    if (err.status === 403) {
      const message = $('pageMessage');
      if (message) {
        message.textContent = err.message;
        message.hidden = false;
      }
      return;
    }
    if (target) { target.textContent = err.message; target.className = 'msg'; }
    else alert(err.message);
  }

  // ---------- Summary chips ----------
  async function loadStats() {
    const s = await API.summary();
    const counts = Object.fromEntries(s.counts.map((r) => [r.status, r.n]));
    const all = s.counts.reduce((a, r) => a + r.n, 0);
    const chip = (key, name, n) =>
      `<button class="stat ${state.status === key ? 'active' : ''}" data-status="${esc(key)}" type="button"><b>${n}</b><span>${esc(name)}</span></button>`;
    $('stats').innerHTML = chip('', 'All', all) + s.statuses.map((k) => chip(k, label(k), counts[k] || 0)).join('');
  }

  // ---------- List ----------
  async function loadList() {
    const r = await API.list({ status: state.status, q: state.q, page: state.page, limit: state.limit });
    state.total = r.total;
    $('rows').innerHTML = r.rows.length ? r.rows.map((x) => `
      <tr data-id="${x.quotation_id}">
        <td><b>${esc(x.quotation_no || '#' + x.quotation_id)}</b><small>${esc(x.created_at ? String(x.created_at).slice(0, 10) : '')}</small></td>
        <td>${esc(x.company_name)}<small>${esc(x.contact_person || '')} ${esc(x.email)}</small></td>
        <td>${x.height_mm ? `${x.height_mm} × ${x.width_mm} × ${x.gusset_mm}` : '<small>No item</small>'}</td>
        <td>${(x.quantities || []).map((n) => Number(n).toLocaleString()).join(', ') || '<small>None</small>'}</td>
        <td>${esc(x.delivery_country)}<small>${esc(x.delivery_state || '')}</small></td>
        <td><span class="pill ${esc(x.quotation_status)}">${esc(label(x.quotation_status))}</span></td>
      </tr>`).join('') : '<tr><td colspan="6" class="empty">No quotations match this filter.</td></tr>';
    const pages = Math.max(1, Math.ceil(state.total / state.limit));
    $('pageInfo').textContent = `${state.total} quotation${state.total === 1 ? '' : 's'} · page ${state.page} of ${pages}`;
    $('prev').disabled = state.page <= 1;
    $('next').disabled = state.page >= pages;
  }

  async function refresh() {
    try { await Promise.all([loadStats(), loadList()]); } catch (e) { handleError(e); }
  }

  // ---------- Editor ----------
  const opt = (list, sel) => list.map((o) =>
    `<option value="${o.id}" ${o.id === sel ? 'selected' : ''}>${esc(o.code)} — ${esc(o.name)}${o.active ? '' : ' (inactive)'}</option>`).join('');
  const plain = (list, sel) => list.map((v) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(label(v))}</option>`).join('');

  function openDrawer(html) {
    $('drawer').innerHTML = html;
    $('drawer').hidden = false;
    $('scrim').hidden = false;
  }
  function closeDrawer() { $('drawer').hidden = true; $('scrim').hidden = true; }

  async function openEditor(id) {
    let d;
    try { d = await API.get(id); } catch (e) { return handleError(e); }
    const q = d.quotation, it = d.item || {}, c = d.customer || {};
    const qty = d.quantities.concat([null, null, null, null]).slice(0, 4);
    const o = d.options;

    openDrawer(`
      <div class="drawer-head">
        <div><h2>${esc(q.quotation_no || '#' + q.quotation_id)}</h2>
          <small>${esc(c.company_name || '')} · ${esc(c.email || '')}</small></div>
        <button class="close" id="closeBtn" type="button" aria-label="Close">×</button>
      </div>

      <fieldset><legend>Data check</legend>
        ${d.checks.map((k) => `<div class="check ${k.level}">${esc(k.text)}</div>`).join('')}
      </fieldset>

      <fieldset><legend>Customer (read only)</legend>
        <p class="readonly">${esc(c.customer_code || '')} · ${esc(c.contact_person || '')} · ${esc(c.phone || '')} · Account ${esc(c.account_status || '')}</p>
      </fieldset>

      <form id="editForm" novalidate>
        <fieldset><legend>Status and purpose</legend><div class="grid">
          <div><label for="fStatus">Status</label><select class="control" id="fStatus">${plain(d.statuses, q.quotation_status)}</select></div>
          <div><label for="fPurpose">Purpose</label><select class="control" id="fPurpose">
            ${['One-off order', 'Repeat supply'].map((p) => `<option ${p === q.quotation_purpose ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        </div></fieldset>

        <fieldset><legend>Bag specification</legend>
          <div class="grid three">
            <div><label for="fH">Height (mm)</label><input class="control" id="fH" type="number" value="${esc(it.height_mm)}"></div>
            <div><label for="fW">Width (mm)</label><input class="control" id="fW" type="number" value="${esc(it.width_mm)}"></div>
            <div><label for="fG">Gusset (mm)</label><input class="control" id="fG" type="number" value="${esc(it.gusset_mm)}"></div>
          </div>
          <p class="calc" id="calc"></p>
          <div class="grid" style="margin-top:12px">
            <div class="full"><label for="fPaper">Material</label><select class="control" id="fPaper">${opt(o.papers, it.paper_id)}</select></div>
            <div><label for="fPrint">Printing</label><select class="control" id="fPrint">${opt(o.printing, it.printing_id)}</select></div>
            <div><label for="fHandle">Handle</label><select class="control" id="fHandle">${opt(o.handles, it.handle_id)}</select></div>
            <div><label for="fBag">Gallery bag no. (optional)</label><input class="control" id="fBag" type="number" min="1" max="99" value="${esc(it.gallery_bag_no)}"></div>
          </div>
        </fieldset>

        <fieldset><legend>Quantity tiers (pcs, minimum 500, all different)</legend>
          <div class="grid four">${qty.map((n, i) =>
            `<div><label for="fQ${i}">Tier ${i + 1}</label><input class="control" id="fQ${i}" type="number" value="${esc(n)}"></div>`).join('')}</div>
        </fieldset>

        <fieldset><legend>Delivery</legend><div class="grid">
          <div><label for="fCountry">Country</label><select class="control" id="fCountry">
            <option value="MY" ${q.delivery_country === 'MY' ? 'selected' : ''}>Malaysia</option>
            <option value="SG" ${q.delivery_country === 'SG' ? 'selected' : ''}>Singapore</option></select></div>
          <div><label for="fPost">Postcode</label><input class="control" id="fPost" value="${esc(q.postcode)}"></div>
          <div><label for="fArea">Area / town</label><input class="control" id="fArea" value="${esc(q.delivery_area)}"></div>
          <div><label for="fState">State</label><input class="control" id="fState" value="${esc(q.delivery_state)}"></div>
        </div></fieldset>

        <p class="msg" id="msg" role="alert"></p>
        <div class="drawer-actions">
          <button class="btn danger" id="delBtn" type="button">Delete quotation</button>
          <span><button class="btn" id="cancelBtn" type="button">Close</button> <button class="btn primary" id="saveBtn" type="submit">Save changes</button></span>
        </div>
      </form>`);

    const calc = () => {
      const h = +$('fH').value, w = +$('fW').value, g = +$('fG').value;
      $('calc').textContent = h && w && g ? `Bag volume (H × W × G): ${(h * w * g / 1000).toLocaleString()} cm³` : '';
    };
    ['fH', 'fW', 'fG'].forEach((k) => $(k).addEventListener('input', calc));
    calc();

    $('closeBtn').onclick = $('cancelBtn').onclick = closeDrawer;
    $('editForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const msg = $('msg');
      msg.textContent = ''; msg.className = 'msg';
      $('saveBtn').disabled = true;
      try {
        await API.save(id, {
          status: $('fStatus').value,
          quotation_purpose: $('fPurpose').value,
          height_mm: $('fH').value, width_mm: $('fW').value, gusset_mm: $('fG').value,
          paper_id: $('fPaper').value, printing_id: $('fPrint').value, handle_id: $('fHandle').value,
          gallery_bag_no: $('fBag').value,
          quantities: [0, 1, 2, 3].map((i) => $('fQ' + i).value),
          delivery_country: $('fCountry').value, delivery_area: $('fArea').value,
          delivery_state: $('fState').value, postcode: $('fPost').value
        });
        await refresh();
        await openEditor(id); // reload so the data check reflects what is now saved
        const m = $('msg'); m.textContent = 'Saved.'; m.className = 'msg good';
      } catch (e) { handleError(e, msg); }
      finally { const b = $('saveBtn'); if (b) b.disabled = false; }
    };
    $('delBtn').onclick = async () => {
      if (!confirm('Delete this quotation and its quantities? This cannot be undone.')) return;
      try { await API.remove(id); closeDrawer(); refresh(); } catch (e) { handleError(e, $('msg')); }
    };
  }

  // ---------- Wiring ----------
  $('stats').addEventListener('click', (e) => {
    const b = e.target.closest('.stat'); if (!b) return;
    state.status = b.dataset.status; state.page = 1; refresh();
  });
  $('rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]'); if (tr) openEditor(tr.dataset.id);
  });
  $('prev').onclick = () => { state.page--; loadList().catch(handleError); };
  $('next').onclick = () => { state.page++; loadList().catch(handleError); };
  let timer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; loadList().catch(handleError); }, 300);
  });
  $('scrim').onclick = closeDrawer;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  $('logoutBtn').onclick = async () => {
    try {
      localStorage.removeItem('user');
      sessionStorage.removeItem('user');
    } catch (e) {}
    try { await fetch(LOGOUT_URL, { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
    location.href = LOGIN_URL;
  };

  API.me().then((m) => {
    $('adminName').textContent = m.role ? `${m.name} · ${m.role}` : m.name;
  }).catch(handleError);
  refresh();
})();