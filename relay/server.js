const http = require('http');
const { WebSocketServer } = require('ws');
const { randomUUID } = require('crypto');

// sessionId -> { id, cwd, startedAt, status, ownerWs, viewers: Set<ws> }
function publicSession(s) {
  return {
    id: s.id,
    cwd: s.cwd,
    label: s.label,
    startedAt: s.startedAt,
    status: s.status,
    viewerCount: s.viewers.size,
  };
}

function broadcastToViewers(session, payload) {
  const msg = JSON.stringify(payload);
  for (const viewer of session.viewers) {
    if (viewer.readyState === viewer.OPEN) viewer.send(msg);
  }
}

/**
 * Avvia il relay (HTTP + WS) su una porta. Non possiede nessun pty: tiene solo
 * il registry delle sessioni in memoria e fa da smistatore tra owner e viewer.
 * Ritorna { server, sessions, stop } così può girare sia standalone (CLI) sia
 * in-process dentro un altro host (es. il main process di Electron).
 */
function startRelay(port) {
  const sessions = new Map();

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/sessions') {
      const list = [...sessions.values()].map(publicSession);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(list));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const role = url.searchParams.get('role');

    if (role === 'owner') {
      const id = randomUUID();
      const cwd = url.searchParams.get('cwd') || '';
      const label = url.searchParams.get('label') || '';
      const session = {
        id,
        cwd,
        label,
        startedAt: new Date().toISOString(),
        status: 'running',
        ownerWs: ws,
        viewers: new Set(),
      };
      sessions.set(id, session);
      ws.send(JSON.stringify({ type: 'registered', id }));
      console.log(`[relay] session registered: ${id} (cwd=${cwd})`);

      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        if (msg.type === 'data') {
          broadcastToViewers(session, { type: 'data', chunk: msg.chunk });
        } else if (msg.type === 'exited') {
          session.status = 'exited';
          broadcastToViewers(session, { type: 'exited' });
        }
      });

      ws.on('close', () => {
        session.status = 'exited';
        broadcastToViewers(session, { type: 'exited' });
        sessions.delete(id);
        console.log(`[relay] session ended: ${id}`);
      });

      return;
    }

    if (role === 'viewer') {
      const sessionId = url.searchParams.get('sessionId');
      const session = sessions.get(sessionId);
      if (!session) {
        ws.send(JSON.stringify({ type: 'error', message: 'session not found' }));
        ws.close();
        return;
      }
      session.viewers.add(ws);
      console.log(`[relay] viewer attached to session ${sessionId}`);

      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        if (msg.type === 'input' && session.ownerWs.readyState === session.ownerWs.OPEN) {
          session.ownerWs.send(JSON.stringify({ type: 'input', data: msg.data }));
        } else if (msg.type === 'resize' && session.ownerWs.readyState === session.ownerWs.OPEN) {
          session.ownerWs.send(JSON.stringify({ type: 'resize', cols: msg.cols, rows: msg.rows }));
        }
      });

      ws.on('close', () => {
        session.viewers.delete(ws);
      });

      return;
    }

    ws.close();
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`[relay] listening on http://localhost:${port}`);
      resolve({
        server,
        sessions,
        stop: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

module.exports = { startRelay };
