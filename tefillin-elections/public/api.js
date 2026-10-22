// Thin client for the Google Apps Script Web App.
// POST bodies are sent as text/plain so the browser skips the CORS preflight that Apps Script can't answer.
window.Api = (function () {
  function url() {
    const u = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
    if (!u) throw new Error('לא הוגדרה כתובת API בקובץ config.js');
    return u;
  }

  async function parse(res) {
    if (!res.ok) throw new Error('שגיאת תקשורת (' + res.status + ')');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'שגיאה לא ידועה');
    return data;
  }

  async function get(action) {
    const res = await fetch(url() + '?action=' + encodeURIComponent(action) + '&t=' + Date.now());
    return parse(res);
  }

  async function post(action, payload) {
    const res = await fetch(url(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action }, payload)),
    });
    return parse(res);
  }

  return {
    getPublic: () => get('getPublic'),
    signup: (stationId, slot, name, phone) => post('signup', { stationId, slot, name, phone }),
    login: (password) => post('login', { password }),
    getAdmin: (password) => post('getAdmin', { password }),
    saveStation: (password, station) => post('saveStation', { password, station }),
    deleteStation: (password, id) => post('deleteStation', { password, id }),
    adminSetSlot: (password, stationId, slot, name, phone) =>
      post('adminSetSlot', { password, stationId, slot, name, phone }),
    cancelSignup: (password, id) => post('cancelSignup', { password, id }),
  };
})();
