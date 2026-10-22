# מבצע תפילין בקלפיות – volunteer scheduler

Scheduling app for Anash volunteers doing Mivtza Tefillin at polling stations on election day (Tuesday, 16 Cheshvan).

- **Guests** (no login): see every polling station as a grid of hour slots (09:00–13:00, 1-hour each). Tap an empty slot, type full name + phone, and the name goes straight into the slot. Taken slots show the volunteer's name (never their phone). Changing or cancelling a slot is admin-only.
- **Admin** (`#/admin`, password-protected): add / edit / delete stations (name, address, notes, active hours), see every volunteer with phone, call/WhatsApp links, reassign or cancel any slot, or assign someone manually.
- **No server, no database**: data lives in a Google Sheet; a Google Apps Script Web App is the API. The frontend is plain static HTML/CSS/JS (no build step), so any static host works (Netlify, GitHub Pages, Cloudflare Pages…).

```
tefillin-elections/
├── google-apps-script/
│   ├── Code.gs                 ← paste into the Google Sheet's Apps Script editor
│   └── initial-stations.json   ← the 7 initial stations (also built into Code.gs)
├── public/                     ← the website (this folder is what gets hosted)
│   ├── index.html
│   ├── style.css
│   ├── config.js               ← put your Apps Script URL here
│   ├── api.js                  ← fetch calls to the Apps Script
│   └── app.js                  ← UI, routing (guest / admin), signup logic
├── netlify.toml
└── README.md
```

---

## Step 1 – Google Sheet + Apps Script (the API)

1. Go to <https://sheets.new> and name the spreadsheet, e.g. `מבצע תפילין – קלפיות`.
2. Menu **Extensions → Apps Script**.
3. Delete the default code in `Code.gs` and paste the full contents of [`google-apps-script/Code.gs`](google-apps-script/Code.gs).
4. **Change the admin password** on the line `const ADMIN_PASSWORD = 'tefillin770';`. The password is checked on the server only; it never appears in the website code.
5. Save (💾). In the function dropdown at the top choose **`setup`** and click **Run**. Approve the permissions prompt (Google shows "unverified app" because it's your own script: **Advanced → Go to … (unsafe) → Allow**).
   This creates the `Stations` sheet (with the 7 initial stations, all 4 hours active) and the `Signups` sheet. (If you skip this step, the sheets are created automatically on the first request anyway.)
6. Click **Deploy → New deployment** → ⚙️ **Select type → Web app**:
   - Description: anything
   - **Execute as: Me**
   - **Who has access: Anyone**
7. Click **Deploy**, then copy the **Web app URL** (it looks like `https://script.google.com/macros/s/AKfy…/exec`).

> ⚠️ **Updating the script later:** after any change to `Code.gs`, go to **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. Otherwise the URL keeps running the old code. The URL itself stays the same.

**Quick test:** open `<your URL>?action=getPublic` in the browser. You should see JSON with `"ok":true` and the 7 stations.

### API reference

| Action | Method | Who | Params |
|---|---|---|---|
| `getPublic` | GET | anyone | – |
| `signup` | POST | anyone | `stationId, slot, name, phone` |
| `login` | POST | admin | `password` |
| `getAdmin` | POST | admin | `password` |
| `saveStation` | POST | admin | `password, station{id?, name, address, notes, slots[]}` |
| `deleteStation` | POST | admin | `password, id` (also deletes its signups) |
| `adminSetSlot` | POST | admin | `password, stationId, slot, name, phone` (assign/replace) |
| `cancelSignup` | POST | admin | `password, id` |

POST bodies are JSON sent as `text/plain`, which avoids the CORS preflight that Apps Script can't handle. Signups use a script lock, so two people tapping the same slot at the same moment can't both get it; the second one is told it was just taken. The server also requires a full name (2+ words) and a valid Israeli phone number, and blocks the same phone from being in two stations at the same hour.

---

## Step 2 – Configure the frontend

Edit `public/config.js` and paste the URL from Step 1:

```js
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfy.../exec',
  EVENT_TITLE: 'מבצע תפילין בקלפיות',
  EVENT_DATE: 'יום שלישי, ט״ז בחשון · יום הבחירות',
};
```

To try it locally: `cd tefillin-elections/public && python3 -m http.server 8000`, then open <http://localhost:8000>. The admin screen is at <http://localhost:8000/#/admin>.

---

## Step 3 – How the app works (code overview)

- **Routing:** hash-based. `#/` is the guest board and `#/admin` is the admin panel. No server rewrites are needed, so it works on any static host.
- **Guest board (`renderPublic`)**: one card per station, one row per active hour. Empty cell → tap → inline name + phone fields → "שבצו אותי". The last-used name/phone is remembered on the device (localStorage), so signing up for a second hour is one tap.
- **Admin (`renderAdmin`)**: the password is kept in `sessionStorage` for the tab only and is sent with every admin request. Shows all 4 hours per station (inactive ones greyed out), each filled slot with phone, call and WhatsApp links, ✎ to reassign, ✕ to cancel. "+ הוספת קלפי" / ✎ / 🗑 manage stations.
- All user text is HTML-escaped before rendering.

---

## Step 4 – Publish the site

The code is already in this GitHub repo. Pick **one** host.

### Option A – Netlify (auto-deploy on every push)

1. Log in at <https://app.netlify.com> with GitHub.
2. **Add new site → Import an existing project → GitHub** → choose `my-links-app`.
3. Settings:
   - **Branch to deploy:** `main` (merge this branch into `main` first, or pick this branch)
   - **Base directory:** `tefillin-elections`
   - **Build command:** *(leave empty)*
   - **Publish directory:** `tefillin-elections/public` (Netlify fills this in from `netlify.toml`)
4. **Deploy**. Netlify gives you a URL like `https://xxxx.netlify.app`. Rename it under **Site configuration → Change site name** (e.g. `tefillin-kalpiot.netlify.app`).
5. Every push to the branch redeploys automatically.

### Option B – GitHub Pages (no extra account)

1. In the repo on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch** → Branch `main`, folder `/ (root)` → Save.
2. After about a minute the app is live at
   `https://shnotik770-netizen.github.io/my-links-app/tefillin-elections/public/`

### Option C – Cloudflare Pages

**Workers & Pages → Create → Pages → Connect to Git** → choose the repo, leave the build command empty, set **Build output directory** to `tefillin-elections/public`.

---

## Before election day – checklist

- [ ] Changed `ADMIN_PASSWORD` in `Code.gs` and redeployed (new version)
- [ ] `config.js` has the `/exec` URL
- [ ] Added addresses/notes to stations in the admin panel and unchecked hours a station doesn't run
- [ ] Did a test signup from a phone, then cancelled it from the admin panel
- [ ] Shared the site link in the Anash WhatsApp group (admin link: add `#/admin` to the URL)

The Google Sheet itself is a live backup. You can open it any time to see or export all signups.
