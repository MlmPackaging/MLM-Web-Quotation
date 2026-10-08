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
    // -> { rows } only this customer's quotations. session = { customer_id, email }
    mine: (session) => request(BASE + '/mine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session)
    }),
    // -> { quotation }
    mineDetail: (id, session) => request(BASE + '/mine/' + id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session)
    }),
    submit: (payload) => request(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  };
})();