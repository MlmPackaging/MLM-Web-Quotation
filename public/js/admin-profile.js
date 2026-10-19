(function () {
  const API = window.AdminQuotationAPI;
  const LOGIN_URL = '/login.html';
  const LOGOUT_URL = '/api/logout';
  const $ = (id) => document.getElementById(id);

  function handleError(err, target) {
    if (err.status === 401) {
      try { localStorage.removeItem('user'); sessionStorage.removeItem('user'); } catch (e) {}
      location.href = LOGIN_URL; return;
    }
    if (err.status === 403) { const m = $('pageMessage'); m.textContent = err.message; m.hidden = false; return; }
    if (target) target.textContent = err.message; else alert(err.message);
  }

  function fill(u) {
    $('name').value = u.name; $('phone').value = u.phone; $('email').value = u.email; $('role').value = u.role;
    $('adminName').textContent = u.role ? u.name + ' · ' + u.role : u.name;
    $('phone').readOnly = !u.phone_supported;
    $('phoneHint').hidden = u.phone_supported;
  }

  $('pfForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = $('pfMsg'); msg.textContent = ''; msg.className = 'pf-msg';
    $('pfSave').disabled = true;
    try {
      const r = await API.saveProfile({ name: $('name').value, phone: $('phone').value });
      fill(r.user);
      try { // keep the name saved in this browser in step
        ['localStorage', 'sessionStorage'].forEach((s) => {
          const raw = window[s].getItem('user'); if (!raw) return;
          const u = JSON.parse(raw); u.user_name = r.user.name; u.name = r.user.name;
          window[s].setItem('user', JSON.stringify(u));
        });
      } catch (e) {}
      msg.textContent = 'Saved.'; msg.className = 'pf-msg good';
    } catch (e) { handleError(e, msg); }
    finally { $('pfSave').disabled = false; }
  });

  $('logoutBtn').onclick = async () => {
    try { localStorage.removeItem('user'); sessionStorage.removeItem('user'); } catch (e) {}
    try { await fetch(LOGOUT_URL, { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
    location.href = LOGIN_URL;
  };

  API.getProfile().then((r) => fill(r.user)).catch((e) => handleError(e, $('pfMsg')));
})();

//123