(function () {
  // Possible shift hours 08:00-18:00; each station turns on the ones it runs (new stations: 09-13).
  const ALL_SLOTS = Array.from({ length: 10 }, (_, i) => pad(8 + i) + ':00-' + pad(9 + i) + ':00');
  const DEFAULT_SLOTS = ALL_SLOTS.slice(1, 5);
  const MAX_PER_SLOT = 2;
  // Must match public/version.json (both are set by bump-version.sh).
  const VERSION = '2026.10.22-152858';
  const PASS_KEY = 'tefillin_admin_pass';
  const WA_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.6-2.1-.2-.3 0-.5.1-.6l.4-.5.3-.5v-.5c-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3M12 21.8c-1.8 0-3.5-.5-5-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A9.8 9.8 0 1 1 12 21.8M20.5 3.5A11.8 11.8 0 0 0 1.9 17.7L.2 24l6.4-1.7A11.8 11.8 0 0 0 24 12c0-3.2-1.2-6.2-3.5-8.5"/></svg>';
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
    query: '',      // search text (station or volunteer name)
    freeOnly: false, // show only unassigned hours
    busy: false,
  };

  // ===== Utilities =====

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

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

  function waLink(phone, text) {
    return 'https://wa.me/972' + phone.replace(/^0/, '') + (text ? '?text=' + encodeURIComponent(text) : '');
  }

  function stationMeta(st) {
    const parts = [];
    if (st.address) parts.push('<a href="' + mapsLink(st.address) + '" target="_blank" rel="noopener">📍 ' + esc(st.address) + '</a>');
    if (st.notes) parts.push('<span>📝 ' + esc(st.notes) + '</span>');
    let html = parts.length ? '<div class="station-meta">' + parts.join('') + '</div>' : '';
    if (st.managerName || st.managerPhone) {
      html += '<div class="manager"><span>👤 מנהל הקלפי: <b>' + esc(st.managerName || '—') + '</b></span>';
      if (st.managerPhone) {
        html += '<a class="wa-btn" href="' + esc(waLink(st.managerPhone, 'שלום, לגבי מבצע תפילין בקלפי ' + st.name)) +
          '" target="_blank" rel="noopener">' + WA_ICON + ' יצירת קשר בוואטסאפ</a>';
      }
      html += '</div>';
    }
    return html;
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

  // ===== Running banner (sentences are editable by the admin) =====

  function renderTicker(lines) {
    const bar = document.getElementById('ticker');
    const track = document.getElementById('ticker-track');
    lines = (lines || []).filter(Boolean);
    bar.classList.toggle('hidden', !lines.length);
    if (!lines.length) return;
    const run = '<span class="ticker-run">' + lines.map(l => '<span>' + esc(l) + '</span>').join('<i>✦</i>') + '<i>✦</i></span>';
    // Two identical copies so the loop is seamless; speed is based on text length.
    track.innerHTML = run + run.replace('class="ticker-run"', 'class="ticker-run" aria-hidden="true"');
    track.style.animationDuration = Math.max(20, lines.join('').length / 6) + 's';
  }

  function openTickerModal() {
    modalCard.innerHTML =
      '<form data-form="ticker" class="station-form">' +
        '<h2>משפטי הבאנר הרץ</h2>' +
        '<p class="muted small">משפט אחד בכל שורה. שורה ריקה = נמחקת. עד 20 משפטים.</p>' +
        '<textarea name="lines" rows="9">' + esc((state.admin.ticker || []).join('\n')) + '</textarea>' +
        '<div class="modal-actions">' +
          '<button type="submit" class="btn btn-gold">שמירה</button>' +
          '<button type="button" class="btn btn-ghost" data-action="close-modal">ביטול</button>' +
        '</div>' +
      '</form>';
    modal.classList.remove('hidden');
    modalCard.querySelector('textarea').focus();
  }

  async function submitTicker(form) {
    const lines = form.elements.lines.value.split('\n').map(l => l.trim()).filter(Boolean);
    setBusy(form, true);
    try {
      const res = await Api.saveTicker(password(), lines);
      state.admin.ticker = res.ticker;
      renderTicker(res.ticker);
      closeModal();
      toast('הבאנר עודכן');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(form, false);
    }
  }

  // ===== Station managers =====

  // Copies an activist's name and phone into their station's manager fields.
  function makeManager(signupId) {
    const s = state.admin.signups.find(x => x.id === signupId);
    const st = state.admin.stations.find(x => x.id === s.stationId);
    const replacing = st.managerName && st.managerPhone !== s.phone ? ' (במקום ' + st.managerName + ')' : '';
    adminAction(() => Api.saveStation(password(), Object.assign({}, st, { managerName: s.name, managerPhone: s.phone })),
      'להגדיר את ' + s.name + ' כמנהל ' + st.name + replacing + '?', s.name + ' הוגדר כמנהל הקלפי');
  }

  // Opens WhatsApp to the station manager with the admin address and the password used to log in.
  function sendLogin(stationId) {
    const st = state.admin.stations.find(x => x.id === stationId);
    const adminUrl = location.origin + location.pathname + '#/admin';
    const text =
      'שלום ' + (st.managerName || '') + ',\n' +
      'מונית כמנהל קלפי ' + st.name + ' במבצע תפילין בקלפיות.\n\n' +
      'כניסת מנהל: ' + adminUrl + '\n' +
      'סיסמה: ' + password() + '\n\n' +
      'במסך הניהול אפשר לראות את כל השיבוצים, לשבץ, לשנות ולבטל. בהצלחה!';
    window.open(waLink(st.managerPhone, text), '_blank', 'noopener');
  }

  // ===== Hours for all stations at once =====

  function openHoursModal() {
    const stations = state.admin.stations;
    modalCard.innerHTML =
      '<form data-form="hours" class="station-form">' +
        '<h2>שעות משמרת לכל הקלפיות</h2>' +
        '<p class="muted small">סימון מוסיף את השעה לכל הקלפיות, ביטול סימון מסיר אותה מכולן. ' +
          'שעה שפעילה רק בחלק מהקלפיות מסומנת חלקית ולא תשתנה אם לא תלחצו עליה.</p>' +
        '<fieldset><legend>שעות</legend>' +
          ALL_SLOTS.map(slot => {
            const n = stations.filter(st => st.slots.indexOf(slot) !== -1).length;
            const initial = n === 0 ? 'none' : n === stations.length ? 'all' : 'some';
            return '<label class="check-label"><input type="checkbox" name="slots" value="' + slot + '" data-initial="' + initial + '"' +
              (initial === 'all' ? ' checked' : '') + '> ' + slotLabel(slot) + '</label>';
          }).join('') +
        '</fieldset>' +
        '<div class="modal-actions">' +
          '<button type="submit" class="btn btn-gold">שמירה</button>' +
          '<button type="button" class="btn btn-ghost" data-action="close-modal">ביטול</button>' +
        '</div>' +
      '</form>';
    modalCard.querySelectorAll('input[data-initial=some]').forEach(el => { el.indeterminate = true; });
    modal.classList.remove('hidden');
  }

  async function submitHours(form) {
    const add = [], removeSlots = [];
    form.querySelectorAll('input[name=slots]').forEach(el => {
      if (el.indeterminate) return; // untouched partial hour
      if (el.checked && el.dataset.initial !== 'all') add.push(el.value);
      if (!el.checked && el.dataset.initial !== 'none') removeSlots.push(el.value);
    });
    if (!add.length && !removeSlots.length) return closeModal();
    const affected = state.admin.signups.filter(s => removeSlots.indexOf(s.slot) !== -1).length;
    if (affected && !confirm('יש ' + affected + ' משובצים בשעות שמוסרות. השיבוצים יישמרו ויוצגו למנהל כ"משמרת לא פעילה". להמשיך?')) return;
    setBusy(form, true);
    try {
      await Api.setSlotsAll(password(), add, removeSlots);
      closeModal();
      toast('השעות עודכנו בכל הקלפיות');
      loadAdmin(true);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(form, false);
    }
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
      renderTicker(data.ticker);
      renderPublic();
    } catch (err) {
      app.innerHTML = '<div class="card error">' + esc(err.message) + '</div>';
    }
  }

  // ===== Search & "free hours only" filter (shared by both views) =====

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/["'״׳`]/g, '').replace(/\s+/g, ' ').trim();
  }

  function toolbar(freeCount, stations) {
    return (
      '<div class="toolbar">' +
        '<div class="toolbar-row">' +
          '<input type="search" id="search" placeholder="🔍 חיפוש קלפי או שם משובץ…" value="' + esc(state.query) + '" aria-label="חיפוש">' +
          '<button class="chip' + (state.freeOnly ? ' active' : '') + '" data-action="toggle-free" aria-pressed="' + state.freeOnly + '">' +
            'רק פנויות <span class="chip-count">' + freeCount + '</span>' +
          '</button>' +
        '</div>' +
        // Quick jump: one button per station, scrolls straight to its card.
        '<nav class="jump" aria-label="מעבר מהיר לקלפי">' +
          stations.map(st => '<button class="jump-btn" data-action="jump" data-id="' + esc(st.id) + '">' + esc(st.name) + '</button>').join('') +
        '</nav>' +
      '</div>' +
      '<div id="list"></div>'
    );
  }

  function slotTime(slot) {
    const [from, to] = slot.split('-');
    return '<div class="slot-time"><b>' + from + '</b><span>עד ' + to + '</span></div>';
  }

  function jumpTo(id) {
    let card = document.getElementById('st-' + id);
    if (!card && (state.query || state.freeOnly)) {
      // The station is hidden by the search/filter – clear them so it can be shown.
      state.query = '';
      state.freeOnly = false;
      document.getElementById('search').value = '';
      const chip = app.querySelector('[data-action=toggle-free]');
      chip.classList.remove('active');
      chip.setAttribute('aria-pressed', 'false');
      rerender();
      card = document.getElementById('st-' + id);
    }
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.remove('flash');
    void card.offsetWidth; // restart the highlight animation
    card.classList.add('flash');
  }

  // Returns the slots of a station that pass the current search/filter (null = hide the station).
  function filterSlots(station, slots, isFree, personText) {
    const q = normalize(state.query);
    const stationHit = !q || normalize([station.name, station.address, station.notes, station.managerName].join(' ')).includes(q);
    const visible = slots.filter(s =>
      (!state.freeOnly || isFree(s)) && (stationHit || normalize(personText(s)).includes(q)));
    if (!visible.length && (q || state.freeOnly)) return null;
    return visible;
  }

  function noResults() {
    return '<div class="card muted empty">לא נמצאו ' + (state.freeOnly ? 'שעות פנויות' : 'תוצאות') +
      (state.query ? ' עבור "' + esc(state.query) + '"' : '') + '</div>';
  }

  function renderPublic() {
    const total = state.stations.reduce((n, st) => n + st.slots.length, 0);
    const free = state.stations.reduce((n, st) => n + st.slots.filter(s => !s.names.length).length, 0);

    app.innerHTML =
      '<div class="intro card">' +
        '<p><strong>איך משתבצים?</strong> לוחצים על משבצת פנויה, כותבים שם מלא וטלפון – והשם נכנס ישר ללוח.</p>' +
        '<p class="muted">לשינוי או ביטול שיבוץ יש לפנות לאחד ממנהלי הקלפיות (כפתור הוואטסאפ שליד כל קלפי).</p>' +
        '<div class="progress"><div class="progress-bar" style="width:' + (total ? ((total - free) / total) * 100 : 0) + '%"></div></div>' +
        '<div class="muted small">' + free + ' משבצות פנויות מתוך ' + total + '</div>' +
      '</div>' + toolbar(free, state.stations);
    renderPublicList();
  }

  function renderPublicList() {
    const me = load('local', ME_KEY) || {};
    let html = '';

    if (!state.stations.length) html += '<div class="card muted">עדיין לא הוגדרו קלפיות.</div>';

    state.stations.forEach(st => {
      const slots = filterSlots(st, st.slots, s => !s.names.length, s => s.names.join(' '));
      if (!slots) return;
      html += '<section class="card station" id="st-' + esc(st.id) + '"><h2>' + esc(st.name) + '</h2>' + stationMeta(st);
      if (!slots.length) {
        html += '<div class="muted">אין משמרות פעילות בקלפי זו</div>';
      } else {
        html += '<div class="slots">';
        slots.forEach(s => {
          // Up to 2 volunteers per hour: the first fills the cell, then "+ הוסף פעיל" offers a second place.
          const key = st.id + '|' + s.slot;
          let cells = s.names.map(n => '<div class="cell cell-taken"><span class="check">✓</span>' + esc(n) + '</div>').join('');
          if (s.names.length < MAX_PER_SLOT) {
            if (state.openCell === key) {
              cells += '<div class="cell cell-open">' + cellForm(key, me.name || '', me.phone || '', s.names.length ? 'הוספה' : 'שבצו אותי') + '</div>';
            } else if (s.names.length) {
              cells += '<button class="add-seat" data-action="open-cell" data-key="' + esc(key) + '">+ הוסף פעיל</button>';
            } else {
              cells += '<button class="cell cell-empty" data-action="open-cell" data-key="' + esc(key) + '">+ פנוי – לחצו לשיבוץ</button>';
            }
          }
          html += '<div class="slot-row">' + slotTime(s.slot) + '<div class="cell-stack">' + cells + '</div></div>';
        });
        html += '</div>';
      }
      html += '</section>';
    });

    if (state.stations.length && !html) html = noResults();
    document.getElementById('list').innerHTML = html;
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
      st.slots.find(x => x.slot === slot).names.push(v.name);
      state.openCell = null;
      renderPublic();
      toast('שובצת בהצלחה! ' + st.name + ', ' + slotLabel(slot) + '. תודה ובהצלחה!');
    } catch (err) {
      toast(err.message, 'error');
      if (/נתפס|מלאה/.test(err.message)) { state.openCell = null; loadPublic(); }
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
      renderTicker(state.admin.ticker);
      renderAdmin();
    } catch (err) {
      if (/סיסמה/.test(err.message)) { remove('session', PASS_KEY); renderLogin(); }
      toast(err.message, 'error');
    }
  }

  // "stationId|slot" -> [seat 1 signup, seat 2 signup] (either may be missing)
  function adminIndex() {
    const bySlot = {};
    state.admin.signups.forEach(s => {
      const k = s.stationId + '|' + s.slot;
      (bySlot[k] = bySlot[k] || [])[s.seat - 1] = s;
    });
    return bySlot;
  }

  function adminPeople(bySlot, key) {
    return (bySlot[key] || []).filter(Boolean);
  }

  function renderAdmin() {
    const { stations, signups } = state.admin;
    const bySlot = adminIndex();
    const totalSlots = stations.reduce((n, st) => n + st.slots.length, 0);
    const filled = stations.reduce((n, st) => n + st.slots.filter(sl => adminPeople(bySlot, st.id + '|' + sl).length).length, 0);

    app.innerHTML =
      '<div class="admin-bar card">' +
        '<div class="stats">' +
          '<div><b>' + stations.length + '</b><span>קלפיות</span></div>' +
          '<div><b>' + filled + '/' + totalSlots + '</b><span>משמרות מאוישות</span></div>' +
          '<div><b>' + signups.length + '</b><span>נרשמים</span></div>' +
        '</div>' +
        '<div class="admin-actions">' +
          '<button class="btn btn-gold" data-action="add-station">+ הוספת קלפי</button>' +
          '<button class="btn btn-ghost" data-action="refresh">רענון</button>' +
          '<button class="btn btn-ghost" data-action="edit-hours">שעות לכל הקלפיות</button>' +
          '<button class="btn btn-ghost" data-action="edit-ticker">משפטי הבאנר</button>' +
          '<button class="btn btn-ghost" data-action="change-password">שינוי סיסמה</button>' +
          '<button class="btn btn-ghost" data-action="logout">יציאה</button>' +
        '</div>' +
      '</div>' + toolbar(totalSlots - filled, stations);
    renderAdminList();
  }

  function renderAdminList() {
    const { stations } = state.admin;
    const bySlot = adminIndex();
    let html = '';

    stations.forEach(st => {
      const slots = filterSlots(st,
        // Active hours, plus any inactive hour that still has a volunteer in it.
        ALL_SLOTS.filter(slot => st.slots.indexOf(slot) !== -1 || adminPeople(bySlot, st.id + '|' + slot).length),
        slot => st.slots.indexOf(slot) !== -1 && !adminPeople(bySlot, st.id + '|' + slot).length,
        slot => adminPeople(bySlot, st.id + '|' + slot).map(s => s.name + ' ' + s.phone).join(' '));
      if (!slots) return;
      html +=
        '<section class="card station" id="st-' + esc(st.id) + '">' +
          '<div class="station-head"><h2>' + esc(st.name) + '</h2>' +
            '<div class="station-tools">' +
              '<button class="icon-btn" title="עריכה" data-action="edit-station" data-id="' + esc(st.id) + '">✎</button>' +
              '<button class="icon-btn danger" title="מחיקה" data-action="delete-station" data-id="' + esc(st.id) + '">🗑</button>' +
            '</div>' +
          '</div>' + stationMeta(st) +
          (st.managerPhone
            ? '<button class="btn btn-ghost send-login" data-action="send-login" data-id="' + esc(st.id) + '">📲 שליחת פרטי כניסה למנהל הקלפי בוואטסאפ</button>'
            : '') +
          '<div class="slots">';

      slots.forEach(slot => {
        const active = st.slots.indexOf(slot) !== -1;
        const seats = bySlot[st.id + '|' + slot] || [];
        let cells = '';
        for (let seat = 1; seat <= MAX_PER_SLOT; seat++) {
          const key = st.id + '|' + slot + '|' + seat;
          const s = seats[seat - 1];
          if (state.openCell === key) {
            cells += '<div class="cell cell-open">' + cellForm(key, s ? s.name : '', s ? s.phone : '', s ? 'שמירה' : 'שיבוץ') + '</div>';
          } else if (s) {
            cells +=
              '<div class="cell cell-taken admin">' +
                '<div class="who"><b>' + esc(s.name) + '</b>' +
                  '<a href="tel:' + esc(s.phone) + '">' + esc(formatPhone(s.phone)) + '</a>' +
                  '<a href="' + esc(waLink(s.phone)) + '" target="_blank" rel="noopener">וואטסאפ</a>' +
                  (active ? '' : '<span class="tag">משמרת לא פעילה</span>') +
                  (s.phone === st.managerPhone ? '<span class="tag tag-manager">מנהל הקלפי</span>' : '') +
                '</div>' +
                '<div class="cell-tools">' +
                  (s.phone === st.managerPhone ? '' :
                    '<button class="icon-btn" title="הפוך למנהל הקלפי" data-action="make-manager" data-id="' + esc(s.id) + '">👤</button>') +
                  '<button class="icon-btn" title="שינוי שיבוץ" data-action="open-cell" data-key="' + esc(key) + '">✎</button>' +
                  '<button class="icon-btn danger" title="ביטול שיבוץ" data-action="cancel-signup" data-id="' + esc(s.id) + '">✕</button>' +
                '</div>' +
              '</div>';
          } else if (seat === 1) {
            cells += '<button class="cell cell-empty" data-action="open-cell" data-key="' + esc(key) + '">+ פנוי – שיבוץ ידני</button>';
          } else if (seats[0]) {
            cells += '<button class="add-seat" data-action="open-cell" data-key="' + esc(key) + '">+ הוסף פעיל</button>';
          }
        }
        html += '<div class="slot-row">' + slotTime(slot) + '<div class="cell-stack">' + cells + '</div></div>';
      });
      html += '</div></section>';
    });

    if (!stations.length) html = '<div class="card muted">אין קלפיות. הוסיפו קלפי ראשונה.</div>';
    else if (!html) html = noResults();
    document.getElementById('list').innerHTML = html;
    focusOpenForm();
  }

  async function submitAdminSlot(form, key) {
    const [stationId, slot, seat] = key.split('|');
    const v = validatePerson(form.elements.name.value, form.elements.phone.value);
    if (v.error) return toast(v.error, 'error');
    setBusy(form, true);
    try {
      await Api.adminSetSeat(password(), stationId, slot, Number(seat), v.name, v.phone);
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
    const st = station || { id: '', name: '', address: '', notes: '', managerName: '', managerPhone: '', slots: DEFAULT_SLOTS.slice() };
    modalCard.innerHTML =
      '<form data-form="station" class="station-form">' +
        '<h2>' + (station ? 'עריכת קלפי' : 'הוספת קלפי') + '</h2>' +
        '<input type="hidden" name="id" value="' + esc(st.id) + '">' +
        '<label>שם הקלפי<input name="name" required value="' + esc(st.name) + '"></label>' +
        '<label>כתובת<input name="address" value="' + esc(st.address) + '"></label>' +
        '<label>הערות<textarea name="notes" rows="2">' + esc(st.notes) + '</textarea></label>' +
        '<div class="form-row">' +
          '<label>שם מנהל הקלפי<input name="managerName" value="' + esc(st.managerName || '') + '"></label>' +
          '<label>טלפון מנהל הקלפי<input name="managerPhone" type="tel" inputmode="tel" value="' + esc(st.managerPhone || '') + '"></label>' +
        '</div>' +
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
      managerName: form.elements.managerName.value.trim(),
      managerPhone: form.elements.managerPhone.value.replace(/\D/g, ''),
      slots: Array.from(form.querySelectorAll('input[name=slots]:checked')).map(el => el.value),
    };
    if (!station.name) return toast('יש להזין שם לקלפי', 'error');
    if (station.managerPhone && !/^0\d{8,9}$/.test(station.managerPhone)) return toast('מספר הטלפון של מנהל הקלפי לא תקין', 'error');
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

  // Redraws only the station list, so the search box keeps focus while typing.
  function rerender() {
    state.view === 'admin' ? renderAdminList() : renderPublicList();
  }

  async function changePassword() {
    const next = prompt('סיסמה חדשה (לפחות 6 תווים):');
    if (next == null) return;
    try {
      await Api.changePassword(password(), next);
      save('session', PASS_KEY, next);
      toast('הסיסמה עודכנה');
    } catch (err) {
      toast(err.message, 'error');
    }
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
      case 'toggle-free':
        state.freeOnly = !state.freeOnly;
        state.openCell = null;
        el.classList.toggle('active', state.freeOnly);
        el.setAttribute('aria-pressed', state.freeOnly);
        return rerender();
      case 'change-password':
        return changePassword();
      case 'edit-ticker':
        return openTickerModal();
      case 'edit-hours':
        return openHoursModal();
      case 'make-manager':
        return makeManager(id);
      case 'send-login':
        return sendLogin(id);
      case 'jump':
        return jumpTo(id);
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
    if (kind === 'ticker') return submitTicker(form);
    if (kind === 'hours') return submitHours(form);
    return state.view === 'admin' ? submitAdminSlot(form, kind) : submitSignup(form, kind);
  });

  document.addEventListener('input', e => {
    if (e.target.id !== 'search') return;
    state.query = e.target.value;
    state.openCell = null;
    rerender();
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

  // Browsers may keep an old copy of the site's files for a few minutes after an update.
  // If the server has a newer version than the code running now, reload once to pick it up.
  async function checkForUpdate() {
    try {
      const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      const latest = (await res.json()).version;
      if (latest && latest !== VERSION && sessionStorage.getItem('tefillin_reloaded_for') !== latest) {
        sessionStorage.setItem('tefillin_reloaded_for', latest);
        location.reload();
      }
    } catch (e) { /* offline or storage blocked – keep running the current version */ }
  }

  window.addEventListener('hashchange', route);
  route();
  checkForUpdate();
})();
