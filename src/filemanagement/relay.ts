/**
 * File relay: lets the ONLINE SMS show the school server's file app without a tunnel and without storing anything online.
 *
 *   browser --https--> online SMS (this file, "server" side) --WebSocket--> school SMS (this file, "client" side)
 *                                                                              --http--> the file app on the school server
 *
 * The school server's backend opens ONE outbound WebSocket to the online backend (the same direction the sync already
 * uses, authenticated with the same SYNC_API_KEY), so nothing has to be opened on the school network. Every file request
 * the online SMS receives is streamed over that socket to the file app and the answer is streamed back. Nothing is
 * written to disk online: bytes only pass through memory. If the school server is not connected, File Management online
 * says so.
 *
 * Frames are binary: [type:1][request id:4][payload]. Many requests share the one socket.
 *
 * Env (online server):  FILE_RELAY_SERVER=on  (and FILE_APP_MODE=relay for the File Management route)
 * Env (school server):  FILE_RELAY_CLIENT=on, FILE_RELAY_TARGET (default http://127.0.0.1:8081, the file app's
 *                       signed-sessions-only listener), REMOTE_SYNC_URL + SYNC_API_KEY (already set for the sync),
 *                       or FILE_RELAY_URL to override the address.
 */
import http from 'http';
import crypto from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { WebSocketServer, WebSocket } = require('ws');

const PATH = '/api/v1/file-relay/connect';
const REQ_HEAD = 1, REQ_BODY = 2, REQ_END = 3, RES_HEAD = 4, RES_BODY = 5, RES_END = 6, ABORT = 7;
const CHUNK = 256 * 1024;
const HIGH_WATER = 4 * 1024 * 1024;
const HEAD_TIMEOUT_MS = 30 * 1000;

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

const frame = (type: number, id: number, payload?: Buffer | string): Buffer => {
    const head = Buffer.alloc(5);
    head[0] = type;
    head.writeUInt32BE(id >>> 0, 1);
    return payload === undefined ? head : Buffer.concat([head, Buffer.isBuffer(payload) ? payload : Buffer.from(payload)]);
};

// Sends big bodies in pieces and waits while the socket's send buffer is full, so a slow side cannot make memory grow.
function pump(ws: any, source: any, type: number, id: number, onEnd: () => void) {
    let paused = false;
    const resumeLater = () => {
        if (!paused) return;
        const t = setInterval(() => {
            if (ws.readyState !== WebSocket.OPEN) { clearInterval(t); return; }
            if (ws.bufferedAmount < HIGH_WATER / 2) { clearInterval(t); paused = false; source.resume(); }
        }, 15);
    };
    source.on('data', (buf: Buffer) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        for (let o = 0; o < buf.length; o += CHUNK) ws.send(frame(type, id, buf.subarray(o, o + CHUNK)));
        if (ws.bufferedAmount > HIGH_WATER && !paused) { paused = true; source.pause(); resumeLater(); }
    });
    source.on('end', onEnd);
}

// ============================ online server side ============================

let peer: any = null;
let nextId = 1;
const pending = new Map<number, { res: any; started: boolean; timer: NodeJS.Timeout }>();

export const relayConnected = (): boolean => !!peer && peer.readyState === WebSocket.OPEN;

const keyOk = (header: string | undefined): boolean => {
    const expected = process.env.SYNC_API_KEY || '';
    const m = String(header || '').match(/^Bearer\s+(.+)$/i);
    if (!expected || !m) return false;
    const a = Buffer.from(m[1]), b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

function failPending(id: number, status: number, message: string) {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(id);
    if (!p.started && !p.res.headersSent) {
        p.res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        p.res.end(`<p style="font-family:sans-serif">${message}</p>`);
    } else {
        p.res.destroy();
    }
}

/** Online server: accept the school server's socket on /api/v1/file-relay/connect (SYNC_API_KEY required). */
export function attachRelayServer(httpServer: http.Server) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });

    httpServer.on('upgrade', (req: http.IncomingMessage, socket: any, head: Buffer) => {
        let pathname = '';
        try { pathname = new URL(req.url || '', 'http://x').pathname; } catch { /* ignore */ }
        if (pathname !== PATH) return;   // Socket.IO and others handle their own paths
        if (!keyOk(req.headers['authorization'] as string | undefined)) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws: any) => onPeer(ws));
    });

    function onPeer(ws: any) {
        if (peer && peer.readyState === WebSocket.OPEN) { try { peer.close(4000, 'replaced'); } catch { /* ignore */ } }
        peer = ws;
        console.log('[FILE-RELAY] school server connected');
        let alive = true;
        ws.on('pong', () => { alive = true; });
        const beat = setInterval(() => {
            if (!alive) { ws.terminate(); return; }
            alive = false;
            try { ws.ping(); } catch { /* ignore */ }
        }, 20000);

        ws.on('message', (data: Buffer) => {
            if (!Buffer.isBuffer(data) || data.length < 5) return;
            const type = data[0], id = data.readUInt32BE(1), payload = data.subarray(5);
            const p = pending.get(id);
            if (!p) return;
            if (type === RES_HEAD) {
                clearTimeout(p.timer);
                try {
                    const h = JSON.parse(payload.toString());
                    const headers: http.OutgoingHttpHeaders = {};
                    for (const [k, v] of Object.entries(h.headers || {})) if (!HOP.has(k.toLowerCase()) && v !== undefined) headers[k] = v as any;
                    headers['x-accel-buffering'] = 'no';   // nginx: pass the answer on as it arrives (downloads, live updates)
                    p.res.writeHead(Number(h.status) || 502, headers);
                    p.started = true;
                } catch { failPending(id, 502, 'File Management returned an unreadable answer.'); }
            } else if (type === RES_BODY) {
                if (p.started) p.res.write(payload);
            } else if (type === RES_END) {
                clearTimeout(p.timer);
                pending.delete(id);
                p.res.end();
            } else if (type === ABORT) {
                failPending(id, 502, 'File Management is not available right now. Try again in a moment.');
            }
        });

        ws.on('close', () => {
            clearInterval(beat);
            if (peer === ws) {
                peer = null;
                console.log('[FILE-RELAY] school server disconnected');
                for (const id of [...pending.keys()]) failPending(id, 502, 'The school server went offline. Try again in a moment.');
            }
        });
        ws.on('error', () => { /* close follows */ });
    }
}

/** Online server: send one browser request to the school server's file app and stream the answer back. */
export function relayForward(req: any, res: any, opts: { path: string; headers: http.OutgoingHttpHeaders }) {
    if (!relayConnected()) {
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p style="font-family:sans-serif">File Management is not available right now: the school server is not connected. Try again later.</p>');
        return;
    }
    const ws = peer;
    const id = nextId++ >>> 0 || nextId++;
    const timer = setTimeout(() => failPending(id, 504, 'File Management took too long to answer.'), HEAD_TIMEOUT_MS);
    pending.set(id, { res, started: false, timer });
    ws.send(frame(REQ_HEAD, id, JSON.stringify({ method: req.method, path: opts.path, headers: opts.headers })));
    pump(ws, req, REQ_BODY, id, () => { if (ws.readyState === WebSocket.OPEN) ws.send(frame(REQ_END, id)); });
    req.on('aborted', () => { if (pending.has(id) && ws.readyState === WebSocket.OPEN) ws.send(frame(ABORT, id)); pending.delete(id); });
    res.on('close', () => {
        const p = pending.get(id);
        if (p) { clearTimeout(p.timer); pending.delete(id); if (ws.readyState === WebSocket.OPEN) ws.send(frame(ABORT, id)); }
    });
}

// ============================ school server side ============================

/** School server: keep one outbound socket to the online backend and answer its file requests from the local file app. */
export function startRelayClient() {
    if (process.env.FILE_RELAY_CLIENT !== 'on') return;
    const key = process.env.SYNC_API_KEY || '';
    const target = new URL(process.env.FILE_RELAY_TARGET || 'http://127.0.0.1:8081');
    let url = process.env.FILE_RELAY_URL || '';
    if (!url && process.env.REMOTE_SYNC_URL) {
        const u = new URL(process.env.REMOTE_SYNC_URL);
        url = `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}${PATH}`;
    }
    if (!key || !url) { console.warn('[FILE-RELAY] client not started: SYNC_API_KEY and REMOTE_SYNC_URL (or FILE_RELAY_URL) are needed'); return; }

    let delay = 2000;
    const connect = () => {
        const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 10000, maxPayload: 8 * 1024 * 1024 });
        const local = new Map<number, http.ClientRequest>();
        let lastPing = Date.now();
        let watchdog: NodeJS.Timeout | null = null;

        ws.on('open', () => {
            delay = 2000;
            lastPing = Date.now();
            console.log('[FILE-RELAY] connected to the online server');
            watchdog = setInterval(() => { if (Date.now() - lastPing > 70000) ws.terminate(); }, 10000);
        });
        ws.on('ping', () => { lastPing = Date.now(); });

        ws.on('message', (data: Buffer) => {
            if (!Buffer.isBuffer(data) || data.length < 5) return;
            const type = data[0], id = data.readUInt32BE(1), payload = data.subarray(5);
            if (type === REQ_HEAD) {
                let h: any;
                try { h = JSON.parse(payload.toString()); } catch { return; }
                const headers: http.OutgoingHttpHeaders = {};
                for (const [k, v] of Object.entries(h.headers || {})) if (!HOP.has(k.toLowerCase()) && k.toLowerCase() !== 'host' && v !== undefined) headers[k] = v as any;
                headers.host = target.host;
                const lr = http.request({ hostname: target.hostname, port: target.port || 80, path: String(h.path || '/'), method: String(h.method || 'GET'), headers }, (r) => {
                    const out: Record<string, any> = {};
                    for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k) && v !== undefined) out[k] = v;
                    if (ws.readyState !== WebSocket.OPEN) { r.destroy(); return; }
                    ws.send(frame(RES_HEAD, id, JSON.stringify({ status: r.statusCode || 502, headers: out })));
                    pump(ws, r, RES_BODY, id, () => { local.delete(id); if (ws.readyState === WebSocket.OPEN) ws.send(frame(RES_END, id)); });
                    r.on('close', () => local.delete(id));
                });
                lr.on('error', () => {
                    local.delete(id);
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(frame(RES_HEAD, id, JSON.stringify({ status: 502, headers: { 'content-type': 'text/html; charset=utf-8' } })));
                        ws.send(frame(RES_BODY, id, '<p style="font-family:sans-serif">The file app on the school server did not answer.</p>'));
                        ws.send(frame(RES_END, id));
                    }
                });
                local.set(id, lr);
            } else if (type === REQ_BODY) {
                local.get(id)?.write(payload);
            } else if (type === REQ_END) {
                local.get(id)?.end();
            } else if (type === ABORT) {
                local.get(id)?.destroy();
                local.delete(id);
            }
        });

        ws.on('close', () => {
            if (watchdog) clearInterval(watchdog);
            for (const lr of local.values()) lr.destroy();
            local.clear();
            console.log(`[FILE-RELAY] disconnected; retrying in ${Math.round(delay / 1000)}s`);
            setTimeout(connect, delay);
            delay = Math.min(delay * 2, 30000);
        });
        ws.on('error', () => { /* close follows */ });
    };
    connect();
}
