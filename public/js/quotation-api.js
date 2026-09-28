// All server calls for the quotation page live here.
window.QuotationAPI = (function () {
  const BASE = '/api/quotation';

  async function request(url, options) {
    const res = await fetch(url, options);
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok || data.success === false) {
      const err = new Error(data.message || 'Request failed (' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    // -> { papers, printing, handles }
    loadOptions: () => request(BASE + '/options'),
    // -> { quotation_id, quotation_no, quantities }
    submit: (payload) => request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  };
})();