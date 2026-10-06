// All server calls for the admin quotation page live here.
window.AdminQuotationAPI = (function () {
  const BASE = '/api/admin/quotation';

  function authHeaders() {
    try {
      const raw = localStorage.getItem('user') || sessionStorage.getItem('user');
      const user = raw ? JSON.parse(raw) : null;
      return user && user.auth_token ? { Authorization: 'Bearer ' + user.auth_token } : {};
    } catch (e) {
      return {};
    }
  }

  async function request(url, options) {
    options = options || {};
    const headers = Object.assign(authHeaders(), options.headers || {});
    const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, options, { headers }));
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok || data.success === false) {
      const err = new Error(data.message || 'Request failed (' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const json = (method, body) => ({
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });

  return {
    me: () => request(BASE + '/me'),
    summary: () => request(BASE + '/summary'),
    list: (params) => request(BASE + '/list?' + new URLSearchParams(params)),
    get: (id) => request(BASE + '/' + id),
    save: (id, payload) => request(BASE + '/' + id, json('PUT', payload)),
    decide: (id, status) => request(BASE + '/' + id + '/decision', json('POST', { status })),
    remove: (id) => request(BASE + '/' + id, { method: 'DELETE' })
  };
})();