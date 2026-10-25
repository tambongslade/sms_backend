// LAN Share core. Zero dependencies, framework-agnostic.
//
//   const { createLanShare } = require('./lanShare');
//   const share = createLanShare({ dir, authenticate });
//   http.createServer(share)                 // standalone
//   app.use('/lan-share', share)             // inside Express (SSIC)
//
// The handler serves the UI at its root and the API under api/. All UI URLs are relative,
// so it works under any mount path.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');

function createLanShare(opts = {}) {
  const dir = path.resolve(opts.dir || path.join(__dirname, 'shared'));
  fs.mkdirSync(dir, { recursive: true });
  const retentionDays = opts.retentionDays ?? 7; // 0 = keep forever
  const maxBytes = opts.maxBytes || 0; // 0 = unlimited
  const tooBigMsg = () => 'This file is larger than the ' + Math.round(maxBytes / 1048576) + ' MB limit.';
  // When set, a new PC cannot choose its own name: it registers by signing in with an SSIC SMS account
  // (async (identifier, password) => { name, profile, userId }; throws an Error with .status on refusal).
  const smsLogin = opts.smsLogin || null;
  // Shared secret with the SSIC SMS backend. When set, requests carrying a valid X-SMS-Identity / X-SMS-Signature pair
  // (made by that backend after it has checked the person's SMS login) act as that person. Without it the headers are ignored.
  const smsSecret = String(opts.smsSecret || '');
  // A listener that ONLY serves signed SMS sessions (the end of the tunnel to the online SMS). Everything arriving there
  // looks local, so without this rule anything that can reach that port would act as the server PC.
  const smsOnlyPort = Number(opts.smsOnlyPort || 0);
  // Embedded in the SMS backend: every request must carry a valid signed SMS identity, so nothing can ever act as the "server PC".
  const smsOnly = !!opts.smsOnly;
  const authenticate = opts.authenticate || (() => true); // (req) => truthy to allow
  const adminPassword = String(opts.adminPassword || ''); // needed to rename a named PC or remove one; '' = no check
  // Files sent to PCs wait here until every recipient has downloaded them (see settleTransfer), or for retentionDays.
  let filesDir = path.resolve(opts.tempDir || path.join(dir, 'files'));
  const dbFile = path.join(dir, 'db.json');
  const uiFile = path.join(__dirname, 'ui.html');
  const agentFile = path.join(__dirname, 'agent.ps1');
  const logoFile = path.join(__dirname, 'logo.png'); // SSIC logo, copied from the SMS frontend's public/logo.png
  try { fs.mkdirSync(filesDir, { recursive: true }); }
  catch (e) {
    console.warn('LAN Share: cannot use transfer folder ' + filesDir + ' (' + e.message + '); using the data folder instead');
    filesDir = path.join(dir, 'files');
    fs.mkdirSync(filesDir, { recursive: true });
  }
  const legacyFilesDir = path.join(dir, 'files');   // where files were kept before the transfer folder existed
  // ARCHIVES live in their own folder under their real names so people can also browse them in Explorer.
  // If that folder cannot be created (e.g. the drive is missing) fall back to a folder inside the data dir.
  let archiveDir = path.resolve(opts.archiveDir || path.join(dir, 'archives'));
  try { fs.mkdirSync(archiveDir, { recursive: true }); }
  catch (e) {
    console.warn('LAN Share: cannot use archive folder ' + archiveDir + ' (' + e.message + '); using the data folder instead');
    archiveDir = path.join(dir, 'archives');
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  let db = { devices: {}, transfers: [] };
  try { db = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch {}
  // A restart kills any upload in flight: forget those records and delete their partial files.
  db.transfers = db.transfers.filter((t) => t.status !== 'sending');
  for (const f of fs.readdirSync(filesDir)) if (f.endsWith('.part')) fs.unlink(path.join(filesDir, f), () => {});
  if (legacyFilesDir !== filesDir && fs.existsSync(legacyFilesDir)) {
    for (const t of db.transfers) {
      if (t.archive || t.file) continue;
      const old = path.join(legacyFilesDir, t.id);
      if (!fs.existsSync(old)) continue;
      try { fs.copyFileSync(old, path.join(filesDir, t.id)); fs.unlinkSync(old); } catch {}   // copy, not rename: another drive
    }
    for (const f of fs.readdirSync(legacyFilesDir)) if (f.endsWith('.part')) fs.unlink(path.join(legacyFilesDir, f), () => {});
  }
  for (const f of fs.readdirSync(archiveDir)) if (/^[0-9a-f]{16}\.part$/.test(f)) fs.unlink(path.join(archiveDir, f), () => {});

  const save = () => {
    fs.writeFileSync(dbFile + '.tmp', JSON.stringify(db));
    fs.renameSync(dbFile + '.tmp', dbFile);
  };

  // ---- realtime (Server-Sent Events): deviceId -> Set<res> ----
  const streams = new Map();
  // A PC counts as online while its page is open (SSE) or its background receiver has polled in the last 20s.
  const agentSeen = new Map(); // deviceId -> last receiver poll time
  const agentUp = (id) => Date.now() - (agentSeen.get(id) || 0) < 20000;
  const isOnline = (id) => (streams.get(id) || { size: 0 }).size > 0 || agentUp(id);
  function emit(event, data, only) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [id, set] of streams)
      if (!only || only.includes(id)) for (const r of set) r.write(msg);
  }

  // ---- helpers ----
  const safeName = (n) => path.basename(String(n || '').replace(/\\/g, '/')).replace(/[<>:"|?*\x00-\x1f]/g, '_').slice(0, 200);
  const cleanDeviceName = (n) => String(n || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const nameTaken = (name, exceptId) =>
    Object.values(db.devices).some((d) => d.id !== exceptId && d.name.toLowerCase() === name.toLowerCase());
  const publicDevice = (d) => {
    const mac = (d.keys || []).filter((k) => k.startsWith('mac:')).map((k) => k.slice(4));
    return { id: d.id, name: d.name, named: d.named !== false, online: isOnline(d.id), agent: agentUp(d.id), lastSeen: d.lastSeen, macs: mac, profile: d.profile || 'default', canManage: !!d.canManage };
  };
  const deviceList = () => Object.values(db.devices).map(publicDevice).sort((a, b) => a.name.localeCompare(b.name));
  // t.to is a list of device ids. Older transfers stored a single id or the string 'all'; both are still honoured.
  const isRecipient = (t, id) => t.to === 'all' || t.to === id || (Array.isArray(t.to) && t.to.includes(id));
  // ARCHIVES: a shared store every PC can add to and download from. A transfer with archive:true is visible to all
  // devices, is never auto-deleted, and can only be removed with the admin password.
  // ---- activity log: who sent / received / deleted what, and when. Readable ONLY from the server PC. ----
  // Append-only JSON lines in the data folder. Nothing in the app can edit or delete entries.
  const logFile = path.join(dir, 'activity.log');
  const devName = (id) => (id === 'archives' ? 'ARCHIVES' : id === 'server' ? 'Server PC' : (db.devices[id] || { name: '(removed PC)' }).name);
  const macOfDevice = (d) => ((d && d.keys) || []).filter((k) => k.startsWith('mac:')).map((k) => k.slice(4))[0] || '';
  function logEvent(type, who, extra = {}) {
    const rec = { ts: Date.now(), type, by: who ? { id: who.id, name: who.name, mac: macOfDevice(who) } : null, ...extra };
    fs.appendFile(logFile, JSON.stringify(rec) + '\n', () => {});
  }
  function readLog({ limit = 500, q = '', type = '' } = {}) {
    let text = '';
    try { text = fs.readFileSync(logFile, 'utf8'); } catch { return []; }
    const out = [], needle = q.toLowerCase(), lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      if (!lines[i]) continue;
      let r; try { r = JSON.parse(lines[i]); } catch { continue; }
      if (type && r.type !== type) continue;
      if (needle && !JSON.stringify(r).toLowerCase().includes(needle)) continue;
      out.push(r);
    }
    return out;
  }
  // The server PC's own network cards (Node reports their MACs). The LAN card (192.168.x) is preferred over virtual ones.
  function serverMacs() {
    const out = [];
    for (const [nic, list] of Object.entries(os.networkInterfaces()))
      for (const i of list)
        if (i.family === 'IPv4' && !i.internal && i.mac && i.mac !== '00:00:00:00:00:00')
          out.push({ nic, ip: i.address, mac: i.mac.toLowerCase().replace(/:/g, '-') });
    const rank = (a) => (a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : 2);
    return out.sort((a, b) => rank(a.ip) - rank(b.ip));
  }
  // True only for a connection that really originates ON this PC (see clientIp: X-Forwarded-For is trusted solely
  // from a loopback peer, i.e. our own nginx, which overwrites it with the true client address).
  // An SMS session reaches us from the SMS backend on this very machine (or through the tunnel), so its connection
  // looks local: it must never be mistaken for someone sitting at the server PC.
  const isServerRequest = (req) => !req.smsDevice && clientIp(req) === 'this-server';
  const csvCell = (v) => { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };

  // ===== ARCHIVES mirror the real folder tree under archiveDir (e.g. D:\ARCHIVES), sub-folders included =====
  // The folder on the server PC is the source of truth. Folders created, files moved, renamed or deleted there (in
  // Explorer) are picked up by a watcher and pushed to every open page. A moved file keeps its "added by" because it is
  // recognised by its identity on disk (NTFS file ID + size), not only by its path. The web app itself has NO way to
  // create, move, rename or delete a folder or file in the archive: only this PC can.
  const archivePathOf = (t) => t.archivePath || t.archiveName || '';          // 'Finance/2026/report.pdf'
  const pathOf = (t) => (t.archive && archivePathOf(t) ? path.join(archiveDir, ...archivePathOf(t).split('/')) : path.join(filesDir, t.file || t.id));
  // A folder named by a client must already exist inside the archive: relative, no '..', no hidden names.
  function resolveArchiveFolder(rel) {
    rel = String(rel || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!rel) return { rel: '', abs: archiveDir };
    const segs = rel.split('/');
    if (segs.some((x) => !x || x === '.' || x === '..' || x.startsWith('.') || x.startsWith('$') || /[<>:"|?*\x00-\x1f]/.test(x))) return null;
    const abs = path.join(archiveDir, ...segs);
    if (path.relative(archiveDir, abs).startsWith('..') || path.isAbsolute(path.relative(archiveDir, abs))) return null;
    try { if (!fs.statSync(abs).isDirectory()) return null; } catch { return null; }
    return { rel: segs.join('/'), abs };
  }
  // A name is taken if a file with it is in that folder (Windows compares case-insensitively) or an upload with that
  // name is still in progress there. Archive files are never replaced, so the sender must pick another name.
  const archiveNameTaken = (name, folderRel = '') =>
    fs.existsSync(path.join(archiveDir, ...String(folderRel).split('/').filter(Boolean), name)) ||
    db.transfers.some((x) => x.archive && x.status === 'sending' && (x.folder || '').toLowerCase() === String(folderRel).toLowerCase() && x.name.toLowerCase() === name.toLowerCase());

  let archiveFolders = [];  // [{ path, time }] every folder under archiveDir, empty ones included
  const isPartFile = (n) => /^[0-9a-f]{16}\.part$/.test(n);
  function scanArchive() {
    const files = [], folders = [];
    const walk = (abs, rel, depth) => {
      let entries; try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
      for (const d of entries) {
        if (d.name.startsWith('.') || d.name.startsWith('$')) continue;                 // hidden / system names
        const childRel = rel ? rel + '/' + d.name : d.name, childAbs = path.join(abs, d.name);
        if (d.isDirectory()) {
          if (depth >= 12) continue;
          let st; try { st = fs.statSync(childAbs); } catch { continue; }
          folders.push({ path: childRel, time: st.mtimeMs });
          walk(childAbs, childRel, depth + 1);
        } else if (d.isFile() && !isPartFile(d.name)) {
          let st; try { st = fs.statSync(childAbs, { bigint: true }); } catch { continue; }
          files.push({ rel: childRel, name: d.name, size: Number(st.size), time: Number(st.mtimeMs), fileKey: String(st.ino) });
        }
      }
    };
    walk(archiveDir, '', 0);
    folders.sort((x, y) => x.path.localeCompare(y.path, undefined, { sensitivity: 'base' }));
    return { files, folders };
  }

  let lastArchiveSync = 0;
  // Brings the shared list in line with the real folder tree. Returns true if anything changed.
  const syncArchive = (force) => {
    if (!force && Date.now() - lastArchiveSync < 2000) return false;                // scans are throttled; the watcher forces one
    lastArchiveSync = Date.now();
    const { files, folders } = scanArchive();
    let changed = false;
    const byPath = new Map(files.map((f) => [f.rel.toLowerCase(), f]));
    const archived = db.transfers.filter((t) => t.archive && t.status !== 'sending');
    const claimed = new Set(), seen = new Set();
    // 1. records whose file is still where we left it
    for (const t of archived) {
      if (!t.archivePath && t.archiveName) { t.archivePath = t.archiveName; changed = true; }  // older records
      const f = byPath.get(archivePathOf(t).toLowerCase());
      if (!f || claimed.has(f.rel)) continue;
      claimed.add(f.rel); seen.add(t.id);
      if (t.fileKey !== f.fileKey) { t.fileKey = f.fileKey; changed = true; }
      if (t.size !== f.size) { t.size = f.size; changed = true; }
    }
    // 2. records whose file was moved or renamed on the server PC: same file identity and size at a new path
    for (const t of archived) {
      if (seen.has(t.id) || !t.fileKey) continue;
      const f = files.find((u) => !claimed.has(u.rel) && u.fileKey === t.fileKey && u.size === t.size);
      if (!f) continue;
      claimed.add(f.rel); seen.add(t.id);
      t.archivePath = f.rel; delete t.archiveName; t.name = f.name; changed = true;
    }
    // 3. records whose file is gone (deleted on the server PC): drop them so the list never shows ghosts
    const gone = archived.filter((t) => !seen.has(t.id));
    if (gone.length) { db.transfers = db.transfers.filter((t) => !gone.includes(t)); changed = true; }
    // 4. files that appeared by hand (or after a database reset): adopt them, credited to "Server PC"
    const inFlight = new Set(db.transfers.filter((t) => t.archive && t.status === 'sending').map((t) => ((t.folder ? t.folder + '/' : '') + t.name).toLowerCase()));
    for (const f of files) {
      if (claimed.has(f.rel) || inFlight.has(f.rel.toLowerCase())) continue;
      db.transfers.push({ id: crypto.randomBytes(8).toString('hex'), name: f.name, size: f.size, from: 'server', to: [], archive: true, archivePath: f.rel, fileKey: f.fileKey, time: f.time, downloadedBy: [], status: 'done', received: f.size });
      changed = true;
    }
    if (JSON.stringify(folders) !== JSON.stringify(archiveFolders)) { archiveFolders = folders; changed = true; }
    if (changed) { save(); emit('refresh', {}); }
    return changed;
  };
  // half-written uploads left behind by a crash, in any folder
  (function cleanParts(abs, depth) {
    let entries; try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const d of entries) {
      if (d.isFile() && isPartFile(d.name)) fs.unlink(path.join(abs, d.name), () => {});
      else if (d.isDirectory() && depth < 12 && !d.name.startsWith('.')) cleanParts(path.join(abs, d.name), depth + 1);
    }
  })(archiveDir, 0);
  syncArchive(true);
  // Push changes made on the server PC to every open page within a moment.
  let watchTimer = null;
  const scheduleSync = () => { clearTimeout(watchTimer); watchTimer = setTimeout(() => { try { syncArchive(true); } catch {} }, 400); };
  function watchArchive() {
    try {
      const w = fs.watch(archiveDir, { recursive: true, persistent: false }, (evt, name) => { if (name && isPartFile(path.basename(String(name)))) return; scheduleSync(); });
      w.on('error', () => { try { w.close(); } catch {} setTimeout(watchArchive, 5000); });
    } catch (e) { console.warn('LAN Share: cannot watch ' + archiveDir + ' (' + e.message + '); checking every 15 seconds instead'); }
  }
  watchArchive();
  setInterval(() => { try { syncArchive(true); } catch {} }, 15000).unref();   // safety net if a change event is ever missed
  // ===== PROFILES: which ARCHIVES folders each PC may see =====
  // Every PC (old and new) starts as "default": it sees everything outside the restricted folders. The server PC, and
  // any PC the server PC marks as a manager (PEREZ's laptop), can give other PCs a profile. A restricted folder
  // is matched by its top-level name (sub-folders inherit); the rules live in db.archiveRules.
  const PROFILES = ['default', 'management', 'administration', 'discipline'];
  if (!db.archiveRules) db.archiveRules = {
    'management documents': ['management'],
    'administrative documents': ['management', 'administration'],
    'discipline': ['management', 'administration', 'discipline'],
  };
  for (const d of Object.values(db.devices)) {       // first start with profiles: the server PC and PEREZ are managers
    if (d.profile === undefined && ((d.keys || []).includes('this-server') || ['ceo', 'perez'].includes(String(d.name).toLowerCase()))) { d.profile = 'management'; d.canManage = true; }
  }
  save();
  const relDir = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const profileOk = (profile, dirRel) => {            // may this profile see things in this folder (or this folder itself)?
    const top = String(dirRel || '').split('/')[0].toLowerCase();
    const rule = top && db.archiveRules[top];
    return !rule || rule.includes(profile);
  };
  const canSeeItem = (profile, t) => profileOk(profile, t.status === 'sending' ? t.folder : relDir(archivePathOf(t)));
  // The profile is taken from the PC that really made the request: the device id must belong to the network address
  // (MAC) the request came from, so knowing another PC's id is not enough. The server PC is always management.
  const actorCache = new Map();
  async function actorOf(req, me) {
    if (req.smsDevice) { const d = req.smsDevice; return { profile: d.profile || 'default', manager: !!d.canManage, server: false }; }
    if (isServerRequest(req)) return { profile: 'management', manager: true, server: true };
    const none = { profile: 'default', manager: false, server: false };
    const d = db.devices[me];
    if (!d) return none;
    const ip = clientIp(req), ck = me + '|' + ip, hit = actorCache.get(ck);
    let ok;
    if (hit && Date.now() - hit.t < 30000) ok = hit.ok;
    else { ok = (d.keys || []).includes(await deviceKey(ip)); actorCache.set(ck, { ok, t: Date.now() }); }
    return ok ? { profile: d.profile || 'default', manager: !!d.canManage, server: false } : none;
  }
  // ----- SSIC SMS identity (File Management menu in the SMS app) -----
  function smsDeviceFor(req) {
    const idHdr = String(req.headers['x-sms-identity'] || ''), sig = String(req.headers['x-sms-signature'] || '');
    if (!smsSecret || !idHdr) return undefined;                          // feature off / not an SMS request
    const want = crypto.createHmac('sha256', smsSecret).update(idHdr).digest('hex');
    const a = Buffer.from(sig), b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    let p; try { p = JSON.parse(Buffer.from(idHdr, 'base64url').toString()); } catch { return null; }
    if (!p || !p.uid || !PROFILES.includes(p.profile) || Math.abs(Date.now() - Number(p.ts)) > 10 * 60 * 1000) return null;
    const uid = String(p.uid);
    let d = Object.values(db.devices).find((x) => x.smsUser !== undefined && String(x.smsUser) === uid);   // a PC they registered, or their earlier web session
    if (!d) {
      const base = cleanDeviceName(p.name) || 'User';
      let name = base;
      for (let n = 2; nameTaken(name); n++) name = base + ' ' + n;
      d = db.devices['sms-' + uid] = { id: 'sms-' + uid, name, keys: [], named: true, lastSeen: Date.now(), profile: p.profile, smsUser: uid };
      save(); emit('devices', deviceList());
    } else if (!d.profileLocked && (d.profile || 'default') !== p.profile) {   // follows the SMS role unless the server PC set it by hand
      d.profile = p.profile; save(); emit('devices', deviceList()); emit('refresh', {});
    }
    if (p.mgr && !d.canManage) { d.canManage = true; save(); emit('devices', deviceList()); }   // SMS managers can move/copy files and create ARCHIVES folders
    d.lastSeen = Date.now();
    return d;
  }
  const visibleTo = (t, id) => t.from === id || isRecipient(t, id) || !!t.archive;

  function json(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
  function readJson(req) {
    return new Promise((resolve) => {
      let s = '';
      req.on('data', (c) => { s += c; if (s.length > 10000) req.destroy(); });
      req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    });
  }
  function removeTransfer(t) {
    if (t.archive) return; // ARCHIVES files are only ever deleted by hand on the server PC
    db.transfers = db.transfers.filter((x) => x.id !== t.id);
    fs.unlink(pathOf(t), () => {});
  }

  // Everyone who must still fetch this file: the chosen PCs (or every PC for "everyone"), minus the sender and
  // anyone who declined it or was removed from the app.
  const pendingRecipients = (t) => {
    const ids = t.to === 'all' ? Object.keys(db.devices) : Array.isArray(t.to) ? t.to : t.to ? [t.to] : [];
    return ids.filter((id) => id !== t.from && db.devices[id] && (t.responses || {})[id] !== 'declined' && !(t.completedBy || []).includes(id));
  };
  // A file sent to PCs is deleted as soon as the last recipient has received ALL of it.
  function settleTransfer(t) {
    if (t.archive || t.status === 'sending') return false;
    const everyone = t.to === 'all' ? Object.keys(db.devices).filter((id) => id !== t.from) : Array.isArray(t.to) ? t.to : t.to ? [t.to] : [];
    if (!everyone.length || pendingRecipients(t).length) return false;
    logEvent('auto-deleted', null, { file: t.name, size: t.size, from: devName(t.from), detail: 'every recipient has downloaded it' });
    removeTransfer(t);
    return true;
  }

  function sweep() {
    if (!retentionDays) return;
    const cutoff = Date.now() - retentionDays * 864e5;
    const old = db.transfers.filter((t) => t.time < cutoff && !t.archive);
    if (!old.length) return;
    old.forEach((t) => logEvent('auto-deleted', null, { file: t.name, size: t.size, from: devName(t.from), detail: 'not downloaded within ' + retentionDays + ' days' }));
    old.forEach(removeTransfer);
    save();
    emit('refresh', {});
  }
  setInterval(sweep, 36e5).unref();
  sweep();

  // Address of the calling PC. Anything coming from the server PC itself (localhost or one of its own
  // addresses) is one identity. Behind a reverse proxy (nginx in SSIC), pass trustProxy: true.
  function clientIp(req) {
    // X-Forwarded-For is honoured only when the direct peer is this machine (the local nginx), so a LAN
    // client hitting the app directly cannot spoof its address.
    const peer = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const viaLocalProxy = opts.trustProxy && (peer === '::1' || peer.startsWith('127.'));
    const fwd = viaLocalProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
    const ip = fwd || peer;
    if (ip === '::1' || ip.startsWith('127.')) return 'this-server';
    for (const list of Object.values(os.networkInterfaces()))
      if (list.some((i) => i.address === ip)) return 'this-server';
    return ip;
  }

  const smsFails = new Map(); // ip -> { n, t }: failed SMS sign-ins
  // ---- admin password gate (header X-Admin-Password), with a lockout against guessing ----
  const adminFails = new Map(); // ip -> { n, t }
  function adminGate(req, res) {
    if (req.smsDevice) { json(res, 403, { error: 'Renaming or removing computers can only be done on the server PC.' }); return false; }
    if (!adminPassword) return true;
    const ip = clientIp(req);
    const f = adminFails.get(ip) || { n: 0, t: 0 };
    if (Date.now() - f.t > 6e5) f.n = 0;
    if (f.n >= 5) { json(res, 429, { error: 'Too many wrong passwords. Try again in 10 minutes.' }); return false; }
    const given = Buffer.from(String(req.headers['x-admin-password'] || ''));
    const want = Buffer.from(adminPassword);
    if (given.length === want.length && crypto.timingSafeEqual(given, want)) { adminFails.delete(ip); return true; }
    f.n++; f.t = Date.now(); adminFails.set(ip, f);
    logEvent('admin-password-failed', db.devices[String(new URL(req.url, 'http://x').searchParams.get('device') || '')] || null, { ip, detail: req.method + ' ' + new URL(req.url, 'http://x').pathname });
    json(res, 403, { error: 'Wrong password' });
    return false;
  }

  function touchAgent(id) {
    const wasUp = agentUp(id);
    agentSeen.set(id, Date.now());
    if (!wasUp) emit('devices', deviceList()); // lets open pages hide the "install receiver" banner
  }

  // ---- PC identity ----
  const ipToInt = (s) => {
    const p = String(s).split('.').map(Number);
    return p.length === 4 && p.every((x) => x >= 0 && x <= 255) ? ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0 : null;
  };
  // A MAC is only meaningful for hosts on a directly attached subnet; beyond a router the ARP entry is the router's.
  function onLocalSubnet(ip) {
    const n = ipToInt(ip);
    if (n === null) return false;
    for (const list of Object.values(os.networkInterfaces()))
      for (const i of list) {
        if (i.family !== 'IPv4' || i.internal) continue;
        const m = ipToInt(i.netmask), a = ipToInt(i.address);
        if (((n & m) >>> 0) === ((a & m) >>> 0)) return true;
      }
    return false;
  }
  const macCache = new Map(); // ip -> { mac, t }
  function macOf(ip) {
    const hit = macCache.get(ip);
    if (hit && Date.now() - hit.t < 6e5) return Promise.resolve(hit.mac);
    return new Promise((resolve) => {
      const finish = (text) => {
        const line = String(text).split(/\r?\n/).find((l) => l.trim().split(/\s+/)[0] === ip);
        const m = line && line.match(/\b(?:[0-9a-f]{2}[-:]){5}[0-9a-f]{2}\b/i);
        const mac = m ? m[0].toLowerCase().replace(/:/g, '-') : null;
        if (mac && mac !== 'ff-ff-ff-ff-ff-ff' && mac !== '00-00-00-00-00-00') { macCache.set(ip, { mac, t: Date.now() }); resolve(mac); }
        else resolve(null);
      };
      if (process.platform === 'win32') execFile('arp', ['-a', ip], { timeout: 3000, windowsHide: true }, (e, out) => finish(out || ''));
      else fs.readFile('/proc/net/arp', 'utf8', (e, out) => finish(out || ''));
    });
  }
  async function deviceKey(ip) {
    if (ip === 'this-server') return ip;
    if (onLocalSubnet(ip)) { const mac = await macOf(ip); if (mac) return 'mac:' + mac; }
    return 'ip:' + ip;
  }
  function addKey(d, k) {
    if (!d.keys) d.keys = [];
    if (!d.keys.includes(k)) d.keys = [...d.keys, k].slice(-8);
  }
  // Fold a duplicate record into the real one, keeping its history (files sent/received) and its addresses.
  function mergeInto(keep, old) {
    for (const t of db.transfers) {
      if (t.from === old.id) t.from = keep.id;
      if (t.to === old.id) t.to = keep.id;
      else if (Array.isArray(t.to)) t.to = [...new Set(t.to.map((x) => (x === old.id ? keep.id : x)))];
      t.downloadedBy = [...new Set(t.downloadedBy.map((x) => (x === old.id ? keep.id : x)))];
    }
    for (const k of old.keys || []) addKey(keep, k);
    delete db.devices[old.id];
  }

  // ---- request handler ----
  const lanShare = async function (req, res, next) {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const q = url.searchParams;
    let me = q.get('device') || '';
    const smsDev = smsDeviceFor(req);
    if (smsDev === null) return json(res, 401, { error: 'Invalid SMS identity.' });
    if (((smsOnlyPort && req.socket.localPort === smsOnlyPort) || smsOnly) && !smsDev) return json(res, 403, { error: 'This address only accepts signed SMS sessions.' });
    if (smsDev) { req.smsDevice = smsDev; me = smsDev.id; }   // the signed identity decides who this is, whatever the page sent
    const miss = () => (next ? next() : json(res, 404, { error: 'not found' }));

    // Public install assets (no auth: they contain nothing but the URL the caller passes in)
    if (req.method === 'GET' && p === 'manifest.webmanifest') {
      res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
      return res.end(JSON.stringify({
        name: 'SSIC File Sharing', short_name: 'SSIC Files', start_url: './?app=1', scope: './', display: 'standalone',
        background_color: '#f3f4f6', theme_color: '#1d4ed8',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      }));
    }
    if (req.method === 'GET' && p === 'icon.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=86400' });
      return res.end(ICON_SVG);
    }
    // Windows setup file: creates a desktop + Start menu icon that opens the app in its own window.
    if (req.method === 'GET' && p === 'install.cmd') {
      const target = q.get('url') || '';
      if (!/^https?:\/\/[\w.\-:\/\[\]]+$/.test(target)) return json(res, 400, { error: 'bad url' });
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="LAN-Share-Setup.cmd"',
      });
      return res.end(installScript(target));
    }

    // The school's local certificate authority (PUBLIC certificate only; its private key lives in ca-private/ and is
    // never served). The setup file downloads this so a PC can trust https://ssicfile.lan.
    if (req.method === 'GET' && p === 'ca.crt') {
      const f = path.join(__dirname, 'ca', 'ssic-file-ca.crt');
      if (!fs.existsSync(f)) return json(res, 404, { error: 'no certificate authority configured' });
      res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="SSIC-File-Sharing-CA.crt"', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(f).pipe(res);
    }

    // SSIC logo for the page header, favicon and the receiver's popups (public)
    if (req.method === 'GET' && p === 'logo.png') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
      return fs.createReadStream(logoFile).pipe(res);
    }

    // Shared page assets (public). no-cache so an update reaches every PC on its next load.
    if (req.method === 'GET' && (p === 'style.css' || p === 'common.js')) {
      res.writeHead(200, { 'Content-Type': p === 'style.css' ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(path.join(__dirname, p)).pipe(res);
    }
    // The ARCHIVES page (same access rule as the main page)
    if (req.method === 'GET' && (p === 'archives' || p === 'archives.html')) {
      if (!authenticate(req)) return deny(res);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(path.join(__dirname, 'archives.html')).pipe(res);
    }

    // The background receiver script (public: the setup file downloads it)
    if (req.method === 'GET' && p === 'agent.ps1') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(agentFile).pipe(res);
    }

    if (req.method === 'GET' && p === '') {
      if (!authenticate(req)) return deny(res);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(uiFile).pipe(res);
    }
    if (!p.startsWith('api/')) return miss();
    if (!authenticate(req)) return deny(res);
    const parts = p.slice(4).split('/');

    // With SMS registration on, a PC that has not signed in yet may only register, list PCs and be recognised by the receiver.
    if (smsLogin && me && db.devices[me] && db.devices[me].named === false && !isServerRequest(req) &&
        !(parts[0] === 'register' || parts[0] === 'agent' || (req.method === 'GET' && parts[0] === 'devices')))
      return json(res, 403, { code: 'sign-in', error: 'Sign in with your SSIC SMS account first.' });

    // POST api/register  {id, name}  -> upsert device, never renames an existing one
    if (req.method === 'POST' && parts[0] === 'register' && !parts[1] && req.smsDevice) {
      return json(res, 200, { device: publicDevice(req.smsDevice), created: false, server: false, maxBytes, signIn: false, sms: true });
    }
    if (req.method === 'POST' && parts[0] === 'register' && !parts[1]) {
      const b = await readJson(req);
      const id = String(b.id || '').replace(/[^\w-]/g, '').slice(0, 40);
      if (!id) return json(res, 400, { error: 'id required' });
      // One name per PC. The PC is identified by its MAC address (read server-side from the ARP table,
      // so every browser on that PC, and localhost vs the LAN address, resolve to the same device).
      // A MAC / this-server key is authoritative. An 'ip:' key is only a fallback (client not on our
      // subnet, or ARP unavailable): it can adopt an unknown browser but never overrides a known one.
      const key = await deviceKey(clientIp(req));
      const strong = !key.startsWith('ip:');
      const byKey = Object.values(db.devices).find((x) => (x.keys || []).includes(key));
      const own = db.devices[id];
      let d, created = false;
      if (strong && byKey) {
        d = byKey;
        if (own && own !== d) mergeInto(d, own); // same PC seen through another browser: fold the duplicate in
      } else if (own) d = own;
      else if (byKey) d = byKey;
      else {
        const wanted = smsLogin && !isServerRequest(req) ? '' : cleanDeviceName(b.name);   // with SMS sign-in nobody picks a name
        let name = wanted || 'PC-' + id.slice(0, 4);
        for (let n = 2; nameTaken(name); n++) name = (wanted || 'PC') + ' ' + n;
        d = db.devices[id] = { id, name, keys: [], named: !!wanted, lastSeen: Date.now() };
        created = true;
      }
      if (!strong) for (const o of Object.values(db.devices)) if (o !== d) o.keys = (o.keys || []).filter((k) => k !== key); // address moved
      addKey(d, key);
      if (key === 'this-server') { const m = (serverMacs()[0] || {}).mac; if (m) addKey(d, 'mac:' + m); } // keep the server PC's MAC address
      d.lastSeen = Date.now();
      emit('devices', deviceList());
      save();
      return json(res, 200, { device: publicDevice(d), created, server: isServerRequest(req), maxBytes, signIn: !!smsLogin });
    }

    // POST api/register/sms?device=ID {identifier, password}  -> names this PC after an SSIC SMS account and gives it the
    // profile that account's role maps to. Passwords are only accepted over https (or on the server PC itself).
    if (req.method === 'POST' && parts[0] === 'register' && parts[1] === 'sms') {
      if (!smsLogin) return json(res, 404, { error: 'not found' });
      const d = db.devices[me];
      if (!d) return json(res, 404, { error: 'unknown device' });
      if (d.named !== false) return json(res, 409, { error: 'This PC is already registered.' });
      const peer = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      const secure = isServerRequest(req) || !!req.socket.encrypted || (opts.trustProxy && (peer === '::1' || peer.startsWith('127.')) && req.headers['x-forwarded-proto'] === 'https');
      if (!secure) return json(res, 400, { error: 'Passwords are only accepted over a secure connection. Open this page as https://ssicfile.lan and try again.' });
      const ip = clientIp(req);
      if (!isServerRequest(req) && !(d.keys || []).includes(await deviceKey(ip))) return json(res, 403, { error: 'This PC is not recognised. Reload the page and try again.' });
      const f = smsFails.get(ip) || { n: 0, t: 0 };
      if (Date.now() - f.t > 6e5) f.n = 0;
      if (f.n >= 5) return json(res, 429, { error: 'Too many failed sign-ins. Try again in 10 minutes.' });
      const b = await readJson(req);
      let acct;
      try { acct = await smsLogin(String(b.identifier || '').trim().slice(0, 120), String(b.password || '').slice(0, 200)); }
      catch (e) {
        if (!e.status || e.status === 401) { f.n++; f.t = Date.now(); smsFails.set(ip, f); }
        logEvent('register-refused', d, { ip, detail: String(e.message || e) });
        return json(res, e.status || 401, { error: String(e.message || 'Sign-in failed') });
      }
      smsFails.delete(ip);
      const base = cleanDeviceName(acct.name) || 'User';
      let name = base;
      for (let n = 2; nameTaken(name, d.id); n++) name = base + ' ' + n;
      d.name = name; d.named = true; d.profile = acct.profile; d.smsUser = acct.userId;
      logEvent('registered', d, { ip, detail: name + ' (' + acct.profile + ') via SMS account; roles: ' + ((acct.roles || []).join(', ') || 'none') });
      save();
      emit('devices', deviceList());
      return json(res, 200, publicDevice(d));
    }

    // ---- activity log: ONLY the server PC may read it (everyone else gets 403, whatever they send) ----
    if (req.method === 'GET' && (parts[0] === 'log' || parts[0] === 'log.csv')) {
      if (!isServerRequest(req)) return json(res, 403, { error: 'The activity log can only be viewed on the server PC.' });
      const entries = readLog({ limit: Math.min(Number(q.get('limit')) || 500, 20000), q: q.get('q') || '', type: q.get('type') || '' });
      if (parts[0] === 'log') return json(res, 200, { server: serverMacs(), entries });
      const cols = ['time', 'event', 'who', 'who_mac', 'who_ip', 'file', 'size_bytes', 'to', 'from', 'detail'];
      const csv = [cols.join(',')].concat(entries.map((r) => [new Date(r.ts).toISOString(), r.type, r.by && r.by.name, r.by && r.by.mac, r.ip, r.file, r.size, (r.to || []).join('; '), r.from, r.detail].map(csvCell).join(','))).join('\r\n');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="lan-share-activity.csv"' });
      return res.end('\ufeff' + csv);
    }

    // ---- background receiver (agent.ps1 on each PC) ----
    // GET api/agent/version -> lets installed receivers update themselves
    if (req.method === 'GET' && parts[0] === 'agent' && parts[1] === 'version') {
      let version = 0;
      try { version = Number((fs.readFileSync(agentFile, 'utf8').match(/\$AgentVersion\s*=\s*(\d+)/) || [])[1]) || 0; } catch {}
      return json(res, 200, { version });
    }
    // POST api/agent/hello {id} -> which device is this PC? Never creates one: the PC must have opened the page once.
    if (req.method === 'POST' && parts[0] === 'agent' && parts[1] === 'hello') {
      const b = await readJson(req);
      const id = String(b.id || '').replace(/[^\w-]/g, '').slice(0, 40);
      const key = await deviceKey(clientIp(req));
      const byKey = Object.values(db.devices).find((x) => (x.keys || []).includes(key));
      const d = (!key.startsWith('ip:') && byKey) || db.devices[id] || byKey;
      if (!d) return json(res, 404, { error: 'This PC has not opened LAN Share yet' });
      addKey(d, key);
      save();
      touchAgent(d.id);
      return json(res, 200, { device: publicDevice(d) });
    }
    // GET api/pending?device=ID -> files waiting for this PC to accept or decline (also the receiver's heartbeat)
    if (req.method === 'GET' && parts[0] === 'pending') {
      if (!db.devices[me]) return json(res, 404, { error: 'unknown device' });
      touchAgent(me);
      const waiting = db.transfers
        .filter((t) => t.from !== me && isRecipient(t, me) && !t.downloadedBy.includes(me) && (!(t.responses && t.responses[me]) || t.responses[me] === 'accepted') && Date.now() - t.time < (retentionDays ? retentionDays * 864e5 : Infinity))
        .sort((a, b) => a.time - b.time)
        .map((t) => ({ id: t.id, name: t.name, size: t.size, time: t.time, status: t.status || 'done', received: t.received || 0, response: (t.responses || {})[me] || null, fromName: (db.devices[t.from] || { name: 'Someone' }).name }));
      return json(res, 200, waiting);
    }

    // POST api/archive/move | copy  {ids, to, names?}  -> manager PCs only. Never replaces a file: a name that is taken
    // is reported back as "exists" so the page can ask for another one (names: {id: newName}).
    if (req.method === 'POST' && parts[0] === 'archive' && (parts[1] === 'move' || parts[1] === 'copy')) {
      const ac = await actorOf(req, me);
      if (!ac.manager) return json(res, 403, { error: 'Only the server PC or a manager PC can move or copy files in ARCHIVES.' });
      const b = await readJson(req);
      const dest = resolveArchiveFolder(b.to);
      if (!dest) return json(res, 404, { error: 'That folder does not exist.' });
      if (!profileOk(ac.profile, dest.rel)) return json(res, 403, { error: 'Your profile does not give you access to that folder.' });
      const names = b.names && typeof b.names === 'object' ? b.names : {};
      const move = parts[1] === 'move', results = [];
      for (const id of (Array.isArray(b.ids) ? b.ids : []).slice(0, 200)) {
        const t = db.transfers.find((x) => x.id === id && x.archive && x.status !== 'sending');
        if (!t || !canSeeItem(ac.profile, t)) { results.push({ id, status: 'missing' }); continue; }
        const name = safeName(names[id] || t.name);
        if (!name || name === '.' || name === '..') { results.push({ id, status: 'error', error: 'bad file name' }); continue; }
        const src = pathOf(t), fromRel = archivePathOf(t), toRel = (dest.rel ? dest.rel + '/' : '') + name;
        if (move && toRel === fromRel) { results.push({ id, status: 'same' }); continue; }
        if (archiveNameTaken(name, dest.rel)) { results.push({ id, status: 'exists' }); continue; }
        const dst = path.join(dest.abs, name);
        try {
          if (move) {
            fs.linkSync(src, dst);          // link fails if the name appeared meanwhile, so nothing is ever replaced
            fs.unlinkSync(src);
            t.archivePath = toRel; delete t.archiveName; t.name = name;
          } else {
            const part = path.join(dest.abs, crypto.randomBytes(8).toString('hex') + '.part');
            try { await fs.promises.copyFile(src, part, fs.constants.COPYFILE_EXCL); fs.linkSync(part, dst); }
            finally { fs.unlink(part, () => {}); }
            const st = fs.statSync(dst, { bigint: true });   // the record is added in the same tick the file appears
            db.transfers.push({ id: crypto.randomBytes(8).toString('hex'), name, size: Number(st.size), from: t.from, to: [], archive: true, archivePath: toRel, fileKey: String(st.ino), time: Date.now(), downloadedBy: [], status: 'done', received: Number(st.size) });
          }
          logEvent(move ? 'archive-moved' : 'archive-copied', db.devices[me] || null, { ip: clientIp(req), file: name, archive: true, detail: fromRel + ' -> ' + toRel });
          results.push({ id, status: 'ok' });
        } catch (e) {
          results.push({ id, status: e.code === 'EEXIST' ? 'exists' : 'error', error: e.message });
        }
      }
      save();
      emit('refresh', {});
      return json(res, 200, { results });
    }

    // POST api/archive/folder {parent, name}  -> create a folder in ARCHIVES (server PC or a manager). Never replaces anything.
    if (req.method === 'POST' && parts[0] === 'archive' && parts[1] === 'folder') {
      const ac = await actorOf(req, me);
      if (!ac.manager) return json(res, 403, { error: 'Only the server PC or a manager can create folders in ARCHIVES.' });
      const b = await readJson(req);
      const parent = resolveArchiveFolder(b.parent);
      if (!parent) return json(res, 404, { error: 'That folder does not exist.' });
      if (!profileOk(ac.profile, parent.rel)) return json(res, 403, { error: 'Your profile does not give you access to that folder.' });
      const nm = safeName(b.name).trim();
      if (!nm || nm === '.' || nm === '..' || nm.startsWith('.') || nm.startsWith('$')) return json(res, 400, { error: 'Choose a valid folder name.' });
      const target = path.join(parent.abs, nm);
      if (fs.existsSync(target)) return json(res, 409, { error: 'A file or folder with that name already exists here.' });
      fs.mkdirSync(target);
      logEvent('archive-folder-created', db.devices[me] || null, { ip: clientIp(req), file: nm, archive: true, detail: (parent.rel ? parent.rel + '/' : '') + nm });
      syncArchive(true);
      emit('refresh', {});
      return json(res, 200, { ok: true, path: (parent.rel ? parent.rel + '/' : '') + nm });
    }

    // GET api/archive/exists?name=&folder=  -> is this file name already taken in that ARCHIVES folder?
    if (req.method === 'GET' && parts[0] === 'archive' && parts[1] === 'exists') {
      const n = safeName(q.get('name'));
      if (!n || n === '.' || n === '..') return json(res, 400, { error: 'bad file name' });
      const fo = resolveArchiveFolder(q.get('folder'));
      if (!fo) return json(res, 404, { error: 'That folder does not exist.' });
      if (!profileOk((await actorOf(req, me)).profile, fo.rel)) return json(res, 403, { error: 'Your profile does not give you access to that folder.' });
      return json(res, 200, { exists: archiveNameTaken(n, fo.rel), name: n });
    }
    // GET api/archive/folders  -> every folder in ARCHIVES (read-only: folders can only be made on the server PC)
    if (req.method === 'GET' && parts[0] === 'archive' && parts[1] === 'folders') {
      syncArchive();
      const ac = await actorOf(req, me);
      return json(res, 200, { folders: archiveFolders.filter((f) => profileOk(ac.profile, f.path)), profile: ac.profile, manager: ac.manager, server: ac.server, profiles: PROFILES });
    }

    // POST api/admin/check  -> verifies X-Admin-Password (same lockout as renames), changes nothing
    if (req.method === 'POST' && parts[0] === 'admin' && parts[1] === 'check') {
      if (!adminGate(req, res)) return;
      return json(res, 200, { ok: true });
    }

    // PUT api/devices/:id/profile {profile, canManage?}  -> only the server PC or a manager PC. Only the server PC can
    // make a PC a manager, or change a manager's profile.
    if (req.method === 'PUT' && parts[0] === 'devices' && parts[2] === 'profile') {
      const ac = await actorOf(req, me);
      if (!ac.manager) return json(res, 403, { error: 'Only the server PC or a manager PC can change profiles.' });
      const d = db.devices[parts[1]];
      if (!d) return json(res, 404, { error: 'unknown device' });
      const b = await readJson(req);
      const profile = b.profile === undefined ? (d.profile || 'default') : String(b.profile);
      if (!PROFILES.includes(profile)) return json(res, 400, { error: 'unknown profile' });
      if (!ac.server && (d.canManage || (d.keys || []).includes('this-server'))) return json(res, 403, { error: 'Only the server PC can change a manager PC.' });
      if (b.canManage !== undefined && !ac.server) return json(res, 403, { error: 'Only the server PC can make a PC a manager.' });
      const before = (d.profile || 'default') + (d.canManage ? ' + manager' : '');
      d.profile = profile;
      d.profileLocked = true;   // set by hand: no longer follows the SMS role automatically
      if (b.canManage !== undefined) d.canManage = !!b.canManage;
      logEvent('profile-set', db.devices[me] || null, { ip: clientIp(req), detail: d.name + ': ' + before + ' -> ' + profile + (d.canManage ? ' + manager' : '') });
      save();
      emit('devices', deviceList());
      emit('refresh', {});
      return json(res, 200, publicDevice(d));
    }
    if (req.method === 'GET' && parts[0] === 'devices') return json(res, 200, deviceList());

    // PUT api/devices/:id {name}  -> rename any device (admin-style naming from any PC)
    if (req.method === 'PUT' && parts[0] === 'devices' && parts[1]) {
      const d = db.devices[parts[1]];
      if (!d) return json(res, 404, { error: 'unknown device' });
      // A PC picks its own name once, freely. After that, changing it needs the admin password.
      const firstNaming = d.named === false && me === d.id;
      if (firstNaming && smsLogin && !isServerRequest(req)) return json(res, 403, { error: 'Sign in with your SSIC SMS account to register this PC.' });
      if (!firstNaming && !adminGate(req, res)) return;
      const name = cleanDeviceName((await readJson(req)).name);
      if (!name) return json(res, 400, { error: 'name required' });
      if (nameTaken(name, d.id)) return json(res, 409, { error: 'name already in use' });
      const oldName = d.name;
      d.name = name;
      d.named = true;
      save();
      if (!firstNaming || oldName !== name) logEvent(firstNaming ? 'named' : 'renamed', db.devices[me] || d, { ip: clientIp(req), detail: oldName + ' -> ' + name });
      emit('devices', deviceList());
      return json(res, 200, publicDevice(d));
    }

    if (req.method === 'DELETE' && parts[0] === 'devices' && parts[1]) {
      if (!db.devices[parts[1]]) return json(res, 404, { error: 'unknown device' });
      if (!adminGate(req, res)) return;
      logEvent('device-removed', db.devices[me] || null, { ip: clientIp(req), detail: db.devices[parts[1]].name });
      const gone = parts[1];
      delete db.devices[gone];
      // files that were waiting only for the removed PC have nobody left to collect them
      for (const t of [...db.transfers]) {
        if (t.archive || t.status === 'sending') continue;
        if (Array.isArray(t.to)) t.to = t.to.filter((x) => x !== gone);
        const left = t.to === 'all' ? Object.keys(db.devices).filter((x) => x !== t.from) : (Array.isArray(t.to) ? t.to : t.to ? [t.to] : []).filter((x) => db.devices[x]);
        if (!left.length) { logEvent('auto-deleted', null, { file: t.name, size: t.size, from: devName(t.from), detail: 'its recipient was removed' }); removeTransfer(t); }
      }
      save();
      emit('devices', deviceList());
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && parts[0] === 'transfers') {
      syncArchive();
      const ac = await actorOf(req, me);
      return json(res, 200, db.transfers.filter((t) => visibleTo(t, me) && (!t.archive || canSeeItem(ac.profile, t))).sort((a, b) => b.time - a.time));
    }

    // GET api/events?device=ID  -> SSE stream
    if (req.method === 'GET' && parts[0] === 'events') {
      if (!db.devices[me]) return json(res, 404, { error: 'unknown device' });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      if (!streams.has(me)) streams.set(me, new Set());
      streams.get(me).add(res);
      emit('devices', deviceList());
      const beat = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => {
        clearInterval(beat);
        const set = streams.get(me);
        set.delete(res);
        if (!set.size) streams.delete(me);
        if (db.devices[me]) { db.devices[me].lastSeen = Date.now(); save(); }
        emit('devices', deviceList());
      });
      return;
    }

    // PUT api/send?device=FROM&to=ID,ID,...&name=FILE   (raw body, streamed to disk)
    // 'to' is a comma-separated list of device ids; there is deliberately no default recipient.
    if (req.method === 'PUT' && parts[0] === 'send') {
      const name = safeName(q.get('name'));
      if (!db.devices[me]) return json(res, 403, { error: 'unknown sender' });
      const wanted = [...new Set(String(q.get('to') || '').split(',').filter(Boolean))];
      const archive = wanted.includes('archives');
      const to = wanted.filter((x) => x !== 'archives');
      if (!to.length && !archive) return json(res, 400, { error: 'choose at least one recipient' });
      if (to.some((x) => x === me || !db.devices[x])) return json(res, 400, { error: 'unknown recipient' });
      if (!name || name === '.' || name === '..') return json(res, 400, { error: 'bad file name' });
      // The destination folder must already exist (only the server PC creates folders); never a path outside the archive.
      const fo = archive ? resolveArchiveFolder(q.get('folder')) : null;
      if (archive && !fo) return json(res, 404, { code: 'no-folder', error: 'That folder does not exist. Only the server PC can create folders.' });
      const where = archive ? 'ARCHIVES' + (fo.rel ? '/' + fo.rel : '') : '';
      if (archive && !profileOk((await actorOf(req, me)).profile, fo.rel)) return json(res, 403, { error: 'Your profile does not give you access to that folder.' });
      if (archive && archiveNameTaken(name, fo.rel)) logEvent('send-refused', db.devices[me], { ip: clientIp(req), file: name, to: [where], archive: true, folder: fo.rel, detail: 'name already exists in ' + where });
      if (archive && archiveNameTaken(name, fo.rel)) return json(res, 409, { code: 'exists', error: '"' + name + '" already exists in ' + where + '. Files there are never replaced, so choose a different name.' });
      const declared = Number(req.headers['content-length']) || 0;
      if (maxBytes && declared > maxBytes) return json(res, 413, { error: tooBigMsg() });

      const id = crypto.randomBytes(8).toString('hex');
      const tmp = path.join(archive ? fo.abs : filesDir, id + '.part'); // same folder as the final file, so the rename is atomic
      const out = fs.createWriteStream(tmp);
      // The record exists from the first byte so recipients are notified immediately and can watch progress.
      // Until status becomes 'done' it cannot be downloaded; if the upload dies it is removed again.
      const t = { id, name, size: declared, from: me, to, archive, folder: archive ? fo.rel : undefined, time: Date.now(), downloadedBy: [], status: 'sending', received: 0 };
      db.transfers.push(t);
      save();
      const audience = [...to, me];
      emit('transfer', t, audience);
      let failed = false, size = 0, lastEmit = 0;
      const ip = clientIp(req);
      const destNames = () => [...to.map(devName), ...(archive ? [where] : [])];
      const fail = (e) => {
        if (failed) return;
        failed = true;
        logEvent(e && e.status === 409 ? 'send-refused' : 'send-cancelled', db.devices[me], { ip, file: name, size, declared, to: destNames(), archive, detail: String((e && e.message) || e) });
        out.destroy();
        fs.unlink(tmp, () => {});
        db.transfers = db.transfers.filter((x) => x.id !== id);
        save();
        emit('cancelled', { id, name, fromName: db.devices[me].name }, to);
        emit('refresh', {}, archive ? undefined : audience);
        if (!res.headersSent) json(res, (e && e.status) || 500, { error: String((e && e.message) || e) });
      };
      req.on('data', (c) => {
        size += c.length;
        t.received = size;
        if (maxBytes && size > maxBytes) { fail(Object.assign(new Error(tooBigMsg()), { status: 413 })); req.destroy(); return; }
        if (Date.now() - lastEmit > 400) { lastEmit = Date.now(); emit('progress', { id, received: size, size: t.size }, audience); }
      });
      req.on('error', fail);
      req.on('aborted', () => fail(new Error('aborted')));
      req.on('close', () => { if (!req.complete) fail(new Error('cancelled')); }); // sender hit Cancel / lost connection
      out.on('error', fail);
      out.on('finish', () => {
        if (failed) return;
        const complete = (finalPath) => {
          if (archive) {
            t.archivePath = (fo.rel ? fo.rel + '/' : '') + name; delete t.folder;
            try { t.fileKey = String(fs.statSync(finalPath, { bigint: true }).ino); } catch {}
          }
          t.size = size; t.received = size; t.status = 'done';
          save();
          logEvent('sent', db.devices[me], { ip, file: name, size, to: destNames(), archive, folder: archive ? fo.rel : undefined, seconds: Math.round((Date.now() - t.time) / 100) / 10 });
          emit('progress', { id, received: size, size }, audience);
          emit('refresh', {}, archive ? undefined : audience);
          if (archive) emit('archived', { id, name, byName: db.devices[me].name, folder: fo.rel }, Object.values(db.devices).filter((d) => profileOk(d.profile || 'default', fo.rel)).map((d) => d.id));
          json(res, 200, t);
        };
        if (archive) {
          // link() fails if the name exists, unlike rename() which would silently replace the older file
          const finalPath = path.join(fo.abs, name);
          fs.link(tmp, finalPath, (err) => {
            if (err) return fail(err.code === 'EEXIST' ? Object.assign(new Error('"' + name + '" was just added to ' + where + ' by someone else. Choose a different name.'), { status: 409 }) : err);
            fs.unlink(tmp, () => {});
            complete(finalPath);
          });
        } else {
          const stored = id + ' - ' + name;   // readable in Explorer, unique by id
          const finalPath = path.join(filesDir, stored);
          fs.rename(tmp, finalPath, (err) => { if (!err) t.file = stored; err ? fail(err) : complete(finalPath); });
        }
      });
      return req.pipe(out);
    }

    const t = parts[1] && db.transfers.find((x) => x.id === parts[1]);

    // POST api/respond/:id?device=ID {accept}  -> recorded so the sender can see "declined"
    if (req.method === 'POST' && parts[0] === 'respond') {
      if (!t || t.from === me || !visibleTo(t, me)) return json(res, 404, { error: 'not found' });
      const b = await readJson(req);
      t.responses = t.responses || {};
      t.responses[me] = b.accept ? 'accepted' : 'declined';
      logEvent(b.accept ? 'accepted' : 'declined', db.devices[me], { ip: clientIp(req), file: t.name, from: devName(t.from) });
      save();
      emit('refresh', {});
      return json(res, 200, { ok: true });
    }

    // GET api/download/:id?device=ID
    if (req.method === 'GET' && parts[0] === 'download') {
      if (!t || !visibleTo(t, me)) return json(res, 404, { error: 'not found' });
      if (t.status === 'sending') return json(res, 409, { error: 'still sending' });
      if (t.archive && !canSeeItem((await actorOf(req, me)).profile, t)) return json(res, 404, { error: 'not found' });
      const file = pathOf(t);
      return fs.stat(file, (err, s) => {
        if (err) return json(res, 404, { error: 'file missing' });
        if (t.from !== me && !t.downloadedBy.includes(me)) {
          t.downloadedBy.push(me);
          save();
          emit('refresh', {});
        }
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': s.size,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(t.name)}`,
        });
        const dlIp = clientIp(req);
        // Tell the sender once this recipient has the WHOLE file (not merely started downloading it).
        res.on('finish', () => {
          logEvent('downloaded', db.devices[me] || null, { ip: dlIp, file: t.name, size: s.size, from: devName(t.from), archive: !!t.archive });
          if (t.from === me || !isRecipient(t, me) || (t.completedBy || []).includes(me)) return;
          t.completedBy = [...(t.completedBy || []), me];
          emit('downloaded', { id: t.id, name: t.name, byName: (db.devices[me] || { name: 'Someone' }).name }, [t.from]);
          settleTransfer(t);   // last recipient done -> the file leaves the transfer folder
          save();
          emit('refresh', {});
        });
        fs.createReadStream(file).pipe(res);
      });
    }

    // DELETE api/transfers/:id?device=ID  (sender or a recipient may delete; never anything in ARCHIVES)
    if (req.method === 'DELETE' && parts[0] === 'transfers') {
      if (!t || !visibleTo(t, me)) return json(res, 404, { error: 'not found' });
      if (t.status === 'sending') return json(res, 409, { error: 'still sending' }); // the sender cancels from their upload row
      // ARCHIVES files can never be deleted from the app: not by the sender, not by anyone, not even with the admin
      // password. They can only be deleted on the server PC itself (in the archive folder).
      if (t.archive) {
        logEvent('delete-refused', db.devices[me] || null, { ip: clientIp(req), file: t.name, archive: true, detail: 'ARCHIVES files can only be deleted on the server PC' });
        return json(res, 403, { error: 'Files in ARCHIVES can only be deleted on the server PC.' });
      }
      logEvent('deleted', db.devices[me] || null, { ip: clientIp(req), file: t.name, size: t.size, from: devName(t.from) });
      removeTransfer(t);
      save();
      emit('refresh', {});
      return json(res, 200, { ok: true });
    }

    miss();
  };
  lanShare._test = { macOf, deviceKey, onLocalSubnet }; // exposed for tests only
  return lanShare;
}

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="20" fill="#2563eb"/>' +
  '<path d="M24 34h40M54 22l12 12-12 12M72 62H32M42 50L30 62l12 12" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// \`target\` is validated by the caller to contain only URL-safe characters.
// The .cmd is a polyglot: cmd runs the first lines, which hand the part after #PS-BEGIN to PowerShell
// (so the PowerShell can use any quoting without fighting cmd.exe), and exits before reaching it.
function installScript(target) {
  const ps = String.raw`$t = '@@TARGET@@'
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# 0. Secure address: trust the school's local certificate authority so https://ssicfile.lan opens with no warning.
#    Windows asks you to confirm (click Yes). Only this user's trust store is changed. If anything fails we simply
#    keep using the normal address.
if (([Uri]$t).Host -eq 'ssicfile.lan') {
  try {
    $caFile = Join-Path $env:TEMP 'SSIC-File-Sharing-CA.crt'
    Invoke-WebRequest -UseBasicParsing -Uri ($t + 'ca.crt') -OutFile $caFile
    Write-Host 'Windows will ask you to confirm the SSIC File Sharing certificate. Click Yes.'
    certutil -user -addstore Root $caFile | Out-Null
    Remove-Item $caFile -Force -ErrorAction SilentlyContinue
    $secure = 'https://ssicfile.lan/'
    $null = Invoke-WebRequest -UseBasicParsing -Uri ($secure + 'api/agent/version') -TimeoutSec 10   # throws unless the certificate is trusted
    $t = $secure
    Write-Host 'Secure address enabled: https://ssicfile.lan'
  } catch { Write-Host 'Secure address was not enabled on this PC; continuing with the normal address.' }
}

# 1. Desktop + Start menu icon that opens the app in its own window
$a = $env:ProgramFiles; $b = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
$c = @(($b + '\Microsoft\Edge\Application\msedge.exe'), ($a + '\Microsoft\Edge\Application\msedge.exe'), ($a + '\Google\Chrome\Application\chrome.exe'), ($b + '\Google\Chrome\Application\chrome.exe'))
$e = $c | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $e) { Write-Host 'Edge or Chrome was not found on this PC.'; exit 1 }
$w = New-Object -ComObject WScript.Shell
# SSIC logo as the icon: download it and convert it to a .ico (System.Drawing is built into Windows)
$ld = Join-Path $env:LOCALAPPDATA 'LanShare'
New-Item -ItemType Directory -Force -Path $ld | Out-Null
$ico = Join-Path $ld 'logo.ico'
try {
  Invoke-WebRequest -UseBasicParsing -Uri ($t + 'logo.png') -OutFile (Join-Path $ld 'logo.png')
  Add-Type -AssemblyName System.Drawing
  $src = [System.Drawing.Image]::FromFile((Join-Path $ld 'logo.png'))
  $bmp = New-Object System.Drawing.Bitmap(64, 64)
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $iw = [int](64 * $src.Width / $src.Height); $g.DrawImage($src, [int]((64 - $iw) / 2), 0, $iw, 64); $g.Dispose(); $src.Dispose()
  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon()); $fs = [IO.File]::Create($ico); $icon.Save($fs); $fs.Close(); $bmp.Dispose()
} catch { $ico = $null }
foreach ($d in 'Desktop', 'Programs') {
  $s = $w.CreateShortcut([Environment]::GetFolderPath($d) + '\LAN Share.lnk')
  $s.TargetPath = $e; $s.Arguments = '--app=' + $t + '?app=1 --window-size=900,800'; $s.IconLocation = $(if ($ico -and (Test-Path $ico)) { $ico } else { $e + ',0' }); $s.Save()
}

# 2. Background receiver: lets this PC get "X wants to send you a file" prompts even when the app is closed
$dir = Join-Path $env:LOCALAPPDATA 'LanShare'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*LanShare*agent.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Invoke-WebRequest -UseBasicParsing -Uri ($t + 'agent.ps1') -OutFile (Join-Path $dir 'agent.ps1')
[IO.File]::WriteAllText((Join-Path $dir 'config.json'), ('{"server":"' + $t + '"}'))
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arg = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File "' + (Join-Path $dir 'agent.ps1') + '"'
$s = $w.CreateShortcut([Environment]::GetFolderPath('Startup') + '\LAN Share Receiver.lnk')   # starts at every login
$s.TargetPath = $ps; $s.Arguments = $arg; $s.WindowStyle = 7; $s.Save()
Start-Process -FilePath $ps -ArgumentList $arg -WindowStyle Hidden
Start-Process ([Environment]::GetFolderPath('Desktop') + '\LAN Share.lnk')
`.replace('@@TARGET@@', target);
  return [
    '@echo off',
    'echo Installing LAN Share on this PC...',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText(\'%~f0\'); iex $s.Substring($s.IndexOf(\'#PS-\'+\'BEGIN\'))"',
    'if errorlevel 1 (echo Setup failed. & pause & exit /b 1)',
    'echo Done. LAN Share is installed and will now start with Windows.',
    'timeout /t 4 >nul',
    'exit /b 0',
    '#PS-BEGIN',
    ps,
  ].join('\r\n');
}

function deny(res) {
  res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="LAN Share"', 'Content-Type': 'text/plain' });
  res.end('Authentication required');
}

module.exports = { createLanShare };
