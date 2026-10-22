/**
 * מבצע תפילין – קלפיות יום הבחירות
 * Google Apps Script backend (deploy as Web App).
 *
 * Sheets (created automatically on first request, or by running setup()):
 *   Stations: id | name | address | notes | slots
 *   Signups:  id | stationId | slot | name | phone | createdAt
 *
 * "slots" is a comma-separated list of the station's active hours,
 * e.g. "09:00-10:00,10:00-11:00".
 */

// ===== Settings – change the password before deploying! =====
const ADMIN_PASSWORD = 'tefillin770';

const SLOTS = ['09:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-13:00'];

const STATIONS_SHEET = 'Stations';
const SIGNUPS_SHEET = 'Signups';
const STATION_HEADERS = ['id', 'name', 'address', 'notes', 'slots'];
const SIGNUP_HEADERS = ['id', 'stationId', 'slot', 'name', 'phone', 'createdAt'];

const INITIAL_STATIONS = [
  { name: 'אולפנת צביה', address: '', notes: '' },
  { name: 'ביה"ס בית זאב', address: '', notes: '' },
  { name: 'ביה"ס אהל מאיר', address: '', notes: '' },
  { name: 'ביה"ס אלון יזרעאל', address: '', notes: '' },
  { name: 'אורט אלון', address: 'רח\' האגס 4', notes: '' },
  { name: 'בי"ס גוונים', address: 'רחוב וולפסון', notes: 'מול הבית של קרץ' },
  { name: 'בית ספר יהודה', address: '', notes: '' },
];

// ===== Entry points =====

function doGet(e) {
  return handle_((e && e.parameter) || {});
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'בקשה לא תקינה' });
  }
  return handle_(body);
}

/** Run once from the editor (optional) – creates the sheets and seeds the stations. */
function setup() {
  getStationsSheet_();
  getSignupsSheet_();
}

// ===== Router =====

function handle_(req) {
  try {
    let result;
    switch (req.action || 'getPublic') {
      case 'getPublic':
        result = getPublic_();
        break;
      case 'signup':
        result = signup_(req);
        break;
      case 'login':
        requireAdmin_(req);
        result = {};
        break;
      case 'getAdmin':
        requireAdmin_(req);
        result = getAdmin_();
        break;
      case 'saveStation':
        requireAdmin_(req);
        result = saveStation_(req.station || {});
        break;
      case 'deleteStation':
        requireAdmin_(req);
        result = deleteStation_(req.id);
        break;
      case 'adminSetSlot':
        requireAdmin_(req);
        result = adminSetSlot_(req);
        break;
      case 'cancelSignup':
        requireAdmin_(req);
        result = cancelSignup_(req.id);
        break;
      default:
        throw new Error('פעולה לא מוכרת');
    }
    return json_(Object.assign({ ok: true }, result));
  } catch (err) {
    return json_({ ok: false, error: err.message });
  }
}

// ===== Actions =====

function getPublic_() {
  const signups = readRows_(getSignupsSheet_());
  const taken = {};
  signups.forEach(s => { taken[s.stationId + '|' + s.slot] = s.name; });

  const stations = readStations_().map(st => ({
    id: st.id,
    name: st.name,
    address: st.address,
    notes: st.notes,
    // Only the volunteer's name is public; phone numbers are visible to the admin only.
    slots: st.slots.map(slot => ({ slot: slot, name: taken[st.id + '|' + slot] || '' })),
  }));
  return { stations: stations };
}

function getAdmin_() {
  return {
    allSlots: SLOTS,
    stations: readStations_(),
    signups: readRows_(getSignupsSheet_()),
  };
}

function signup_(req) {
  const stationId = String(req.stationId || '');
  const slot = String(req.slot || '');
  const { name, phone } = validatePerson_(req);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const station = readStations_().find(s => s.id === stationId);
    if (!station) throw new Error('הקלפי לא נמצאה');
    if (station.slots.indexOf(slot) === -1) throw new Error('המשמרת אינה פעילה בקלפי זו');

    const sheet = getSignupsSheet_();
    const signups = readRows_(sheet);
    if (signups.some(s => s.stationId === stationId && s.slot === slot)) {
      throw new Error('מצטערים, המשמרת הזו נתפסה כרגע. אנא בחרו משמרת אחרת.');
    }
    if (signups.some(s => s.phone === phone && s.slot === slot)) {
      throw new Error('מספר הטלפון הזה כבר רשום למשמרת בשעה זו בקלפי אחרת');
    }

    appendRow_(sheet, [newId_(), stationId, slot, name, phone, now_()]);
    return { station: station.name, slot: slot };
  } finally {
    lock.releaseLock();
  }
}

/** Admin: put a volunteer in a slot, replacing whoever is there (used for both assigning and editing). */
function adminSetSlot_(req) {
  const stationId = String(req.stationId || '');
  const slot = String(req.slot || '');
  const { name, phone } = validatePerson_(req);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const station = readStations_().find(s => s.id === stationId);
    if (!station) throw new Error('הקלפי לא נמצאה');
    if (SLOTS.indexOf(slot) === -1) throw new Error('משמרת לא תקינה');

    const sheet = getSignupsSheet_();
    const values = sheet.getDataRange().getValues();
    for (let i = values.length - 1; i >= 1; i--) {
      if (String(values[i][1]) === stationId && String(values[i][2]) === slot) sheet.deleteRow(i + 1);
    }
    appendRow_(sheet, [newId_(), stationId, slot, name, phone, now_()]);
    return {};
  } finally {
    lock.releaseLock();
  }
}

function saveStation_(input) {
  const name = clean_(input.name, 100);
  if (!name) throw new Error('יש להזין שם לקלפי');
  const slots = (input.slots || []).filter(s => SLOTS.indexOf(s) !== -1);
  const row = [
    input.id ? String(input.id) : newId_(),
    name,
    clean_(input.address, 200),
    clean_(input.notes, 500),
    slots.join(','),
  ];

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getStationsSheet_();
    if (input.id) {
      const rowNum = findRow_(sheet, input.id);
      if (!rowNum) throw new Error('הקלפי לא נמצאה');
      writeRow_(sheet, rowNum, row);
    } else {
      appendRow_(sheet, row);
    }
    return { id: row[0] };
  } finally {
    lock.releaseLock();
  }
}

function deleteStation_(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getStationsSheet_();
    const rowNum = findRow_(sheet, id);
    if (!rowNum) throw new Error('הקלפי לא נמצאה');
    sheet.deleteRow(rowNum);

    // Remove the station's signups too (bottom-up so row numbers stay valid).
    const signupsSheet = getSignupsSheet_();
    const values = signupsSheet.getDataRange().getValues();
    for (let i = values.length - 1; i >= 1; i--) {
      if (String(values[i][1]) === String(id)) signupsSheet.deleteRow(i + 1);
    }
    return {};
  } finally {
    lock.releaseLock();
  }
}

function cancelSignup_(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSignupsSheet_();
    const rowNum = findRow_(sheet, id);
    if (!rowNum) throw new Error('ההרשמה לא נמצאה');
    sheet.deleteRow(rowNum);
    return {};
  } finally {
    lock.releaseLock();
  }
}

// ===== Sheet helpers =====

function getStationsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(STATIONS_SHEET);
  if (!sheet) {
    sheet = createSheet_(ss, STATIONS_SHEET, STATION_HEADERS);
    INITIAL_STATIONS.forEach(st => {
      appendRow_(sheet, [newId_(), st.name, st.address, st.notes, SLOTS.join(',')]);
    });
  }
  return sheet;
}

function getSignupsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SIGNUPS_SHEET) || createSheet_(ss, SIGNUPS_SHEET, SIGNUP_HEADERS);
}

function createSheet_(ss, name, headers) {
  const sheet = ss.insertSheet(name);
  sheet.setRightToLeft(true);
  // Plain-text format keeps leading zeros in phone numbers and stops "09:00-10:00" from becoming a date.
  sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

function readRows_(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values.shift() || [];
  return values
    .filter(r => r[0] !== '')
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = String(r[i]); });
      return obj;
    });
}

function readStations_() {
  return readRows_(getStationsSheet_()).map(st => Object.assign(st, {
    slots: st.slots ? st.slots.split(',').filter(s => SLOTS.indexOf(s) !== -1) : [],
  }));
}

function findRow_(sheet, id) {
  const ids = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (let i = 1; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 1;
  }
  return 0;
}

function appendRow_(sheet, values) {
  const rowNum = sheet.getLastRow() + 1;
  if (rowNum > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 50);
  writeRow_(sheet, rowNum, values);
}

function writeRow_(sheet, rowNum, values) {
  sheet.getRange(rowNum, 1, 1, values.length).setNumberFormat('@').setValues([values]);
}

// ===== Misc helpers =====

function requireAdmin_(req) {
  if (String(req.password || '') !== ADMIN_PASSWORD) throw new Error('סיסמה שגויה');
}

/** Full name (at least two words) and an Israeli phone number are required for every signup. */
function validatePerson_(req) {
  const name = clean_(req.name, 60).replace(/\s+/g, ' ');
  const phone = String(req.phone || '').replace(/\D/g, '');
  if (name.split(' ').filter(w => w.length > 1).length < 2) throw new Error('יש להזין שם מלא (שם פרטי ושם משפחה)');
  if (!/^0\d{8,9}$/.test(phone)) throw new Error('מספר טלפון לא תקין');
  return { name: name, phone: phone };
}

function clean_(value, maxLen) {
  return String(value || '').trim().slice(0, maxLen);
}

function newId_() {
  return Utilities.getUuid().slice(0, 8);
}

function now_() {
  return Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
