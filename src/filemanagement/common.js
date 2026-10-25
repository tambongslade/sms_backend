// Shared by the File Sharing page and the ARCHIVES page: helpers, registration/naming, dialogs, toasts,
// the upload queue, and the live (SSE) connection. Each page plugs its own rendering into `hooks`.
const $ = (s) => document.querySelector(s);
const BASE = location.pathname.replace(/archives\/?$/, '').replace(/\/?$/, '/');   // works under any mount path, on either page
const baseTitle = document.title;
const embed = new URLSearchParams(location.search).has('embed') || (() => { try { return sessionStorage.getItem('lanshare.embed') === '1'; } catch { return false; } })();
if (embed) { try { sessionStorage.setItem('lanshare.embed', '1'); } catch {} }
if (embed) document.body.classList.add('embed');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const fmtSpeed = (bps) => fmt(bps) + '/s';
const fmtEta = (sec) => !isFinite(sec) || sec < 0 ? '' : sec < 60 ? Math.max(1, Math.round(sec)) + 's left' : Math.round(sec / 60) + ' min left';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; };
const randId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');


let isServer = false, logTimer = null;
let me = null, devices = [], transfers = [], selected = new Set(), seen = new Set(), rx = {};
let maxBytes = 0, needSignIn = false;   // upload size limit and whether new PCs sign in with SMS accounts (both told by the server)
// page-specific rendering is plugged in here
const hooks = { renderAll() {}, renderList() {}, afterRefresh() {}, afterBoot() {} };

async function api(path, opt = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(BASE + 'api/' + path + sep + 'device=' + encodeURIComponent(me ? me.id : ''), opt);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || r.statusText), { status: r.status });
  return body;
}
const send = (method, path, data, password) => api(path, { method, headers: { 'Content-Type': 'application/json', 'X-Admin-Password': password || '' }, body: JSON.stringify(data) });

function toast(msg, ms = 4000, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// Dialog with an optional name field and optional admin-password field.
// Resolves { name, password }, or null if cancelled (when allowed).
function ask({ title, message = '', error = '', value = '', okLabel = 'Save', name = true, password = false, cancelable = true, maxLength = 40, placeholder = 'Computer name', passPlaceholder = 'Admin password' }) {
  return new Promise((resolve) => {
    const dlg = $('#dlg'), nameIn = $('#dlgInput'), passIn = $('#dlgPass');
    $('#dlgTitle').textContent = title; $('#dlgMsg').textContent = message; $('#dlgOk').textContent = okLabel;
    nameIn.style.display = name ? '' : 'none'; passIn.style.display = password ? '' : 'none';
    $('#dlgCancel').style.display = cancelable ? '' : 'none';
    nameIn.maxLength = maxLength; nameIn.placeholder = placeholder; passIn.placeholder = passPlaceholder;
    nameIn.value = value; passIn.value = ''; $('#dlgErr').textContent = error;
    const done = (v) => { dlg.close(); resolve(v); };
    $('#dlgForm').onsubmit = (e) => {
      e.preventDefault();
      const n = nameIn.value.trim(), p = passIn.value;
      if ((name && !n) || (password && !p)) return;
      done({ name: n, password: p });
    };
    $('#dlgCancel').onclick = () => done(null);
    dlg.oncancel = (e) => { if (cancelable) resolve(null); else e.preventDefault(); }; // Esc can't skip the first-time name
    dlg.showModal(); (name ? nameIn : passIn).focus(); if (name) nameIn.select();
  });
}

// First time a PC is seen it must pick a name (no password). After that, changing it needs the admin password.
// Step 1 of any admin action: explain, ask for the password, and have the server verify it.
// Returns the verified password, or null if the user cancels.
async function getAdminPassword(reason) {
  let error = '';
  while (true) {
    const r = await ask({
      title: 'Admin rights required', message: reason, error,
      name: false, password: true, okLabel: 'Continue',
    });
    if (!r) return null;
    try { await send('POST', 'admin/check', {}, r.password); return r.password; }
    catch (e) { error = e.status === 403 ? 'Wrong password, try again.' : e.message; }
  }
}

async function rename(dev) {
  const first = !dev.named && dev.id === me.id;
  let password = '';
  if (!first) {
    password = await getAdminPassword('Renaming ' + dev.name + ' needs an administrator. Enter the admin password to continue.');
    if (password === null) return;
  }
  let value = first ? '' : dev.name, error = '';
  while (true) {
    const r = await ask({
      title: first ? 'Welcome! Enter a name for this computer' : 'New name for ' + dev.name,
      error, value, cancelable: !first, okLabel: first ? 'Continue' : 'Rename',
    });
    if (!r) return;
    if (!first && r.name === dev.name) return;
    value = r.name;
    try { await send('PUT', 'devices/' + dev.id, { name: r.name }, password); return; }
    catch (e) { error = e.status === 409 ? 'That name is already used.' : e.status === 403 ? 'Admin session expired, close and try again.' : e.message; }
  }
}

// First visit with SMS registration on: the PC is named and given its access by signing in with an SSIC SMS account.
async function signIn() {
  let error = '';
  while (true) {
    const r = await ask({
      title: 'Sign in with your SSIC account',
      message: 'Register this computer with the email (or phone number) and password of your SSIC SMS account. Your name and your access come from that account.',
      error, name: true, password: true, cancelable: false, okLabel: 'Sign in', maxLength: 120, placeholder: 'SMS email or phone number', passPlaceholder: 'SMS password',
    });
    try { await send('POST', 'register/sms', { identifier: r.name, password: r.password }); return; }
    catch (e) { error = e.message; }
  }
}

async function removeDevice(dev) {
  const password = await getAdminPassword('Removing ' + dev.name + ' from the list needs an administrator. Enter the admin password to continue.');
  if (password === null) return;
  try { await send('DELETE', 'devices/' + dev.id, {}, password); }
  catch (e) { toast(e.message); }
}


// Where a transfer went: its PCs plus ARCHIVES when it was archived
const destLabel = (t) => toLabel([...(Array.isArray(t.to) ? t.to : t.to ? [t.to] : []), ...(t.archive ? ['archives'] : [])]);
const isToMe = (t) => t.to === 'all' || t.to === me.id || (Array.isArray(t.to) && t.to.includes(me.id));

// Human label for a transfer's recipients (older transfers stored one id or 'all')
function toLabel(to) {
  const ids = Array.isArray(to) ? to : [to];
  if (ids.includes('all')) return 'Everyone';
  const names = ids.map(nameOf);
  return names.length > 3 ? names.slice(0, 3).join(', ') + ' +' + (names.length - 3) + ' more' : names.join(', ');
}

const nameOf = (id) => id === 'archives' ? 'ARCHIVES' : id === 'server' ? 'Server PC' : id === 'all' ? 'Everyone' : id === me.id ? 'Me' : ((devices.find((d) => d.id === id) || {}).name || 'Removed PC');

function pctLine(t) {
  const known = t.size > 0, pct = known ? Math.min(100, Math.round(100 * (t.received || 0) / t.size)) : 0, v = (rx[t.id] || {}).v;
  return known ? pct + '%' + (v ? ' · ' + fmtSpeed(v) + ' · ' + fmtEta((t.size - (t.received || 0)) / v) : '') : 'receiving…';
}


async function loadTransfers() { transfers = await api('transfers'); hooks.renderList(); }

// Files from a drop; folders are skipped (they cannot be uploaded as a single file).
function filesFromDrop(dt) {
  const out = []; let dirs = 0;
  if (dt.items && dt.items.length) {
    for (const it of dt.items) {
      if (it.kind !== 'file') continue;
      const en = it.webkitGetAsEntry && it.webkitGetAsEntry();
      if (en && en.isDirectory) { dirs++; continue; }
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  } else out.push(...dt.files);
  if (dirs) toast('Folders cannot be sent. Zip the folder first, then drop the zip.');
  return out;
}


// ---- uploads: one at a time, each cancellable ----
const jobs = []; let running = false;

function enqueueSend(file, to, name = file.name, folder = '') {
  if (maxBytes && file.size > maxBytes) { toast('"' + name + '" is ' + fmt(file.size) + ', over the ' + fmt(maxBytes) + ' limit, so it was not sent.', 9000); return; }
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<span class="name">' + esc(name) + ' → ' + esc(toLabel(to)) + (folder ? ' / ' + esc(folder.split('/').join(' / ')) : '') + '</span><progress max="1" value="0" style="display:none"></progress><span class="meta">Waiting…</span><button type="button">Cancel</button>';
  $('#uploads').appendChild(row);
  const job = { file, to, name, folder, row, xhr: null, started: false, bar: row.querySelector('progress'), pct: row.querySelector('.meta'), btn: row.querySelector('button') };
  job.btn.onclick = () => {
    if (!job.started) { jobs.splice(jobs.indexOf(job), 1); row.remove(); } // never started: just drop it
    else job.xhr.abort();                                                   // in flight: the server discards the partial file
  };
  jobs.push(job);
  pump();
}

function pump() {
  if (running || !jobs.length) return;
  running = true;
  runJob(jobs.shift());
}

function runJob(job) {
  job.started = true; job.bar.style.display = ''; job.pct.textContent = '0%';
  const xhr = job.xhr = new XMLHttpRequest();
  xhr.open('PUT', BASE + 'api/send?device=' + encodeURIComponent(me.id) + '&to=' + encodeURIComponent(job.to.join(',')) + '&name=' + encodeURIComponent(job.name) + (job.folder ? '&folder=' + encodeURIComponent(job.folder) : ''));
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');
  const next = () => { running = false; pump(); };
  const failed = (msg) => { job.pct.textContent = msg; job.bar.style.display = 'none'; job.btn.textContent = 'Dismiss'; job.btn.onclick = () => job.row.remove(); next(); };
  job.t0 = job.tLast = performance.now(); job.lastLoaded = 0; job.speed = 0;
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const now = performance.now(), dt = (now - job.tLast) / 1000;
    if (dt >= 0.4) { const inst = (e.loaded - job.lastLoaded) / dt; job.speed = job.speed ? job.speed * 0.6 + inst * 0.4 : inst; job.tLast = now; job.lastLoaded = e.loaded; }
    job.bar.value = e.loaded / e.total;
    job.pct.textContent = Math.round(100 * e.loaded / e.total) + '%' + (job.speed ? ' · ' + fmtSpeed(job.speed) + ' · ' + fmtEta((e.total - e.loaded) / job.speed) : '');
  };
  xhr.onload = () => {
    if (xhr.status === 200) {
      const secs = Math.max(0.001, (performance.now() - job.t0) / 1000);
      toast('✓ ' + job.name + ' was sent successfully to ' + toLabel(job.to) + (job.folder ? ' / ' + job.folder.split('/').join(' / ') : '') + ' (' + fmt(job.file.size) + ' at ' + fmtSpeed(job.file.size / secs) + ')', 8000, 'ok');
      job.row.remove(); loadTransfers(); next();
    }
    else { let m = 'failed'; try { m = JSON.parse(xhr.responseText).error; } catch {} failed(m); }
  };
  xhr.onerror = () => failed('failed');
  xhr.onabort = () => { job.row.remove(); toast('Cancelled ' + job.name + ' (nothing was sent)'); next(); };
  xhr.send(job.file);
}


// ---- boot ----
async function register() {
  let id = store.get('lanshare.id');
  if (!id) { id = randId(); store.set('lanshare.id', id); }
  const r = await fetch(BASE + 'api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: store.get('lanshare.name') || '' }) });
  const j = await r.json();
  const device = j.device;
  me = device;
  isServer = !!j.server; // the server tells us whether this page is running ON the server PC
  maxBytes = j.maxBytes || 0; needSignIn = !!j.signIn;
  store.set('lanshare.id', device.id); // the server may have matched this PC to an existing device
}


function connect() {
  const es = new EventSource(BASE + 'api/events?device=' + encodeURIComponent(me.id));
  es.addEventListener('devices', (e) => { devices = JSON.parse(e.data); const m = devices.find((d) => d.id === me.id); if (m && m.named) store.set('lanshare.name', m.name); hooks.renderAll(); });
  es.addEventListener('refresh', () => { loadTransfers(); hooks.afterRefresh(); });
  // A send is announced the moment it starts; progress then streams in until it is complete.
  es.addEventListener('transfer', async (e) => {
    const t = JSON.parse(e.data);
    await loadTransfers();
    if (t.from !== me.id) { toast(nameOf(t.from) + ' is sending you ' + t.name); document.title = '• ' + baseTitle; }
  });
  es.addEventListener('progress', (e) => {
    const p = JSON.parse(e.data), now = performance.now();
    const t = transfers.find((x) => x.id === p.id);
    if (t) { t.received = p.received; if (p.size) t.size = p.size; }
    let r = rx[p.id];
    if (!r) r = rx[p.id] = { t: now, r: p.received, v: 0 };
    else if (now - r.t >= 400) { const inst = (p.received - r.r) / ((now - r.t) / 1000); r.v = r.v ? r.v * 0.6 + inst * 0.4 : inst; r.t = now; r.r = p.received; }
    const bar = document.querySelector('progress[data-prog="' + p.id + '"]'), pct = document.querySelector('[data-pct="' + p.id + '"]');
    if (bar && p.size) { bar.value = p.received / p.size; if (pct && t) pct.textContent = pctLine(t); }
  });
  es.addEventListener('archived', (e) => { const d = JSON.parse(e.data); if (d.byName !== me.name) toast(d.byName + ' added ' + d.name + ' to ARCHIVES', 6000); });
  es.addEventListener('downloaded', (e) => { const d = JSON.parse(e.data); toast('✓ ' + d.byName + ' received ' + d.name, 8000, 'ok'); loadTransfers(); });
  es.addEventListener('cancelled', (e) => { const c = JSON.parse(e.data); toast(c.fromName + ' cancelled sending ' + c.name); });
  window.addEventListener('focus', () => (document.title = baseTitle));
  es.onerror = async () => {
    // server restarted and may have lost us: re-register, then EventSource reconnects on its own
    try { await register(); } catch {}
  };
}


// Normal start-up for both pages: register this PC, make a first-time visitor pick a name, load files, go live.
async function boot() {
  await register();
  devices = await api('devices');
  hooks.renderAll();
  if (!me.named) { await (needSignIn ? signIn() : rename(me)); devices = await api('devices'); } // first visit: sign in with the SMS account (or choose a name)
  await loadTransfers();
  hooks.renderAll();
  connect();
  hooks.afterBoot();
}
