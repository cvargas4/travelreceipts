/* Trip Receipts — collect conference travel receipts, export a spreadsheet + PDF.
   Everything is stored on this device in IndexedDB. No server. */
'use strict';

(() => {
  const VERSION = '1.2.0';
  const CATEGORIES = ['Food', 'Hotel', 'Airfare', 'Transportation', 'Registration', 'Other'];
  const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'MXN', 'JPY', 'CHF', 'AUD', 'NZD', 'CNY', 'HKD', 'SGD', 'KRW',
    'INR', 'THB', 'BRL', 'ZAR', 'SEK', 'NOK', 'DKK', 'ISK', 'PLN', 'CZK', 'HUF', 'TRY', 'ILS', 'AED'];
  const PDFLIB_SRC = 'vendor/pdf-lib.min.js';
  const EXCELJS_SRC = 'vendor/exceljs.min.js';
  const BACKUP_APP = 'trip-receipts';

  /* =========================================================
     Small helpers
     ========================================================= */

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const uid = () => (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const uniq = (a) => [...new Set(a)];
  const catClass = (c) => 'cat-' + (CATEGORIES.includes(c) ? c.toLowerCase() : 'other');

  const dfLong = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const dfShort = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  const dfDay = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtDate = (s) => (isISO(s) ? dfLong.format(parseISO(s)) : '');
  const fmtDay = (s) => (isISO(s) ? dfDay.format(parseISO(s)) : 'No date');
  function fmtRange(a, b) {
    if (!isISO(a) && !isISO(b)) return '';
    if (!isISO(a) || !isISO(b) || a === b) return fmtDate(isISO(a) ? a : b);
    const A = parseISO(a), B = parseISO(b);
    if (A.getFullYear() === B.getFullYear()) return `${dfShort.format(A)} – ${dfLong.format(B)}`;
    return `${fmtDate(a)} – ${fmtDate(b)}`;
  }
  const nightsBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);

  function fmtMoney(n, cur = 'USD') {
    if (n == null || Number.isNaN(n)) return '';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency', currency: cur, currencyDisplay: cur === 'USD' ? 'symbol' : 'code',
      }).format(n).replace(/ /g, ' ');
    } catch {
      return `${cur} ${Number(n).toFixed(2)}`;
    }
  }

  // Accepts "1,234.50", "1.234,50", "12,5", "$45", "45 €"
  function parseAmount(v) {
    if (v == null) return null;
    let s = String(v).trim().replace(/[\s '’]/g, '').replace(/[^\d.,-]/g, '');
    if (!s) return null;
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc > ld) {
      const decimals = s.length - lc - 1;
      s = decimals <= 2 ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else {
      s = s.replace(/,/g, '');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  // Show a stored amount the way it's normally written: 23.50, not 23.5 (and 4800 for yen)
  function amountInput(n, cur) {
    let digits = 2;
    try { digits = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD' }).resolvedOptions().maximumFractionDigits; } catch { /* keep 2 */ }
    return Number.isInteger(n * 10 ** digits) || Math.abs(n * 10 ** digits - Math.round(n * 10 ** digits)) < 1e-9 ? n.toFixed(digits) : String(n);
  }

  // Speedtypes: the university's 10-digit account numbers. Typed into one field, separated by commas.
  function parseSpeedtypes(text) {
    const parts = String(text || '').split(',').map((s) => s.replace(/\s+/g, '')).filter(Boolean);
    return { list: uniq(parts), bad: parts.filter((p) => !/^\d{10}$/.test(p)) };
  }
  const speedtypeError = (bad) => (bad.length === 1
    ? `“${bad[0]}” isn't a 10-digit Speedtype. Separate more than one with commas.`
    : `These aren't 10-digit Speedtypes: ${bad.join(', ')}. Separate more than one with commas.`);
  const speedtypeLine = (list) => (list && list.length ? `${list.length === 1 ? 'Speedtype' : 'Speedtypes'} ${list.join(', ')}` : '');
  const SPEEDTYPE_INPUT = (value = '') => `<input name="speedtypes" autocomplete="off" autocapitalize="off" spellcheck="false"
      placeholder="e.g. 1234567890, 2345678901" value="${esc(value)}">`;

  function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function safeFileName(s) {
    return (s || 'Trip').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Trip';
  }

  // USD value of an entry, or null if it can't be worked out yet
  function usdOf(e) {
    if (e.usd != null) return round2(e.usd);
    if (e.amount == null) return null;
    if (!e.currency || e.currency === 'USD') return round2(e.amount);
    if (e.rate) return round2(e.amount * e.rate);
    return null;
  }
  const isForeign = (e) => e.currency && e.currency !== 'USD';
  const needsRate = (e) => isForeign(e) && e.amount != null && e.usd == null && !e.rate;

  let toastTimer;
  function toast(msg, ms = 2800) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  const loadedScripts = {};
  function loadScript(src) {
    if (!loadedScripts[src]) {
      loadedScripts[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => { delete loadedScripts[src]; reject(new Error(`Couldn't load ${src}. Check your connection and try again.`)); };
        document.head.appendChild(s);
      });
    }
    return loadedScripts[src];
  }

  function bufToBlobUrl(buf, type) {
    return URL.createObjectURL(new Blob([buf], { type }));
  }

  async function bufToBase64(buf) {
    const url = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(new Blob([buf]));
    });
    return url.slice(url.indexOf(',') + 1);
  }

  function base64ToBuf(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  const ICON = {
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z"/><path d="M9 8h6M9 12h6"/></svg>',
  };

  /* =========================================================
     Storage (IndexedDB)
     ========================================================= */

  const DB = (() => {
    let dbp;
    function open() {
      if (!dbp) {
        dbp = new Promise((resolve, reject) => {
          const r = indexedDB.open('trip-receipts', 1);
          r.onupgradeneeded = () => {
            const db = r.result;
            db.createObjectStore('trips', { keyPath: 'id' });
            const e = db.createObjectStore('entries', { keyPath: 'id' });
            e.createIndex('tripId', 'tripId');
            db.createObjectStore('files', { keyPath: 'id' });
            db.createObjectStore('thumbs', { keyPath: 'id' });
            db.createObjectStore('meta', { keyPath: 'key' });
          };
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
          r.onblocked = () => reject(new Error('Close other tabs of this app and reload.'));
        });
      }
      return dbp;
    }
    const wrap = (req) => new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    async function read(store, fn) {
      const db = await open();
      return wrap(fn(db.transaction(store, 'readonly').objectStore(store)));
    }
    async function write(store, fn) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(store, 'readwrite');
        fn(t.objectStore(store));
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Saving failed. The device may be out of space.'));
      });
    }
    return {
      get: (s, k) => read(s, (os) => os.get(k)),
      all: (s) => read(s, (os) => os.getAll()),
      keys: (s) => read(s, (os) => os.getAllKeys()),
      byIndex: (s, i, v) => read(s, (os) => os.index(i).getAll(v)),
      put: (s, v) => write(s, (os) => os.put(v)),
      putMany: (s, vals) => (vals.length ? write(s, (os) => vals.forEach((v) => os.put(v))) : Promise.resolve()),
      del: (s, k) => write(s, (os) => os.delete(k)),
      delMany: (s, ks) => (ks.length ? write(s, (os) => ks.forEach((k) => os.delete(k))) : Promise.resolve()),
    };
  })();

  async function getSettings() {
    return Object.assign({ key: 'settings', traveler: '', labelPages: true, autoScan: true }, await DB.get('meta', 'settings'));
  }

  let persistAsked = false;
  async function askPersist() {
    if (persistAsked) return;
    persistAsked = true;
    try {
      if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
        await navigator.storage.persist();
      }
    } catch { /* not supported */ }
  }

  const liveTrips = async () => (await DB.all('trips')).filter((t) => !t.deleted);
  const tripEntries = async (id) => (await DB.byIndex('entries', 'tripId', id)).filter((e) => !e.deleted);
  const sortEntries = (es) => es.slice().sort((a, b) =>
    (a.date || '9999').localeCompare(b.date || '9999') || (a.createdAt || 0) - (b.createdAt || 0));

  // Remove stored files nothing points to anymore
  async function collectGarbage() {
    const [trips, entries, fileIds, thumbIds] = await Promise.all([
      DB.all('trips'), DB.all('entries'), DB.keys('files'), DB.keys('thumbs')]);
    const deadTrips = new Set(trips.filter((t) => t.deleted).map((t) => t.id));
    const used = new Set();
    trips.filter((t) => !t.deleted).forEach((t) => (t.extras || []).forEach((id) => used.add(id)));
    entries.filter((e) => !e.deleted && !deadTrips.has(e.tripId))
      .forEach((e) => [...(e.receipts || []), ...(e.statements || [])].forEach((id) => used.add(id)));
    await DB.delMany('files', fileIds.filter((id) => !used.has(id)));
    await DB.delMany('thumbs', thumbIds.filter((id) => !used.has(id)));
  }

  /* =========================================================
     Exchange rates (frankfurter.dev — free, no key)
     ========================================================= */

  const rateCache = new Map();
  const rateMisses = new Map(); // key -> time of last failed lookup, so background refreshes don't retry constantly

  async function fetchWithTimeout(url, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { signal: ctl.signal, cache: 'no-store' }); } finally { clearTimeout(t); }
  }

  async function fetchRate(cur, date) {
    cur = (cur || '').toUpperCase();
    if (cur === 'USD') return { rate: 1, date, source: 'USD' };
    const key = `${cur}|${date}`;
    if (rateCache.has(key)) return rateCache.get(key);
    const api = 'https://api.frankfurter.dev';
    const c = cur.toLowerCase();
    const attempts = [
      [`${api}/v2/rate/${c}/usd?date=${date}&providers=ecb`, 'ECB reference rate'],
      [`${api}/v2/rate/${c}/usd?date=${date}`, 'Frankfurter reference rate'],
      [`${api}/v1/${date}?base=${cur}&symbols=USD`, 'ECB reference rate'],
    ];
    for (const [url, source] of attempts) {
      try {
        const res = await fetchWithTimeout(url, 8000);
        if (!res.ok) continue;
        const j = await res.json();
        const row = Array.isArray(j) ? j[0] : j;
        const rate = typeof row?.rate === 'number' ? row.rate : row?.rates?.USD;
        if (typeof rate === 'number' && rate > 0) {
          const out = { rate, date: isISO(row.date) ? row.date : date, source };
          rateCache.set(key, out);
          return out;
        }
      } catch (err) {
        if (!navigator.onLine) break;
      }
    }
    throw new Error(`No exchange rate found for ${cur} on ${fmtDate(date)}.`);
  }

  // Fill in rates that couldn't be fetched earlier (e.g. entered offline).
  // Doesn't bump updatedAt: a looked-up rate isn't a user edit, so it never wins a merge over real edits.
  async function fillMissingRates(tripId) {
    if (!navigator.onLine) return 0;
    let n = 0;
    for (const e of await tripEntries(tripId)) {
      if (!needsRate(e) || !isISO(e.date)) continue;
      const missKey = `${e.currency}|${e.date}`;
      if (Date.now() - (rateMisses.get(missKey) || 0) < 10 * 60 * 1000) continue;
      try {
        const r = await fetchRate(e.currency, e.date);
        const fresh = await DB.get('entries', e.id);
        if (!fresh || fresh.updatedAt !== e.updatedAt || !needsRate(fresh)) continue;
        Object.assign(fresh, { rate: r.rate, rateDate: r.date, rateSource: r.source });
        await DB.put('entries', fresh);
        n++;
      } catch { rateMisses.set(missKey, Date.now()); }
    }
    return n;
  }

  /* =========================================================
     Receipt files: photos and PDFs
     ========================================================= */

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('unreadable'));
      img.src = src;
    });
  }

  function canvasToBuf(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? b.arrayBuffer().then(resolve, reject) : reject(new Error('Image conversion failed.'))), type, quality);
    });
  }

  function drawScaled(img, maxDim) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const s = Math.min(1, maxDim / Math.max(iw, ih));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(iw * s));
    c.height = Math.max(1, Math.round(ih * s));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  // Photos are re-encoded as JPEG (max 2200 px) so they stay legible but small,
  // and so the camera's rotation flag is baked in. Small PNG screenshots are kept as-is.
  async function processImage(file, opts = {}) {
    const url = URL.createObjectURL(file);
    try {
      let img;
      try { img = await loadImage(url); } catch {
        throw new Error(`${file.name} can't be opened in this browser. Try Safari, or save it as a JPEG first.`);
      }
      const w = img.naturalWidth, h = img.naturalHeight;
      let data, type;
      if (opts.keep && file.type === 'image/jpeg') {
        data = await file.arrayBuffer();
        type = 'image/jpeg';
      } else if (file.type === 'image/png' && file.size < 1.5e6 && Math.max(w, h) <= 2600) {
        data = await file.arrayBuffer();
        type = 'image/png';
      } else {
        data = await canvasToBuf(drawScaled(img, 2200), 'image/jpeg', 0.85);
        type = 'image/jpeg';
      }
      const thumb = await canvasToBuf(drawScaled(img, 320), 'image/jpeg', 0.72);
      return { data, type, thumb, w, h };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const isPdfFile = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  const isImageFile = (file) => (file.type || '').startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|gif|tiff?)$/i.test(file.name || '');

  async function processIncoming(file, opts = {}) {
    const isPdf = isPdfFile(file);
    if (isPdf) {
      const data = await file.arrayBuffer();
      let pages = null;
      try {
        await loadScript(PDFLIB_SRC);
        const d = await PDFLib.PDFDocument.load(data, { ignoreEncryption: true });
        pages = d.getPageCount();
      } catch (err) {
        if (/Couldn't load/.test(err.message)) throw err;
        throw new Error(`${file.name} couldn't be read as a PDF.`);
      }
      return { id: uid(), name: file.name, type: 'application/pdf', data, pages, thumb: null, isNew: true };
    }
    if (isImageFile(file)) {
      const r = await processImage(file, opts);
      return { id: uid(), name: file.name || 'Photo', type: r.type, data: r.data, thumb: r.thumb, w: r.w, h: r.h, isNew: true };
    }
    throw new Error(`${file.name} isn't a photo or a PDF.`);
  }

  const fileRecord = (i) => ({
    id: i.id, name: i.name, type: i.type, data: i.data, pages: i.pages ?? null,
    w: i.w ?? null, h: i.h ?? null, createdAt: i.createdAt || Date.now(),
  });

  async function saveNewFiles(items) {
    const fresh = items.filter((i) => i.isNew);
    await DB.putMany('files', fresh.map(fileRecord));
    await DB.putMany('thumbs', fresh.filter((i) => i.thumb).map((i) => ({ id: i.id, data: i.thumb })));
    fresh.forEach((i) => { i.isNew = false; });
  }

  async function loadItems(ids) {
    const out = [];
    for (const id of ids || []) {
      const f = await DB.get('files', id);
      if (!f) { out.push({ id, missing: true, name: 'Missing file', type: '' }); continue; }
      const t = await DB.get('thumbs', id);
      out.push({ ...f, thumb: t ? t.data : null, isNew: false });
    }
    return out;
  }

  /* =========================================================
     Sheets (dialogs)
     ========================================================= */

  const sheet = $('#sheet');
  let sheetCleanup = [];
  let sheetBeforeClose = null;

  // iOS doesn't resize the page when the keyboard opens; it only shrinks the "visual viewport".
  // Keep the sheet sized and positioned to that visible area so fields never sit under the keyboard.
  const vv = window.visualViewport;
  function syncViewport() {
    if (!vv) return;
    const root = document.documentElement.style;
    root.setProperty('--vv-height', `${Math.round(vv.height)}px`);
    root.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
    sheet.classList.toggle('keyboard', window.innerHeight - vv.height > 120);
  }
  if (vv) {
    vv.addEventListener('resize', syncViewport);
    vv.addEventListener('scroll', syncViewport);
  }

  function keepFieldVisible(el) {
    const body = el.closest('.sheet-body');
    if (!body) return;
    const r = el.getBoundingClientRect(), b = body.getBoundingClientRect();
    if (r.top < b.top + 12 || r.bottom > b.bottom - 12) {
      body.scrollTop += r.top - b.top - Math.min(96, b.height / 4);
    }
  }
  sheet.addEventListener('focusin', (e) => {
    if (!e.target.matches('input, textarea, select')) return;
    // run after the keyboard has finished opening
    setTimeout(() => { syncViewport(); keepFieldVisible(e.target); }, 350);
  });

  function openSheet(html) {
    runSheetCleanup();
    sheetBeforeClose = null;
    sheet.innerHTML = html;
    syncViewport();
    document.documentElement.classList.add('sheet-open');
    if (!sheet.open) sheet.showModal();
    sheet.scrollTop = 0;
    return sheet;
  }
  function runSheetCleanup() {
    sheetCleanup.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    sheetCleanup = [];
  }
  function closeSheet(force = false) {
    if (!force && sheetBeforeClose && !sheetBeforeClose()) return;
    sheetBeforeClose = null;
    if (sheet.open) sheet.close();
  }
  sheet.addEventListener('close', () => {
    runSheetCleanup();
    sheet.innerHTML = '';
    document.documentElement.classList.remove('sheet-open');
  });
  sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) closeSheet();
    if (e.target.closest('[data-close]')) closeSheet();
  });

  const sheetHead = (title, left = '<button type="button" class="text-btn" data-close>Close</button>', right = '<span></span>') =>
    `<div class="sheet-head">${left}<h2>${esc(title)}</h2>${right}</div>`;

  const viewer = $('#viewer');
  const isAndroid = () => /Android/i.test(navigator.userAgent);
  let viewerFile = null;
  function showImage(buf, type, name = 'Receipt') {
    const url = bufToBlobUrl(buf, type);
    const ext = type === 'image/png' ? 'png' : 'jpg';
    viewerFile = new File([buf], `${String(name).replace(/\.[^.]+$/, '') || 'Receipt'}.${ext}`, { type });
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [viewerFile] }));
    const label = isAndroid() ? 'Save image' : isTouch() && canShare ? 'Save to Photos' : 'Download';
    viewer.innerHTML = `<img src="${url}" alt="Receipt">
      <div class="viewer-bar">
        <button type="button" data-save>${label}</button>
        <button type="button">Done</button>
      </div>`;
    viewer.showModal();
    viewer.addEventListener('close', () => { URL.revokeObjectURL(url); viewerFile = null; }, { once: true });
  }
  viewer.addEventListener('click', (e) => {
    if (e.target.closest('[data-save]')) {
      if (!viewerFile) return;
      if (!isAndroid() && isTouch() && navigator.canShare && navigator.canShare({ files: [viewerFile] })) {
        navigator.share({ files: [viewerFile] }).catch(() => { /* cancelled */ });
      } else {
        downloadBlob(viewerFile, viewerFile.name);
        if (isAndroid()) toast('Saved to your Downloads folder');
      }
      return;
    }
    viewer.close();
  });

  /* =========================================================
     Routing & rendering
     ========================================================= */

  const app = $('#app');
  let renderUrls = [];
  let updateWorker = null;

  function clearRenderUrls() {
    renderUrls.forEach((u) => URL.revokeObjectURL(u));
    renderUrls = [];
  }

  async function render() {
    const m = location.hash.match(/^#\/trip\/([\w-]+)/);
    try {
      if (m) await renderTrip(m[1]);
      else await renderHome();
    } catch (err) {
      console.error(err);
      app.innerHTML = `<main class="wrap"><div class="empty"><h2>Something went wrong</h2><p>${esc(err.message)}</p></div></main>`;
    }
  }

  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    if (!currentTripId() && !sheet.open) render();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    toast('Installed. Open it from your home screen from now on.', 4000);
    if (!currentTripId() && !sheet.open) render();
  });

  const updateBanner = () => {
    if (updateWorker) {
      return '<div class="update-banner"><span>A new version of the app is ready.</span><button class="small-btn" data-act="apply-update">Update</button></div>';
    }
    if (installPrompt && !currentTripId()) {
      return '<div class="update-banner"><span>Install this app so it opens from your home screen and works offline.</span><button class="small-btn" data-act="install">Install</button></div>';
    }
    return '';
  };

  async function renderHome() {
    const [trips, entries] = await Promise.all([liveTrips(), DB.all('entries')]);
    const byTrip = new Map();
    entries.filter((e) => !e.deleted).forEach((e) => {
      if (!byTrip.has(e.tripId)) byTrip.set(e.tripId, []);
      byTrip.get(e.tripId).push(e);
    });
    trips.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '') || (b.createdAt || 0) - (a.createdAt || 0));
    clearRenderUrls();
    document.title = 'Trip Receipts';

    const card = (t) => {
      const es = byTrip.get(t.id) || [];
      const total = es.reduce((s, e) => s + (usdOf(e) || 0), 0);
      const when = fmtRange(t.startDate, t.endDate);
      return `<li><a class="trip-card" href="#/trip/${t.id}">
        <div><h2>${esc(t.name)}</h2>
          ${when ? `<p>${esc(when)}</p>` : ''}
          ${t.location ? `<p>${esc(t.location)}</p>` : ''}</div>
        <div class="amt"><span class="main">${fmtMoney(total)}</span>
          <span class="sub">${es.length} ${es.length === 1 ? 'receipt' : 'receipts'}</span></div>
      </a></li>`;
    };

    app.innerHTML = `
      <main class="wrap">
        ${updateBanner()}
        <header class="top">
          <h1 class="app-title">Trip receipts</h1>
          <button class="icon-btn" data-act="settings" aria-label="Settings">${ICON.gear}</button>
        </header>
        ${trips.length
          ? `<ul class="trip-list">${trips.map(card).join('')}</ul>`
          : `<section class="empty"><h2>No trips yet</h2>
              <p>Create a trip for each conference, then add receipts as you go. Everything is saved on this device.</p></section>
             <p class="section-note">Moving a trip from another device? Use “Merge a backup” and pick the backup file.</p>`}
      </main>
      <div class="bar"><div class="bar-inner">
        <button class="btn btn-primary grow" data-act="new-trip">${ICON.plus}New trip</button>
        <button class="btn btn-secondary" data-act="import">Merge a backup</button>
      </div></div>`;
  }

  async function renderTrip(id) {
    const trip = await DB.get('trips', id);
    if (!trip || trip.deleted) { location.hash = '#/'; return; }
    const entries = sortEntries(await tripEntries(id));
    const thumbs = await Promise.all(entries.map((e) => (e.receipts && e.receipts[0] ? DB.get('thumbs', e.receipts[0]) : null)));
    clearRenderUrls();
    document.title = `${trip.name} — Trip Receipts`;

    const total = entries.reduce((s, e) => s + (usdOf(e) || 0), 0);
    const unconverted = entries.filter((e) => e.amount != null && usdOf(e) == null).length;

    const groups = [];
    entries.forEach((e, i) => {
      const last = groups[groups.length - 1];
      if (last && last.date === e.date) last.items.push([e, i]);
      else groups.push({ date: e.date, items: [[e, i]] });
    });

    const row = (e, i) => {
      const hasReceipt = (e.receipts || []).length > 0;
      let thumbHtml;
      if (thumbs[i]) {
        const url = bufToBlobUrl(thumbs[i].data, 'image/jpeg');
        renderUrls.push(url);
        thumbHtml = `<img class="thumb" src="${url}" alt="">`;
      } else if (hasReceipt) {
        thumbHtml = '<span class="thumb">PDF</span>';
      } else {
        thumbHtml = `<span class="thumb missing" title="No receipt">${ICON.receipt}</span>`;
      }
      const usd = usdOf(e);
      const flags = [];
      if (!hasReceipt) flags.push('No receipt');
      if (e.amount == null) flags.push('No amount');
      else if (usd == null) flags.push('Needs rate');
      let sub = esc(e.category);
      if (e.category === 'Hotel' && isISO(e.checkIn) && isISO(e.checkOut)) {
        const n = nightsBetween(e.checkIn, e.checkOut);
        sub += `, ${n} ${n === 1 ? 'night' : 'nights'}`;
      }
      return `<li><button class="entry" data-act="edit-entry" data-id="${e.id}">
        ${thumbHtml}
        <span class="entry-main">
          <span class="entry-title">${esc(e.vendor || e.category)}</span>
          <span class="entry-meta"><i class="dot ${catClass(e.category)}"></i>${sub}
            ${flags.map((f) => `<span class="flag">${f}</span>`).join('')}</span>
        </span>
        <span class="amt">
          <span class="main">${usd != null ? fmtMoney(usd) : '—'}</span>
          ${isForeign(e) && e.amount != null ? `<span class="sub">${fmtMoney(e.amount, e.currency)}</span>` : ''}
        </span>
      </button></li>`;
    };

    const dayTotal = (items) => (items.some(([e]) => usdOf(e) != null)
      ? fmtMoney(items.reduce((s, [e]) => s + (usdOf(e) || 0), 0)) : '—');
    const when = fmtRange(trip.startDate, trip.endDate);
    const linkText = trip.url ? trip.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : '';

    app.innerHTML = `
      <main class="wrap">
        ${updateBanner()}
        <header class="top">
          <a class="back" href="#/">${ICON.back}Trips</a>
          <button class="icon-btn" data-act="trip-menu" aria-label="Trip options">${ICON.more}</button>
        </header>
        <section class="ticket">
          <div class="ticket-top">
            <h1 class="trip-name">${esc(trip.name)}</h1>
            ${when ? `<p class="trip-when">${esc(when)}</p>` : ''}
            ${trip.location ? `<p class="trip-where">${esc(trip.location)}</p>` : ''}
            ${speedtypeLine(trip.speedtypes) ? `<p class="trip-where">${esc(speedtypeLine(trip.speedtypes))}</p>` : ''}
            ${trip.url
              ? `<a class="trip-link" href="${esc(trip.url)}" target="_blank" rel="noopener">${esc(linkText)}</a>`
              : '<button class="text-btn trip-link-missing" data-act="edit-trip">Add the conference link</button>'}
          </div>
          <div class="perf" aria-hidden="true"></div>
          <div class="ticket-bottom">
            <div>
              <div class="total">${fmtMoney(total)}</div>
              <div class="total-label">Total in USD${unconverted ? `, ${unconverted} not converted yet` : ''}</div>
            </div>
            <div class="count">${entries.length} ${entries.length === 1 ? 'receipt' : 'receipts'}</div>
          </div>
        </section>
        ${groups.length
          ? groups.map((g) => `<section class="day">
              <h2 class="day-head"><span>${esc(fmtDay(g.date))}</span><span>${dayTotal(g.items)}</span></h2>
              <ul class="entries">${g.items.map(([e, i]) => row(e, i)).join('')}</ul>
            </section>`).join('')
          : `<p class="section-note">No receipts yet. Tap “Add receipt” to photograph one or attach a PDF invoice.</p>`}
      </main>
      <div class="bar"><div class="bar-inner">
        <button class="btn btn-primary grow" data-act="new-entry">${ICON.plus}Add receipt</button>
        <button class="btn btn-secondary" data-act="export" ${entries.length ? '' : 'disabled'}>Export</button>
      </div></div>`;
  }

  async function refreshRatesFor(tripId) {
    const n = await fillMissingRates(tripId);
    if (n && location.hash === `#/trip/${tripId}` && !sheet.open) render();
  }

  /* =========================================================
     Trip editor
     ========================================================= */

  async function openTripEditor(tripId) {
    const t = tripId ? await DB.get('trips', tripId) : null;
    openSheet(`<form class="sheet-form" novalidate>
      ${sheetHead(t ? 'Edit trip' : 'New trip',
        '<button type="button" class="text-btn" data-close>Cancel</button>',
        '<button type="submit" class="text-btn strong">Save</button>')}
      <div class="sheet-body">
        <label class="field"><span>Conference or trip name</span>
          <input name="name" required autocomplete="off" ${t || isTouch() ? '' : 'autofocus'} placeholder="e.g. ASCB Annual Meeting 2026" value="${esc(t?.name)}"></label>
        <label class="field"><span>Conference website</span>
          <input name="url" type="url" inputmode="url" autocapitalize="off" autocomplete="off" placeholder="https://" value="${esc(t?.url)}"></label>
        <label class="field"><span>Speedtype(s)</span>
          ${SPEEDTYPE_INPUT((t?.speedtypes || []).join(', '))}</label>
        <p class="hint">10-digit numbers for the grants to charge. Separate more than one with commas. If you don't have them yet, you'll be asked again when you export.</p>
        <div class="row">
          <label class="field"><span>First day</span><input name="startDate" type="date" value="${esc(t?.startDate)}"></label>
          <label class="field"><span>Last day</span><input name="endDate" type="date" value="${esc(t?.endDate)}"></label>
        </div>
        <label class="field"><span>City</span>
          <input name="location" autocomplete="off" placeholder="e.g. Lisbon, Portugal" value="${esc(t?.location)}"></label>
        <label class="field"><span>Usual currency on this trip</span>
          <input name="currency" list="currency-list" maxlength="3" autocapitalize="characters" autocomplete="off" placeholder="USD" value="${esc(t?.localCurrency || '')}"></label>
        <p class="hint">New receipts start in this currency. You can change it on any receipt.</p>
        <datalist id="currency-list">${CURRENCIES.map((c) => `<option value="${c}">`).join('')}</datalist>
      </div>
    </form>`);
    const form = $('form', sheet);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const name = form.name.value.trim();
      if (!name) { toast('Add a name for the trip.'); form.name.focus(); return; }
      let url = form.url.value.trim();
      if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
      const sp = parseSpeedtypes(form.speedtypes.value);
      if (sp.bad.length) { toast(speedtypeError(sp.bad), 5000); form.speedtypes.focus(); return; }
      const cur = form.currency.value.trim().toUpperCase();
      if (cur && !/^[A-Z]{3}$/.test(cur)) { toast('Use a 3-letter currency code, like EUR.'); return; }
      const startDate = form.startDate.value || '';
      let endDate = form.endDate.value || '';
      if (startDate && endDate && endDate < startDate) { toast('The last day is before the first day.'); return; }
      const trip = {
        extras: [], removedFiles: [], createdAt: Date.now(), ...(t || {}),
        id: t?.id || uid(), name, url, startDate, endDate,
        location: form.location.value.trim(), localCurrency: cur, speedtypes: sp.list,
        updatedAt: Date.now(), deleted: false,
      };
      await DB.put('trips', trip);
      askPersist();
      closeSheet(true);
      if (!t) location.hash = `#/trip/${trip.id}`;
      else render();
      toast(t ? 'Trip saved' : 'Trip created');
    });
  }

  /* =========================================================
     Receipt (entry) editor
     ========================================================= */

  async function openEntryEditor(tripId, entryId) {
    const trip = await DB.get('trips', tripId);
    const existing = entryId ? await DB.get('entries', entryId) : null;
    const st = {
      dirty: false,
      receipts: await loadItems(existing?.receipts),
      statements: await loadItems(existing?.statements),
      rate: existing?.rate ?? null,
      rateDate: existing?.rateDate || null,
      rateSource: existing?.rateSource || null,
      lookupSeq: 0,
    };
    const settings = await getSettings();
    const canScan = !!window.ReceiptScanner;
    const defaultCur = existing?.currency || trip.localCurrency || trip.lastCurrency || 'USD';
    const category = existing?.category || 'Food';
    const isHotel = category === 'Hotel';
    const defaultDate = existing?.date || todayISO();
    const tileUrls = [];

    openSheet(`<form class="sheet-form" novalidate>
      ${sheetHead(existing ? 'Edit receipt' : 'New receipt',
        '<button type="button" class="text-btn" data-close>Cancel</button>',
        '<button type="submit" class="text-btn strong">Save</button>')}
      <div class="sheet-body">
        <div class="field">
          <span class="label">Receipt or invoice</span>
          <div class="files" data-files="receipts"></div>
          <button type="button" class="btn btn-secondary btn-block" data-pick="receipts">${ICON.plus}Add photo or PDF</button>
          <input type="file" class="sr-only" accept="image/*,application/pdf,.pdf" multiple data-input="receipts" tabindex="-1">
        </div>

        <fieldset class="field"><legend>Category</legend>
          <div class="chips">${CATEGORIES.map((c) => `<label class="chip"><input type="radio" name="category" value="${c}" ${c === category ? 'checked' : ''}>
            <span><i class="dot ${catClass(c)}"></i>${c}</span></label>`).join('')}</div>
        </fieldset>

        <label class="field" data-when="single" ${isHotel ? 'hidden' : ''}><span>Date of purchase</span>
          <input type="date" name="date" value="${esc(isHotel ? '' : defaultDate)}"></label>
        <div data-when="hotel" ${isHotel ? '' : 'hidden'}>
          <div class="row">
            <label class="field"><span>Check-in</span><input type="date" name="checkIn" value="${esc(existing?.checkIn || '')}"></label>
            <label class="field"><span>Check-out</span><input type="date" name="checkOut" value="${esc(existing?.checkOut || (isHotel ? defaultDate : ''))}"></label>
          </div>
          <p class="hint" data-stay style="margin-top:8px">Hotel stays are listed on the check-out date.</p>
        </div>

        <label class="field"><span>Vendor and location</span>
          <input name="vendor" autocomplete="off" placeholder="e.g. Café Kitsuné, Paris" value="${esc(existing?.vendor || '')}"></label>

        <div class="row">
          <label class="field"><span>Amount</span>
            <input name="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${existing?.amount != null ? esc(amountInput(existing.amount, existing.currency)) : ''}"></label>
          <label class="field cur"><span>Currency</span>
            <input name="currency" list="currency-list" maxlength="3" autocapitalize="characters" autocomplete="off" value="${esc(defaultCur)}"></label>
        </div>
        <datalist id="currency-list">${CURRENCIES.map((c) => `<option value="${c}">`).join('')}</datalist>

        <section class="fx" data-when="foreign" hidden>
          <div class="fx-line"><p class="fx-text" data-fx-text></p>
            <button type="button" class="small-btn" data-lookup>Look up rate</button></div>
          <label class="field"><span data-rate-label>Exchange rate (USD per 1 unit)</span>
            <input name="rate" inputmode="decimal" autocomplete="off" value="${st.rate != null && existing?.currency !== 'USD' ? esc(st.rate) : ''}"></label>
          <label class="field"><span>USD charged on your card (optional)</span>
            <input name="usd" inputmode="decimal" autocomplete="off" placeholder="From your card statement" value="${existing?.usd != null ? esc(existing.usd.toFixed(2)) : ''}"></label>
          <p class="hint">If you enter the charged amount, the spreadsheet uses it instead of the exchange rate.</p>
        </section>

        <div class="field">
          <span class="label">Card statement screenshot (optional)</span>
          <div class="files" data-files="statements"></div>
          <button type="button" class="btn btn-secondary btn-block" data-pick="statements">${ICON.plus}Add screenshot</button>
          <input type="file" class="sr-only" accept="image/*,application/pdf,.pdf" multiple data-input="statements" tabindex="-1">
          <p class="hint" style="margin-top:8px">Goes in the PDF right after this receipt. Useful for foreign charges or a lost receipt.</p>
        </div>

        <label class="field"><span>Notes (optional)</span>
          <textarea name="notes" rows="2" placeholder="e.g. Dinner with two other attendees">${esc(existing?.notes || '')}</textarea></label>

        ${existing ? '<button type="button" class="btn btn-danger btn-block" data-delete>Delete receipt</button>' : ''}
      </div>
    </form>`);

    const form = $('form', sheet);
    sheetCleanup.push(() => tileUrls.forEach((u) => URL.revokeObjectURL(u)));
    sheetBeforeClose = () => !st.dirty || confirm('Discard your changes to this receipt?');

    const val = (n) => form.elements[n].value;
    const getCategory = () => (form.querySelector('input[name="category"]:checked') || {}).value || 'Other';
    const getCurrency = () => (val('currency') || 'USD').trim().toUpperCase();
    const getDate = () => (getCategory() === 'Hotel' ? (val('checkOut') || val('checkIn')) : val('date'));

    function renderTiles(role) {
      const box = $(`[data-files="${role}"]`, sheet);
      box.innerHTML = st[role].map((item) => {
        if (item.busy) return '<div class="file busy">Adding…</div>';
        let inner;
        if (item.thumb) {
          const u = bufToBlobUrl(item.thumb, 'image/jpeg');
          tileUrls.push(u);
          inner = `<button type="button" class="file-open" data-view="${role}:${item.id}" aria-label="View ${esc(item.name)}"><img src="${u}" alt=""></button>`;
        } else if (item.missing) {
          inner = '<div class="file-pdf"><strong>Missing</strong><span>Merge the backup that has it</span></div>';
        } else {
          inner = `<div class="file-pdf"><strong>PDF</strong><span>${item.pages ? `${item.pages} ${item.pages === 1 ? 'page' : 'pages'}` : ''}</span></div>`;
        }
        const adjust = canScan && item.thumb && item.data && item.type !== 'application/pdf'
          ? `<button type="button" class="file-adjust" data-adjust="${role}:${item.id}">Adjust</button>` : '';
        return `<div class="file">${inner}${adjust}<button type="button" class="file-remove" data-remove="${role}:${item.id}" aria-label="Remove ${esc(item.name)}">${ICON.x}</button></div>`;
      }).join('');
    }

    function updateWhen() {
      const hotel = getCategory() === 'Hotel';
      $('[data-when="single"]', sheet).hidden = hotel;
      $('[data-when="hotel"]', sheet).hidden = !hotel;
      if (hotel && !val('checkOut') && val('date')) form.elements.checkOut.value = val('date');
      if (!hotel && !val('date')) form.elements.date.value = val('checkOut') || val('checkIn') || '';
      const ci = val('checkIn'), co = val('checkOut');
      const stay = $('[data-stay]', sheet);
      if (isISO(ci) && isISO(co) && co >= ci) {
        const n = nightsBetween(ci, co);
        stay.textContent = `${n} ${n === 1 ? 'night' : 'nights'}. Listed on the check-out date, ${fmtDate(co)}.`;
      } else {
        stay.textContent = 'Hotel stays are listed on the check-out date.';
      }
    }

    function updateFx() {
      const cur = getCurrency();
      const foreign = /^[A-Z]{3}$/.test(cur) && cur !== 'USD';
      $('[data-when="foreign"]', sheet).hidden = !foreign;
      if (!foreign) return;
      $('[data-rate-label]', sheet).textContent = `Exchange rate (USD per 1 ${cur})`;
      const amount = parseAmount(val('amount'));
      const rate = parseAmount(val('rate'));
      const usd = parseAmount(val('usd'));
      const text = $('[data-fx-text]', sheet);
      if (usd != null) {
        text.innerHTML = `Using the card statement amount: <strong>${esc(fmtMoney(usd))}</strong>.`;
      } else if (rate) {
        const src = st.rateSource === 'Manual' || !st.rateSource
          ? 'the rate you entered'
          : `the ${st.rateSource} for ${fmtDate(st.rateDate)}`;
        text.innerHTML = amount != null
          ? `≈ <strong>${esc(fmtMoney(round2(amount * rate)))}</strong> using ${esc(src)}.`
          : `Using ${esc(src)}.`;
      } else {
        text.textContent = navigator.onLine
          ? 'No exchange rate yet.'
          : "You're offline. The rate is looked up automatically once you're back online.";
      }
    }

    async function lookupRate(silent) {
      const cur = getCurrency(), date = getDate();
      if (!/^[A-Z]{3}$/.test(cur) || cur === 'USD') return;
      if (!isISO(date)) { if (!silent) toast('Add the date first.'); return; }
      const seq = ++st.lookupSeq;
      const text = $('[data-fx-text]', sheet);
      if (!silent) text.textContent = 'Looking up the rate…';
      try {
        const r = await fetchRate(cur, date);
        if (seq !== st.lookupSeq || !sheet.open) return;
        form.elements.rate.value = String(r.rate);
        Object.assign(st, { rateSource: r.source, rateDate: r.date });
      } catch (err) {
        if (seq !== st.lookupSeq || !sheet.open) return;
        if (!silent) toast(navigator.onLine ? `${err.message} Enter the rate or the USD amount instead.` : "You're offline. Try again later.", 4200);
      }
      updateFx();
    }

    // When the date or currency changes, a looked-up rate no longer applies
    function onRateInputsChanged() {
      if (st.rateSource && st.rateSource !== 'Manual') {
        form.elements.rate.value = '';
        st.rateSource = null; st.rateDate = null;
      }
      updateFx();
      if (navigator.onLine && !parseAmount(val('usd'))) lookupRate(true);
    }

    async function addFiles(role, files) {
      for (const file of files) {
        const placeholder = { id: uid(), busy: true };
        st[role].push(placeholder);
        renderTiles(role);
        try {
          let src = file, keep = false;
          if (canScan && role === 'receipts' && settings.autoScan && isImageFile(file) && !isPdfFile(file)) {
            const r = await ReceiptScanner.open(file, { name: file.name });
            if (!r) { // cancelled: don't add this photo
              st[role].splice(st[role].indexOf(placeholder), 1);
              renderTiles(role);
              continue;
            }
            if (r.blob) { src = r.blob; keep = true; }
          }
          const item = await processIncoming(src, { keep });
          st[role].splice(st[role].indexOf(placeholder), 1, item);
          st.dirty = true;
        } catch (err) {
          st[role].splice(st[role].indexOf(placeholder), 1);
          toast(err.message, 4500);
        }
        renderTiles(role);
      }
    }

    renderTiles('receipts');
    renderTiles('statements');
    updateWhen();
    updateFx();
    if (needsRate({ currency: getCurrency(), amount: 1, usd: parseAmount(val('usd')), rate: parseAmount(val('rate')) }) && navigator.onLine) {
      lookupRate(true);
    }

    form.addEventListener('input', (e) => {
      st.dirty = true;
      const n = e.target.name;
      if (n === 'rate') { st.rateSource = 'Manual'; st.rateDate = getDate(); }
      if (n === 'category') { updateWhen(); onRateInputsChanged(); return; }
      if (n === 'checkIn' || n === 'checkOut') updateWhen();
      if (n === 'amount' || n === 'rate' || n === 'usd') updateFx();
    });
    form.addEventListener('change', (e) => {
      const n = e.target.name;
      if (n === 'date' || n === 'checkOut' || (n === 'checkIn' && !val('checkOut')) || n === 'currency') onRateInputsChanged();
      if (n === 'currency') e.target.value = getCurrency();
    });

    form.addEventListener('click', async (e) => {
      const pick = e.target.closest('[data-pick]');
      if (pick) { $(`[data-input="${pick.dataset.pick}"]`, sheet).click(); return; }
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        const [role, id] = rm.dataset.remove.split(':');
        st[role] = st[role].filter((i) => i.id !== id);
        st.dirty = true;
        renderTiles(role);
        return;
      }
      const adj = e.target.closest('[data-adjust]');
      if (adj) {
        const [role, id] = adj.dataset.adjust.split(':');
        const idx = st[role].findIndex((i) => i.id === id);
        const item = st[role][idx];
        if (!item || !item.data) return;
        try {
          const r = await ReceiptScanner.open(new Blob([item.data], { type: item.type }), { name: item.name, allowOriginal: false });
          if (!r || !r.blob) return;
          const fresh = await processIncoming(r.blob, { keep: true });
          const at = st[role].findIndex((i) => i.id === id);
          if (at >= 0) st[role].splice(at, 1, fresh);
          st.dirty = true;
          renderTiles(role);
        } catch (err) {
          toast(err.message, 4500);
        }
        return;
      }
      const view = e.target.closest('[data-view]');
      if (view) {
        const [role, id] = view.dataset.view.split(':');
        const item = st[role].find((i) => i.id === id);
        if (item && item.data) showImage(item.data, item.type, item.name);
        return;
      }
      if (e.target.closest('[data-lookup]')) { lookupRate(false); return; }
      if (e.target.closest('[data-delete]')) {
        if (!confirm('Delete this receipt? This can’t be undone.')) return;
        await DB.put('entries', {
          ...existing, receipts: [], statements: [], deleted: true, updatedAt: Date.now(),
        });
        await collectGarbage();
        closeSheet(true);
        render();
        toast('Receipt deleted');
      }
    });

    $$('[data-input]', sheet).forEach((inp) => inp.addEventListener('change', () => {
      const files = [...inp.files];
      inp.value = '';
      if (files.length) addFiles(inp.dataset.input, files);
    }));

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (st.receipts.concat(st.statements).some((i) => i.busy)) { toast('Wait for the files to finish adding.'); return; }
      const cat = getCategory();
      let date = '', checkIn = null, checkOut = null;
      if (cat === 'Hotel') {
        checkIn = val('checkIn') || null;
        checkOut = val('checkOut') || null;
        if (!checkOut) { toast('Add the check-out date.'); return; }
        if (checkIn && checkOut < checkIn) { toast('Check-out is before check-in.'); return; }
        date = checkOut;
      } else {
        date = val('date');
      }
      if (!isISO(date)) { toast('Add the date of purchase.'); return; }
      const amountRaw = val('amount').trim();
      const amount = parseAmount(amountRaw);
      if (amountRaw && amount == null) { toast("The amount isn't a number."); return; }
      const currency = getCurrency();
      if (!/^[A-Z]{3}$/.test(currency)) { toast('Use a 3-letter currency code, like EUR.'); return; }

      let rate = null, rateDate = null, rateSource = null, usd = null;
      if (currency === 'USD') {
        rate = 1;
      } else {
        rate = parseAmount(val('rate'));
        usd = parseAmount(val('usd'));
        if (rate) { rateSource = st.rateSource || 'Manual'; rateDate = st.rateDate || date; } else rate = null;
        if (rate == null && usd == null && navigator.onLine) {
          try { const r = await fetchRate(currency, date); rate = r.rate; rateDate = r.date; rateSource = r.source; } catch { /* filled in later */ }
        }
      }

      const saveBtn = $('button[type="submit"]', sheet);
      saveBtn.disabled = true;
      try {
        await saveNewFiles([...st.receipts, ...st.statements]);
        const entry = {
          createdAt: Date.now(), ...(existing || {}),
          id: existing?.id || uid(), tripId, category: cat, date, checkIn, checkOut,
          vendor: val('vendor').trim(), notes: val('notes').trim(),
          amount, currency, rate, rateDate, rateSource, usd,
          receipts: st.receipts.map((i) => i.id),
          statements: st.statements.map((i) => i.id),
          updatedAt: Date.now(), deleted: false,
        };
        await DB.put('entries', entry);
        if (trip.lastCurrency !== currency) await DB.put('trips', { ...trip, lastCurrency: currency });
        await collectGarbage();
        askPersist();
        st.dirty = false;
        closeSheet(true);
        await render();
        toast(existing ? 'Receipt saved' : 'Receipt added');
      } catch (err) {
        console.error(err);
        saveBtn.disabled = false;
        toast(/quota|space/i.test(String(err && (err.name + err.message))) ? 'The device is out of storage space.' : `Couldn't save: ${err.message}`, 5000);
      }
    });
  }

  /* =========================================================
     Extra pages (appended to the end of the PDF)
     ========================================================= */

  async function openExtras(tripId) {
    const draw = async () => {
      const trip = await DB.get('trips', tripId);
      const items = await loadItems(trip.extras);
      const urls = [];
      const tiles = items.map((it) => {
        let inner;
        if (it.thumb) {
          const u = bufToBlobUrl(it.thumb, 'image/jpeg');
          urls.push(u);
          inner = `<button type="button" class="file-open" data-view="${it.id}" aria-label="View ${esc(it.name)}"><img src="${u}" alt=""></button>`;
        } else if (it.missing) {
          inner = '<div class="file-pdf"><strong>Missing</strong></div>';
        } else {
          inner = `<div class="file-pdf"><strong>PDF</strong><span>${it.pages ? `${it.pages} ${it.pages === 1 ? 'page' : 'pages'}` : ''}</span></div>`;
        }
        return `<div class="file">${inner}<button type="button" class="file-remove" data-remove="${it.id}" aria-label="Remove ${esc(it.name)}">${ICON.x}</button></div>`;
      }).join('');
      openSheet(`${sheetHead('Extra pages')}
        <div class="sheet-body">
          <p class="sheet-lede">These go at the end of the PDF, after all receipts. Use them for a card statement that covers several charges, a registration confirmation, or a travel approval.</p>
          <div class="files">${tiles}</div>
          <button type="button" class="btn btn-secondary btn-block" data-pick>${ICON.plus}Add photo or PDF</button>
          <input type="file" class="sr-only" accept="image/*,application/pdf,.pdf" multiple data-input tabindex="-1">
        </div>`);
      sheetCleanup.push(() => urls.forEach((u) => URL.revokeObjectURL(u)));
      $('[data-pick]', sheet).addEventListener('click', () => $('[data-input]', sheet).click());
      $('[data-input]', sheet).addEventListener('change', async (ev) => {
        const files = [...ev.target.files];
        ev.target.value = '';
        const btn = $('[data-pick]', sheet);
        btn.disabled = true;
        btn.textContent = 'Adding…';
        for (const f of files) {
          try {
            const item = await processIncoming(f);
            await saveNewFiles([item]);
            const t = await DB.get('trips', tripId);
            await DB.put('trips', { ...t, extras: [...(t.extras || []), item.id], updatedAt: Date.now() });
          } catch (err) { toast(err.message, 4500); }
        }
        askPersist();
        draw();
      });
      $$('[data-remove]', sheet).forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Remove this page?')) return;
        const t = await DB.get('trips', tripId);
        const id = b.dataset.remove;
        await DB.put('trips', {
          ...t, extras: (t.extras || []).filter((x) => x !== id),
          removedFiles: uniq([...(t.removedFiles || []), id]), updatedAt: Date.now(),
        });
        await collectGarbage();
        draw();
      }));
      $$('[data-view]', sheet).forEach((b) => b.addEventListener('click', () => {
        const it = items.find((i) => i.id === b.dataset.view);
        if (it && it.data) showImage(it.data, it.type, it.name);
      }));
    };
    await draw();
  }

  /* =========================================================
     Export: PDF + spreadsheet
     ========================================================= */

  async function buildPdf(trip, entries, extrasItems, settings) {
    await loadScript(PDFLIB_SRC);
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const doc = await PDFDocument.create();
    doc.setTitle(`${trip.name} receipts`);
    doc.setCreator('Trip Receipts');
    doc.setProducer('Trip Receipts');
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const M = 36, CAP = settings.labelPages ? 30 : 0;
    const labelColor = rgb(0.28, 0.33, 0.36);
    const problems = [];
    const pageRanges = new Map();

    const clean = (s, f) => [...String(s || '').normalize('NFC').replace(/[   ]/g, ' ')]
      .map((ch) => { try { f.encodeText(ch); return ch; } catch { return '?'; } }).join('');

    function drawLabel(page, lead, rest) {
      if (!CAP) return;
      const { width, height } = page.getSize();
      const y = height - M - 11;
      const maxW = width - 2 * M;
      const leadT = clean(lead, bold);
      let restT = clean(rest, font);
      const leadW = bold.widthOfTextAtSize(leadT, 10);
      while (restT.length > 1 && leadW + 10 + font.widthOfTextAtSize(restT, 10) > maxW) restT = restT.slice(0, -2) + '…';
      page.drawText(leadT, { x: M, y, size: 10, font: bold, color: labelColor });
      if (restT) page.drawText(restT, { x: M + leadW + 10, y, size: 10, font, color: labelColor });
      page.drawLine({ start: { x: M, y: y - 8 }, end: { x: width - M, y: y - 8 }, thickness: 0.6, color: rgb(0.8, 0.83, 0.82) });
    }

    function fitInto(page, w, h) {
      const { width, height } = page.getSize();
      const boxW = width - 2 * M, boxH = height - 2 * M - CAP;
      const s = Math.min(boxW / w, boxH / h);
      const dw = w * s, dh = h * s;
      return { x: M + (boxW - dw) / 2, y: M + boxH - dh, width: dw, height: dh };
    }

    async function addItem(item, lead, rest) {
      if (item.missing || !item.data) {
        problems.push(`A file for “${lead}” is missing on this device.`);
        return 0;
      }
      if (item.type === 'application/pdf') {
        let src;
        try { src = await PDFDocument.load(item.data, { ignoreEncryption: true }); } catch {
          problems.push(`${item.name} couldn't be read.`); return 0;
        }
        let count = 0;
        const n = src.getPageCount();
        for (let i = 0; i < n; i++) {
          const srcPage = src.getPage(i);
          const rot = ((srcPage.getRotation().angle % 360) + 360) % 360;
          try {
            if (!CAP || rot) {
              // Keep the original page exactly as it is
              const [copied] = await doc.copyPages(src, [i]);
              doc.addPage(copied);
            } else {
              const [emb] = await doc.embedPdf(src, [i]);
              const landscape = emb.width > emb.height;
              const page = doc.addPage(landscape ? [792, 612] : [612, 792]);
              drawLabel(page, lead, rest + (n > 1 ? `   (page ${i + 1} of ${n})` : ''));
              page.drawPage(emb, fitInto(page, emb.width, emb.height));
            }
            count++;
          } catch {
            problems.push(`Page ${i + 1} of ${item.name} couldn't be added.`);
          }
        }
        return count;
      }
      let img;
      try {
        img = item.type === 'image/png' ? await doc.embedPng(item.data) : await doc.embedJpg(item.data);
      } catch {
        problems.push(`${item.name} couldn't be added to the PDF.`);
        return 0;
      }
      const landscape = img.width > img.height * 1.05;
      const page = doc.addPage(landscape ? [792, 612] : [612, 792]);
      drawLabel(page, lead, rest);
      page.drawImage(img, fitInto(page, img.width, img.height));
      return 1;
    }

    const total = entries.length;
    for (let k = 0; k < entries.length; k++) {
      const e = entries[k];
      const n = k + 1;
      const amountText = e.amount != null
        ? fmtMoney(e.amount, e.currency || 'USD') + (isForeign(e) && usdOf(e) != null ? ` (${fmtMoney(usdOf(e))})` : '')
        : '';
      const rest = [fmtDate(e.date), e.category, e.vendor, amountText].filter(Boolean).join('    ');
      const start = doc.getPageCount() + 1;
      for (const it of await loadItems(e.receipts)) await addItem(it, `Receipt ${n} of ${total}`, rest);
      for (const it of await loadItems(e.statements)) await addItem(it, `Receipt ${n}, card statement`, rest);
      const end = doc.getPageCount();
      pageRanges.set(e.id, end >= start ? (end === start ? String(start) : `${start}–${end}`) : '');
    }
    for (const it of extrasItems) await addItem(it, 'Additional page', it.name || '');
    if (doc.getPageCount() === 0) {
      const p = doc.addPage([612, 792]);
      p.drawText('No receipt images were attached.', { x: M, y: 792 - M - 20, size: 12, font });
    }
    const bytes = await doc.save();
    return { blob: new Blob([bytes], { type: 'application/pdf' }), pageRanges, problems };
  }

  async function buildXlsx(trip, entries, settings, pageRanges) {
    await loadScript(EXCELJS_SRC);
    const wb = new ExcelJS.Workbook();
    wb.creator = settings.traveler || 'Trip Receipts';
    wb.created = new Date();
    const ws = wb.addWorksheet('Expenses', {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
    });
    ws.columns = [
      { width: 17 }, { width: 14 }, { width: 15 }, { width: 32 }, { width: 38 }, { width: 13 },
      { width: 10 }, { width: 15 }, { width: 30 }, { width: 15 }, { width: 11 },
    ];
    const xlDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
    const LINK = { color: { argb: 'FF1155CC' }, underline: true };

    let r = 1;
    ws.getCell(r, 1).value = trip.name;
    ws.getCell(r, 1).font = { bold: true, size: 15 };
    r++;
    const info = [];
    // Always present so finance knows where to look; left blank when none were entered.
    // Stored as text so leading zeros are kept.
    info.push(['Speedtype(s):', (trip.speedtypes || []).join(', ') || null]);
    if (trip.url) info.push(['Conference link:', { text: trip.url, hyperlink: trip.url }]);
    const when = fmtRange(trip.startDate, trip.endDate);
    if (when) info.push(['Dates:', when]);
    if (trip.location) info.push(['Location:', trip.location]);
    if (settings.traveler) info.push(['Traveler:', settings.traveler]);
    info.push(['Prepared:', fmtDate(todayISO())]);
    for (const [label, value] of info) {
      ws.getCell(r, 1).value = label;
      ws.getCell(r, 1).font = { bold: true };
      ws.getCell(r, 2).value = value;
      if (value && value.hyperlink) ws.getCell(r, 2).font = LINK;
      r++;
    }
    r++;

    const headRow = r;
    const headers = ['Receipt #', 'Date', 'Category', 'Vendor / location', 'Details', 'Amount', 'Currency',
      'Exchange rate (USD per unit)', 'Rate source', 'Amount (USD)', 'PDF page(s)'];
    headers.forEach((h, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = h;
      c.font = { bold: true };
      c.alignment = { vertical: 'middle', wrapText: true, horizontal: i >= 5 && i !== 6 && i !== 8 ? 'right' : 'left' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6EEEA' } };
      c.border = { bottom: { style: 'thin', color: { argb: 'FF9AA9A3' } } };
    });
    ws.getRow(r).height = 32;
    ws.views = [{ state: 'frozen', ySplit: headRow }];
    r++;

    const first = r;
    const amber = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE7C6' } };
    let grand = 0;
    const catTotals = new Map();
    entries.forEach((e, k) => {
      const details = [];
      if (e.category === 'Hotel' && isISO(e.checkIn) && isISO(e.checkOut)) {
        const n = nightsBetween(e.checkIn, e.checkOut);
        details.push(`Stay ${fmtRange(e.checkIn, e.checkOut)} (${n} ${n === 1 ? 'night' : 'nights'})`);
      }
      if (e.notes) details.push(e.notes);
      const usd = usdOf(e);
      if (usd != null) { grand += usd; catTotals.set(e.category, (catTotals.get(e.category) || 0) + usd); }

      const cells = ws.getRow(r);
      cells.getCell(1).value = k + 1;
      cells.getCell(1).alignment = { horizontal: 'left' };
      cells.getCell(2).value = xlDate(e.date);
      cells.getCell(2).numFmt = 'mmm d, yyyy';
      cells.getCell(2).alignment = { horizontal: 'left' };
      cells.getCell(3).value = e.category;
      cells.getCell(4).value = e.vendor || '';
      cells.getCell(5).value = details.join('. ');
      cells.getCell(6).value = e.amount ?? null;
      cells.getCell(6).numFmt = '#,##0.00';
      cells.getCell(7).value = e.currency || 'USD';

      if (e.amount == null) {
        cells.getCell(9).value = 'Amount missing';
        cells.getCell(10).fill = amber;
      } else if (!isForeign(e)) {
        cells.getCell(10).value = { formula: `ROUND(F${r},2)`, result: usd };
      } else if (e.usd != null) {
        cells.getCell(9).value = 'USD charged per card statement';
        cells.getCell(10).value = round2(e.usd);
      } else if (e.rate) {
        cells.getCell(8).value = e.rate;
        cells.getCell(8).numFmt = '0.000000';
        cells.getCell(9).value = e.rateSource === 'Manual' || !e.rateSource
          ? `Entered manually${e.rateDate ? `, ${fmtDate(e.rateDate)}` : ''}`
          : `${e.rateSource}, ${fmtDate(e.rateDate || e.date)}`;
        cells.getCell(10).value = { formula: `ROUND(F${r}*H${r},2)`, result: usd };
      } else {
        cells.getCell(9).value = 'Rate needed';
        cells.getCell(8).fill = amber;
        cells.getCell(10).fill = amber;
      }
      cells.getCell(10).numFmt = '$#,##0.00';
      cells.getCell(11).value = pageRanges.get(e.id) || 'No receipt';
      if (!pageRanges.get(e.id)) cells.getCell(11).fill = amber;
      cells.getCell(11).alignment = { horizontal: 'right' };
      [4, 5, 9].forEach((c) => { cells.getCell(c).alignment = { wrapText: true, vertical: 'top' }; });
      [1, 2, 3, 6, 7, 8, 10, 11].forEach((c) => {
        cells.getCell(c).alignment = { ...(cells.getCell(c).alignment || {}), vertical: 'top' };
      });
      r++;
    });
    const last = r - 1;

    const totalRow = ws.getRow(r);
    totalRow.getCell(9).value = 'Total (USD)';
    totalRow.getCell(9).font = { bold: true };
    totalRow.getCell(9).alignment = { horizontal: 'right' };
    totalRow.getCell(10).value = entries.length ? { formula: `SUM(J${first}:J${last})`, result: round2(grand) } : 0;
    totalRow.getCell(10).numFmt = '$#,##0.00';
    totalRow.getCell(10).font = { bold: true };
    for (let c = 1; c <= 11; c++) totalRow.getCell(c).border = { top: { style: 'thin', color: { argb: 'FF5B6A72' } } };
    r += 2;

    if (entries.length) {
      ws.getCell(r, 9).value = 'Totals by category';
      ws.getCell(r, 9).font = { bold: true };
      r++;
      const cats = CATEGORIES.filter((c) => entries.some((e) => e.category === c))
        .concat(uniq(entries.map((e) => e.category)).filter((c) => !CATEGORIES.includes(c)));
      for (const c of cats) {
        ws.getCell(r, 9).value = c;
        ws.getCell(r, 9).alignment = { horizontal: 'right' };
        ws.getCell(r, 10).value = {
          formula: `SUMIF(C${first}:C${last},"${c.replace(/"/g, '""')}",J${first}:J${last})`,
          result: round2(catTotals.get(c) || 0),
        };
        ws.getCell(r, 10).numFmt = '$#,##0.00';
        r++;
      }
    }
    ws.pageSetup.printTitlesRow = `${headRow}:${headRow}`;

    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function exportIssues(entries) {
    const issues = [];
    const noReceipt = entries.filter((e) => !(e.receipts || []).length).length;
    const noAmount = entries.filter((e) => e.amount == null).length;
    const noRate = entries.filter((e) => e.amount != null && usdOf(e) == null).length;
    if (noReceipt) issues.push(`${noReceipt} ${noReceipt === 1 ? 'purchase has' : 'purchases have'} no receipt attached.`);
    if (noAmount) issues.push(`${noAmount} ${noAmount === 1 ? 'purchase has' : 'purchases have'} no amount.`);
    if (noRate) issues.push(`${noRate} foreign ${noRate === 1 ? 'purchase has' : 'purchases have'} no USD amount yet. ${navigator.onLine ? 'Open it and tap “Look up rate”, or enter the USD charged.' : 'The rate is looked up once you’re online.'}`);
    return issues;
  }

  const isTouch = () => matchMedia('(pointer: coarse)').matches;

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function shareFiles(files, title) {
    try {
      await navigator.share({ files, title });
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      toast("Sharing didn't work here. Use Download instead.", 4000);
    }
  }

  // Shows finished files with Share / Download buttons (each tap is its own user gesture, which iOS requires)
  function showReady(title, lede, files, extraHtml = '') {
    const canShare = !!(navigator.canShare && navigator.canShare({ files }));
    openSheet(`${sheetHead(title)}
      <div class="sheet-body">
        ${lede ? `<p class="sheet-lede">${lede}</p>` : ''}
        ${extraHtml}
        <div class="ready">${files.map((f, i) => `<div class="ready-file">
          <div><strong>${esc(f.name)}</strong><small>${fmtBytes(f.size)}</small></div>
          <button type="button" class="small-btn" data-dl="${i}">Download</button></div>`).join('')}</div>
        ${canShare ? `<button type="button" class="btn ${isTouch() ? 'btn-primary' : 'btn-secondary'} btn-block" data-share>${files.length > 1 ? 'Share or save both files' : 'Share or AirDrop'}</button>` : ''}
      </div>`);
    $$('[data-dl]', sheet).forEach((b) => b.addEventListener('click', () => downloadBlob(files[+b.dataset.dl], files[+b.dataset.dl].name)));
    const sb = $('[data-share]', sheet);
    if (sb) sb.addEventListener('click', () => shareFiles(files, title));
  }

  async function openExport(tripId) {
    const trip = await DB.get('trips', tripId);
    const entries = sortEntries(await tripEntries(tripId));
    const issues = exportIssues(entries);
    const askSpeedtypes = !(trip.speedtypes && trip.speedtypes.length);
    openSheet(`${sheetHead('Export')}
      <div class="sheet-body">
        <p class="sheet-lede">Creates the expense spreadsheet and one PDF with every receipt in date order. Receipt numbers and PDF pages match the spreadsheet rows.</p>
        ${askSpeedtypes
          ? `<label class="field"><span>Speedtype(s)</span>${SPEEDTYPE_INPUT()}</label>
             <p class="hint">10-digit numbers, separated by commas. They're saved to the trip. Leave this blank if you don't have them; that part of the spreadsheet stays empty.</p>`
          : `<p class="hint">${esc(speedtypeLine(trip.speedtypes))}. To make changes, edit the trip details.</p>`}
        ${issues.length ? `<ul class="issues">${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
          <p class="hint">You can export anyway and export again after fixing these.</p>` : ''}
        <button type="button" class="btn btn-primary btn-block" data-build>Create spreadsheet and PDF</button>
      </div>`);
    $('[data-build]', sheet).addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const spInput = $('input[name="speedtypes"]', sheet);
      if (spInput) {
        const sp = parseSpeedtypes(spInput.value);
        if (sp.bad.length) { toast(speedtypeError(sp.bad), 5000); spInput.focus(); return; }
        if (sp.list.length) {
          const fresh = await DB.get('trips', tripId);
          Object.assign(fresh, { speedtypes: sp.list, updatedAt: Date.now() });
          await DB.put('trips', fresh);
          trip.speedtypes = sp.list;
          render();
        }
      }
      btn.disabled = true;
      btn.textContent = 'Creating files…';
      try {
        const settings = await getSettings();
        const extras = await loadItems(trip.extras);
        const { blob: pdfBlob, pageRanges, problems } = await buildPdf(trip, entries, extras, settings);
        const xlsxBlob = await buildXlsx(trip, entries, settings, pageRanges);
        const base = safeFileName(trip.name);
        const files = [
          new File([xlsxBlob], `${base} expenses.xlsx`, { type: xlsxBlob.type }),
          new File([pdfBlob], `${base} receipts.pdf`, { type: 'application/pdf' }),
        ];
        showReady('Files ready',
          `${entries.length} ${entries.length === 1 ? 'receipt' : 'receipts'}, ${fmtMoney(entries.reduce((s, e) => s + (usdOf(e) || 0), 0))} total.`,
          files,
          problems.length ? `<ul class="issues">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '');
      } catch (err) {
        console.error(err);
        btn.disabled = false;
        btn.textContent = 'Create spreadsheet and PDF';
        toast(`Export failed: ${err.message}`, 5000);
      }
    });
  }

  /* =========================================================
     Backup & merge
     ========================================================= */

  async function buildBackup(tripIds /* null = everything */) {
    const allTrips = await DB.all('trips');
    const trips = tripIds ? allTrips.filter((t) => tripIds.includes(t.id)) : allTrips;
    const ids = new Set(trips.map((t) => t.id));
    const entries = (await DB.all('entries')).filter((e) => ids.has(e.tripId));
    const fileIds = new Set();
    trips.filter((t) => !t.deleted).forEach((t) => (t.extras || []).forEach((id) => fileIds.add(id)));
    entries.filter((e) => !e.deleted).forEach((e) => [...(e.receipts || []), ...(e.statements || [])].forEach((id) => fileIds.add(id)));
    const files = [];
    for (const id of fileIds) {
      const f = await DB.get('files', id);
      if (!f) continue;
      const t = await DB.get('thumbs', id);
      files.push({ ...f, data: await bufToBase64(f.data), thumb: t ? await bufToBase64(t.data) : null });
    }
    const payload = { app: BACKUP_APP, format: 1, version: VERSION, exportedAt: new Date().toISOString(), trips, entries, files };
    const name = tripIds && trips.length === 1
      ? `${safeFileName(trips[0].name)} backup ${todayISO()}.json`
      : `Trip receipts backup ${todayISO()}.json`;
    return new File([JSON.stringify(payload)], name, { type: 'application/json' });
  }

  async function backupFlow(tripIds) {
    openSheet(`${sheetHead('Back up')}<div class="sheet-body"><p class="sheet-lede">Preparing the backup file…</p></div>`);
    try {
      const file = await buildBackup(tripIds);
      showReady('Backup ready',
        'This one file has every entry and receipt image. AirDrop it to your other device, or save it somewhere safe. On the other device, open the app and choose “Merge a backup”.',
        [file]);
    } catch (err) {
      console.error(err);
      closeSheet(true);
      toast(`Backup failed: ${err.message}`, 5000);
    }
  }

  async function mergeBackup(data) {
    if (!data || data.app !== BACKUP_APP || !Array.isArray(data.trips) || !Array.isArray(data.entries)) {
      throw new Error("This file isn't a Trip Receipts backup.");
    }
    const stats = { tripsAdded: 0, tripsUpdated: 0, added: 0, updated: 0, same: 0, files: 0 };
    const incomingFiles = new Map((data.files || []).map((f) => [f.id, f]));
    const needed = new Set();

    for (const t of data.trips) {
      const local = await DB.get('trips', t.id);
      let result;
      if (!local) {
        result = t;
        stats.tripsAdded++;
      } else {
        const removed = uniq([...(local.removedFiles || []), ...(t.removedFiles || [])]);
        const incomingNewer = (t.updatedAt || 0) > (local.updatedAt || 0);
        const winner = incomingNewer ? t : local;
        result = {
          ...winner,
          lastCurrency: local.lastCurrency || t.lastCurrency,
          extras: uniq([...(winner.extras || []), ...(local.extras || []), ...(t.extras || [])]).filter((id) => !removed.includes(id)),
          removedFiles: removed,
        };
        if (incomingNewer) stats.tripsUpdated++;
      }
      if (!result.deleted) (result.extras || []).forEach((id) => needed.add(id));
      await DB.put('trips', result);
    }

    for (const e of data.entries) {
      const local = await DB.get('entries', e.id);
      let winner = local;
      if (!local) {
        winner = e;
        if (!e.deleted) stats.added++;
        await DB.put('entries', e);
      } else if ((e.updatedAt || 0) > (local.updatedAt || 0)) {
        winner = e;
        stats.updated++;
        await DB.put('entries', e);
      } else {
        stats.same++;
      }
      if (!winner.deleted) [...(winner.receipts || []), ...(winner.statements || [])].forEach((id) => needed.add(id));
    }

    for (const id of needed) {
      if (await DB.get('files', id)) continue;
      const f = incomingFiles.get(id);
      if (!f) continue;
      const { thumb, ...meta } = f;
      await DB.put('files', { ...meta, data: base64ToBuf(f.data) });
      if (thumb) await DB.put('thumbs', { id, data: base64ToBuf(thumb) });
      stats.files++;
    }
    await collectGarbage();
    askPersist();
    return stats;
  }

  const importInput = $('#import-input');
  if (isAndroid()) importInput.removeAttribute('accept');
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    importInput.value = '';
    if (!file) return;
    toast('Merging…', 10000);
    try {
      const data = JSON.parse(await file.text());
      const s = await mergeBackup(data);
      const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
      await render();
      $('#toast').classList.remove('show');
      openSheet(`${sheetHead('Backup merged')}
        <div class="sheet-body">
          <p class="sheet-lede">${when ? `Backup made ${esc(when)}.` : ''} Newer edits win when the same receipt was changed on both devices. Merging the same file twice is harmless.</p>
          <dl class="stat-list">
            <dt>New trips</dt><dd>${s.tripsAdded}</dd>
            <dt>Trips updated</dt><dd>${s.tripsUpdated}</dd>
            <dt>New receipts</dt><dd>${s.added}</dd>
            <dt>Receipts updated</dt><dd>${s.updated}</dd>
            <dt>Already up to date</dt><dd>${s.same}</dd>
          </dl>
          <button type="button" class="btn btn-primary btn-block" data-close>Done</button>
        </div>`);
    } catch (err) {
      console.error(err);
      toast(err instanceof SyntaxError ? "That file couldn't be read as a backup." : err.message, 5000);
    }
  });

  /* =========================================================
     Menus & settings
     ========================================================= */

  async function openTripMenu(tripId) {
    const trip = await DB.get('trips', tripId);
    const n = (trip.extras || []).length;
    openSheet(`${sheetHead(trip.name)}
      <div class="sheet-body">
        <ul class="menu">
          <li><button data-m="edit">Edit trip details</button></li>
          <li><button data-m="extras">Extra pages at the end of the PDF <span class="muted">${n || ''}</span></button></li>
        </ul>
        <ul class="menu">
          <li><button data-m="backup">Back up this trip</button></li>
          <li><button data-m="import">Merge a backup</button></li>
        </ul>
        <ul class="menu">
          <li><button data-m="delete" class="danger">Delete trip</button></li>
        </ul>
      </div>`);
    $$('[data-m]', sheet).forEach((b) => b.addEventListener('click', async () => {
      const m = b.dataset.m;
      if (m === 'edit') openTripEditor(tripId);
      if (m === 'extras') openExtras(tripId);
      if (m === 'backup') backupFlow([tripId]);
      if (m === 'import') { closeSheet(true); importInput.click(); }
      if (m === 'delete') {
        if (!confirm(`Delete “${trip.name}” and all its receipts? This can’t be undone. Back it up first if you might need it.`)) return;
        const now = Date.now();
        const es = await DB.byIndex('entries', 'tripId', tripId);
        await DB.putMany('entries', es.filter((e) => !e.deleted).map((e) => ({ ...e, receipts: [], statements: [], deleted: true, updatedAt: now })));
        await DB.put('trips', { ...trip, extras: [], deleted: true, updatedAt: now });
        await collectGarbage();
        closeSheet(true);
        location.hash = '#/';
        toast('Trip deleted');
      }
    }));
  }

  async function openSettings() {
    const s = await getSettings();
    let usage = '';
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        usage = `${fmtBytes(est.usage || 0)} used${persisted ? ', protected from automatic cleanup' : ''}`;
      }
    } catch { /* ignore */ }
    openSheet(`<form class="sheet-form" novalidate>
      ${sheetHead('Settings', '<button type="button" class="text-btn" data-close>Cancel</button>', '<button type="submit" class="text-btn strong">Save</button>')}
      <div class="sheet-body">
        <label class="field"><span>Your name</span>
          <input name="traveler" autocomplete="name" placeholder="Shown at the top of the spreadsheet" value="${esc(s.traveler)}"></label>
        <label class="switch-row"><span>Label each PDF page with its receipt number, date, and amount</span>
          <input type="checkbox" name="labelPages" ${s.labelPages ? 'checked' : ''}></label>
        <label class="switch-row"><span>Open the scanner after taking or choosing a receipt photo</span>
          <input type="checkbox" name="autoScan" ${s.autoScan ? 'checked' : ''}></label>
        <ul class="menu"><li><button type="button" data-all-backup>Back up all trips</button></li></ul>
        <p class="hint">Data is stored only in this browser on this device${usage ? ` (${esc(usage)})` : ''}. Clearing Safari’s website data deletes it, so keep a backup of trips you still need.</p>
        <p class="hint">Version ${VERSION}</p>
      </div>
    </form>`);
    const form = $('form', sheet);
    $('[data-all-backup]', sheet).addEventListener('click', () => backupFlow(null));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await DB.put('meta', { ...s, traveler: form.traveler.value.trim(), labelPages: form.labelPages.checked, autoScan: form.autoScan.checked });
      closeSheet(true);
      toast('Settings saved');
    });
  }

  /* =========================================================
     Wiring
     ========================================================= */

  const currentTripId = () => (location.hash.match(/^#\/trip\/([\w-]+)/) || [])[1];

  app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const tid = currentTripId();
    if (act === 'new-trip') openTripEditor(null);
    else if (act === 'edit-trip') openTripEditor(tid);
    else if (act === 'trip-menu') openTripMenu(tid);
    else if (act === 'new-entry') openEntryEditor(tid, null);
    else if (act === 'edit-entry') openEntryEditor(tid, b.dataset.id);
    else if (act === 'export') openExport(tid);
    else if (act === 'import') importInput.click();
    else if (act === 'settings') openSettings();
    else if (act === 'install' && installPrompt) {
      const p = installPrompt;
      installPrompt = null;
      p.prompt();
      Promise.resolve(p.userChoice).catch(() => null).then(() => render());
    }
    else if (act === 'apply-update' && updateWorker) {
      reloadOnControllerChange = true;
      updateWorker.postMessage('skipWaiting');
    }
  });

  window.addEventListener('hashchange', () => {
    if (sheet.open) closeSheet(true);
    render().then(() => { const id = currentTripId(); if (id) refreshRatesFor(id); });
    window.scrollTo(0, 0);
  });
  window.addEventListener('online', () => { const id = currentTripId(); if (id) refreshRatesFor(id); });

  let reloadOnControllerChange = false;
  const swAllowed = 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost');
  if (swAllowed) {
    {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        const watch = (w) => w && w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) { updateWorker = w; render(); }
        });
        if (reg.waiting && navigator.serviceWorker.controller) { updateWorker = reg.waiting; render(); }
        watch(reg.installing);
        reg.addEventListener('updatefound', () => watch(reg.installing));
      }).catch((err) => console.warn('Offline support unavailable:', err));
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadOnControllerChange) location.reload();
      });
    }
  }

  render().then(() => { const id = currentTripId(); if (id) refreshRatesFor(id); });

  // Exposed for automated tests only
  window.__tripReceipts = { DB, mergeBackup, buildBackup, parseAmount, usdOf, VERSION };
})();
