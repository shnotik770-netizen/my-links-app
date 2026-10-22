// Thin client for the "tefillin" Supabase Edge Function.
// No Supabase key is used here: the function holds the server key and only exposes the actions below.
// Bodies are sent as text/plain so the browser skips the CORS preflight round-trip.
window.Api = (function () {
  async function call(action, payload) {
    const url = (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '';
    if (!url) throw new Error('לא הוגדרה כתובת API בקובץ config.js');
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action: action }, payload)),
      });
    } catch (e) {
      throw new Error('אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.');
    }
    const data = await res.json().catch(() => null);
    if (!data) throw new Error('שגיאת תקשורת (' + res.status + ')');
    if (!data.ok) throw new Error(data.error || 'שגיאה לא ידועה');
    return data;
  }

  return {
    getPublic: () => call('getPublic'),
    signup: (stationId, slot, name, phone) => call('signup', { stationId, slot, name, phone }),
    login: (password) => call('login', { password }),
    getAdmin: (password) => call('getAdmin', { password }),
    saveStation: (password, station) => call('saveStation', { password, station }),
    deleteStation: (password, id) => call('deleteStation', { password, id }),
    adminSetSlot: (password, stationId, slot, name, phone) =>
      call('adminSetSlot', { password, stationId, slot, name, phone }),
    cancelSignup: (password, id) => call('cancelSignup', { password, id }),
    changePassword: (password, newPassword) => call('changePassword', { password, newPassword }),
    saveTicker: (password, lines) => call('saveTicker', { password, lines }),
    setSlotsAll: (password, add, remove) => call('setSlotsAll', { password, add, remove }),
  };
})();
