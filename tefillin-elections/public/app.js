(function () {
  const ALL_SLOTS = ['09:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-13:00'];
  const PASS_KEY = 'tefillin_admin_pass';
  const ME_KEY = 'tefillin_me';

  const app = document.getElementById('app');
  const modal = document.getElementById('modal');
  const modalCard = document.getElementById('modal-card');
  const toastEl = document.getElementById('toast');

  const state = {
    view: 'public',
    stations: [],   // public: [{id,name,address,notes,slots:[{slot,name}]}]
    admin: null,    // admin: {stations, signups}
    openCell: null, // "stationId|slot" of the cell whose inline form is open
    busy: false,
  };

  // ===== Utilities =====

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function slotLabel(slot) {
    // LTR isolate so "09:00–10:00" isn't flipped inside Hebrew sentences.
    return '⁦' + slot.replace('-', '–') + '⁩';
  }

  function toast(msg, type) {
    toastEl.textContent = msg;
    toastEl.className = 'toast ' + (type || 'success');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.add('hidden'), 4000);
  }

  function storage(kind) {
    try { return kind === 'session' ? window.sessionStorage : window.localStorage; } catch (e) { return null; }
  }
  function load(kind, key) {
    try { return JSON.parse(storage(kind).getItem(key)); } catch (e) { return null; }
  }
  function save(kind, key, value) {
    try { storage(kind).setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }
  function remove(kind, key) {
    try { storage(kind).removeItem(key); } catch (e) { /* storage unavailable */ }
  }

  // Same rules as the server: full name (2+ words) and an Israeli phone number.
  function validatePerson(name, phone) {
    name = name.trim().replace(/\s+/g, ' ');
    phone = phone.replace(/\D/g, '');
    if (name.split(' ').filter(w => w.length > 1).length < 2) return { error: 'יש להזין שם מלא (שם פרטי ושם משפחה)' };
    if (!/^0\d{8,9}$/.test(phone)) return { error: 'מספר טלפון לא תקין' };
    return { name, phone };
  }

  function formatPhone(p) {
    return p.length === 10 ? p.slice(0, 3) + '-' + p.slice(3) : p;
  }

  function mapsLink(address) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);
  }

  function stationMeta(st) {
    const parts = [];
    if (st.address) parts.push('<a href="' + mapsLink(st.address) + '" target="_blank" rel="noopener">📍 ' + esc(st.address) + '</a>');
    if (st.notes) parts.push('<span>📝 ' + esc(st.notes) + '</span>');
    return parts.length ? '<div class="station-meta">' + parts.join('') + '</div>' : '';
  }

  function cellForm(key, name, phone, submitLabel) {
    return (
      '<form class="cell-form" data-form="' + esc(key) + '">' +
        '<input name="name" placeholder="שם מלא" autocomplete="name" required value="' + esc(name) + '">' +
        '<input name="phone" type="tel" inputmode="tel" placeholder="טלפון" autocomplete="tel" required value="' + esc(phone) + '">' +
        '<div class="cell-form-actions">' +
          '<button type="submit" class="btn btn-gold">' + submitLabel + '</button>' +
          '<button type="button" class="btn btn-ghost" data-action="close-cell">ביטול</button>' +
        '</div>' +
      '</form>'
    );
  }

  function setBusy(form, busy) {
    state.busy = busy;
    if (form) form.querySelectorAll('button, input').forEach(el => { el.disabled = busy; });
  }

  // ===== Routing =====

  function route() {
    state.openCell = null;
    state.view = location.hash === '#/admin' ? 'admin' : 'public';
    document.getElementById('admin-link').textContent = state.view === 'admin' ? 'חזרה לשיבוץ' : 'כניסת מנהל';
    document.getElementById('admin-link').href = state.view === 'admin' ? '#/' : '#/admin';
    if (state.view === 'admin') {
      load('session', PASS_KEY) ? loadAdmin() : renderLogin();
    } else {
      loadPublic();
    }
  }

  // ===== Public (guest) view =====

  async function loadPublic() {
    app.innerHTML = '<div class="loader">טוען את רשימת הקלפיות…</div>';
    try {
      const data = await Api.getPublic();
      state.stations = data.stations;
      renderPublic();
    } catch (err) {
      app.innerHTML = '<div class="card error">' + esc(err.message) + '</div>';
    }
  }

  function renderPublic() {
    const total = state.stations.reduce((n, st) => n + st.slots.length, 0);
    const free = state.stations.reduce((n, st) => n + st.slots.filter(s => !s.name).length, 0);
    const me = load('local', ME_KEY) || {};

    let html =
      '<div class="intro card">' +
        '<p><strong>איך משתבצים?</strong> לוחצים על משבצת פנויה, כותבים שם מלא וטלפון – והשם נכנס ישר ללוח.</p>' +
        '<p class="muted">לשינוי או ביטול שיבוץ יש לפנות למנהל.</p>' +
        '<div class="progress"><div class="progress-bar" style="width:' + (total ? ((total - free) / total) * 100 : 0) + '%"></div></div>' +
        '<div class="muted small">' + free + ' משבצות פנויות מתוך ' + total + '</div>' +
      '</div>';

    if (!state.stations.length) html += '<div class="card muted">עדיין לא הוגדרו קלפיות.</div>';

    state.stations.forEach(st => {
      html += '<section class="card station"><h2>' + esc(st.name) + '</h2>' + stationMeta(st);
      if (!st.slots.length) {
        html += '<div class="muted">אין משמרות פעילות בקלפי זו</div>';
      } else {
        html += '<div class="slots">';
        st.slots.forEach(s => {
          const key = st.id + '|' + s.slot;
          let cell;
          if (s.name) {
            cell = '<div class="cell cell-taken"><span class="check">✓</span>' + esc(s.name) + '</div>';
          } else if (state.openCell === key) {
            cell = '<div class="cell cell-open">' + cellForm(key, me.name || '', me.phone || '', 'שבצו אותי') + '</div>';
          } else {
            cell = '<button class="cell cell-empty" data-action="open-cell" data-key="' + esc(key) + '">+ פנוי – לחצו לשיבוץ</button>';
          }
          html += '<div class="slot-row"><div class="slot-time">' + slotLabel(s.slot) + '</div>' + cell + '</div>';
        });
        html += '</div>';
      }
      html += '</section>';
    });

    app.innerHTML = html;
    focusOpenForm();
  }

  async function submitSignup(form, key) {
    const [stationId, slot] = key.split('|');
    const v = validatePerson(form.elements.name.value, form.elements.phone.value);
    if (v.error) return toast(v.error, 'error');

    setBusy(form, true);
    try {
      await Api.signup(stationId, slot, v.name, v.phone);
      save('local', ME_KEY, { name: v.name, phone: v.phone });
      const st = state.stations.find(x => x.id === stationId);
      st.slots.find(x => x.slot === slot).name = v.name;
      state.openCell = null;
      renderPublic();
      toast('שובצת בהצלחה! ' + st.name + ', ' + slotLabel(slot) + '. תודה ובהצלחה!');
    } catch (err) {
      toast(err.message, 'error');
      if (/נתפסה/.test(err.message)) { state.openCell = null; loadPublic(); }
    } finally {
      setBusy(form, false);
    }
  }

  // ===== Admin view =====

  function renderLogin() {
    app.innerHTML =
      '<form class="card login" data-form="login">' +
        '<h2>כניסת מנהל</h2>' +
        '<input type="password" name="password" placeholder="סיסמה" autocomplete="current-password" required>' +
        '<button class="btn btn-navy" type="submit">כניסה</button>' +
      '</form>';
    app.querySelector('input').focus();
  }

  async function submitLogin(form) {
    setBusy(form, true);
    try {
      await Api.login(form.elements.password.value);
      save('session', PASS_KEY, form.elements.password.value);
      loadAdmin();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(form, false);
    }
  }

  function password() {
    return load('session', PASS_KEY);
  }

  async function loadAdmin(quiet) {
    if (!quiet) app.innerHTML = '<div class="loader">טוען נתוני מנהל…</div>';
    try {
      state.admin = await Api.getAdmin(password());
      renderAdmin();
    } catch (err) {
      if (/סיסמה/.test(err.message)) { remove('session', PASS_KEY); renderLogin(); }
      toast(err.message, 'error');
    }
  }

  function renderAdmin() {
    const { stations, signups } = state.admin;
    const bySlot = {};
    signups.forEach(s => { bySlot[s.stationId + '|' + s.slot] = s; });
    const totalSlots = stations.reduce((n, st) => n + st.slots.length, 0);
    const filled = stations.reduce((n, st) => n + st.slots.filter(sl => bySlot[st.id + '|' + sl]).length, 0);

    let html =
      '<div class="admin-bar card">' +
        '<div class="stats">' +
          '<div><b>' + stations.length + '</b><span>קלפיות</span></div>' +
          '<div><b>' + filled + '/' + totalSlots + '</b><span>משמרות מאוישות</span></div>' +
          '<div><b>' + signups.length + '</b><span>נרשמים</span></div>' +
        '</div>' +
        '<div class="admin-actions">' +
          '<button class="btn btn-gold" data-action="add-station">+ הוספת קלפי</button>' +
          '<button class="btn btn-ghost" data-action="refresh">רענון</button>' +
          '<button class="btn btn-ghost" data-action="logout">יציאה</button>' +
        '</div>' +
      '</div>';

    stations.forEach(st => {
      html +=
        '<section class="card station">' +
          '<div class="station-head"><h2>' + esc(st.name) + '</h2>' +
            '<div class="station-tools">' +
              '<button class="icon-btn" title="עריכה" data-action="edit-station" data-id="' + esc(st.id) + '">✎</button>' +
              '<button class="icon-btn danger" title="מחיקה" data-action="delete-station" data-id="' + esc(st.id) + '">🗑</button>' +
            '</div>' +
          '</div>' + stationMeta(st) + '<div class="slots">';

      ALL_SLOTS.forEach(slot => {
        const key = st.id + '|' + slot;
        const active = st.slots.indexOf(slot) !== -1;
        const s = bySlot[key];
        let cell;
        if (state.openCell === key) {
          cell = '<div class="cell cell-open">' + cellForm(key, s ? s.name : '', s ? s.phone : '', s ? 'שמירה' : 'שיבוץ') + '</div>';
        } else if (s) {
          cell =
            '<div class="cell cell-taken admin">' +
              '<div class="who"><b>' + esc(s.name) + '</b>' +
                '<a href="tel:' + esc(s.phone) + '">' + esc(formatPhone(s.phone)) + '</a>' +
                '<a href="https://wa.me/972' + esc(s.phone.replace(/^0/, '')) + '" target="_blank" rel="noopener">וואטסאפ</a>' +
                (active ? '' : '<span class="tag">משמרת לא פעילה</span>') +
              '</div>' +
              '<div class="cell-tools">' +
                '<button class="icon-btn" title="שינוי שיבוץ" data-action="open-cell" data-key="' + esc(key) + '">✎</button>' +
                '<button class="icon-btn danger" title="ביטול שיבוץ" data-action="cancel-signup" data-id="' + esc(s.id) + '">✕</button>' +
              '</div>' +
            '</div>';
        } else if (active) {
          cell = '<button class="cell cell-empty" data-action="open-cell" data-key="' + esc(key) + '">+ פנוי – שיבוץ ידני</button>';
        } else {
          cell = '<div class="cell cell-off">לא פעיל</div>';
        }
        html += '<div class="slot-row"><div class="slot-time">' + slotLabel(slot) + '</div>' + cell + '</div>';
      });
      html += '</div></section>';
    });

    if (!stations.length) html += '<div class="card muted">אין קלפיות. הוסיפו קלפי ראשונה.</div>';
    app.innerHTML = html;
    focusOpenForm();
  }

  async function submitAdminSlot(form, key) {
    const [stationId, slot] = key.split('|');
    const v = validatePerson(form.elements.name.value, form.elements.phone.value);
    if (v.error) return toast(v.error, 'error');
    setBusy(form, true);
    try {
      await Api.adminSetSlot(password(), stationId, slot, v.name, v.phone);
      state.openCell = null;
      toast('השיבוץ נשמר');
      loadAdmin(true);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(form, false);
    }
  }

  function openStationModal(station) {
    const st = station || { id: '', name: '', address: '', notes: '', slots: ALL_SLOTS.slice() };
    modalCard.innerHTML =
      '<form data-form="station" class="station-form">' +
        '<h2>' + (station ? 'עריכת קלפי' : 'הוספת קלפי') + '</h2>' +
        '<input type="hidden" name="id" value="' + esc(st.id) + '">' +
        '<label>שם הקלפי<input name="name" required value="' + esc(st.name) + '"></label>' +
        '<label>כתובת<input name="address" value="' + esc(st.address) + '"></label>' +
        '<label>הערות<textarea name="notes" rows="2">' + esc(st.notes) + '</textarea></label>' +
        '<fieldset><legend>שעות פעילות</legend>' +
          ALL_SLOTS.map(slot =>
            '<label class="check-label"><input type="checkbox" name="slots" value="' + slot + '"' +
            (st.slots.indexOf(slot) !== -1 ? ' checked' : '') + '> ' + slotLabel(slot) + '</label>'
          ).join('') +
        '</fieldset>' +
        '<div class="modal-actions">' +
          '<button type="submit" class="btn btn-gold">שמירה</button>' +
          '<button type="button" class="btn btn-ghost" data-action="close-modal">ביטול</button>' +
        '</div>' +
      '</form>';
    modal.classList.remove('hidden');
    modalCard.querySelector('input[name=name]').focus();
  }

  function closeModal() {
    modal.classList.add('hidden');
    modalCard.innerHTML = '';
  }

  async function submitStation(form) {
    const station = {
      id: form.elements.id.value,
      name: form.elements.name.value.trim(),
      address: form.elements.address.value.trim(),
      notes: form.elements.notes.value.trim(),
      slots: Array.from(form.querySelectorAll('input[name=slots]:checked')).map(el => el.value),
    };
    if (!station.name) return toast('יש להזין שם לקלפי', 'error');
    setBusy(form, true);
    try {
      await Api.saveStation(password(), station);
      closeModal();
      toast('הקלפי נשמרה');
      loadAdmin(true);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(form, false);
    }
  }

  async function adminAction(fn, confirmMsg, okMsg) {
    if (!confirm(confirmMsg)) return;
    try {
      await fn();
      toast(okMsg);
      loadAdmin(true);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ===== Events =====

  function focusOpenForm() {
    const input = app.querySelector('.cell-form input[name=name]');
    if (!input) return;
    (input.value ? app.querySelector('.cell-form button[type=submit]') : input).focus();
  }

  function rerender() {
    state.view === 'admin' ? renderAdmin() : renderPublic();
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (e.target === modal) return closeModal();
    if (!el || state.busy) return;
    const id = el.dataset.id;

    switch (el.dataset.action) {
      case 'open-cell':
        state.openCell = el.dataset.key;
        return rerender();
      case 'close-cell':
        state.openCell = null;
        return rerender();
      case 'close-modal':
        return closeModal();
      case 'add-station':
        return openStationModal(null);
      case 'edit-station':
        return openStationModal(state.admin.stations.find(s => s.id === id));
      case 'delete-station': {
        const st = state.admin.stations.find(s => s.id === id);
        return adminAction(() => Api.deleteStation(password(), id),
          'למחוק את "' + st.name + '"? כל השיבוצים בקלפי זו יימחקו גם הם.', 'הקלפי נמחקה');
      }
      case 'cancel-signup': {
        const s = state.admin.signups.find(x => x.id === id);
        return adminAction(() => Api.cancelSignup(password(), id),
          'לבטל את השיבוץ של ' + s.name + ' (' + slotLabel(s.slot) + ')?', 'השיבוץ בוטל');
      }
      case 'refresh':
        return loadAdmin();
      case 'logout':
        remove('session', PASS_KEY);
        location.hash = '#/';
        return;
    }
  });

  document.addEventListener('submit', e => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    if (state.busy) return;
    const kind = form.dataset.form;
    if (kind === 'login') return submitLogin(form);
    if (kind === 'station') return submitStation(form);
    return state.view === 'admin' ? submitAdminSlot(form, kind) : submitSignup(form, kind);
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!modal.classList.contains('hidden')) return closeModal();
    if (state.openCell) { state.openCell = null; rerender(); }
  });

  // ===== Init =====

  const cfg = window.APP_CONFIG || {};
  if (cfg.EVENT_TITLE) {
    document.getElementById('event-title').textContent = cfg.EVENT_TITLE;
    document.title = cfg.EVENT_TITLE;
  }
  document.getElementById('event-date').textContent = cfg.EVENT_DATE || '';

  window.addEventListener('hashchange', route);
  route();
})();
