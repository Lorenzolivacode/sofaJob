const pty = require('node-pty');
const WebSocket = require('ws');

/**
 * Crea e possiede un pty reale, lo registra sul relay come "owner" e fa da tee:
 * l'output va sia a `onData` (per chi la chiama: stdout locale nel wrapper CLI,
 * IPC verso il renderer nella dashboard Electron) sia al relay via WS. L'input
 * puo' arrivare sia da `write()` (chiamato da chi possiede questa sessione) sia
 * dal relay (input remoto da un viewer), entrambi finiscono nello stesso pty.
 *
 * Riusata sia da wrapper/index.js (CLI, tee su stdout/stdin reali) sia dalla
 * dashboard Electron (tee via IPC, nessun terminale reale coinvolto).
 */
function createSessionOwner({
  cmd,
  args = [],
  cwd = process.cwd(),
  cols = 80,
  rows = 30,
  relayUrl = 'ws://localhost:4455/ws',
  label = '',
  onData = () => {},
  onExit = () => {},
  onRegistered = () => {},
  onRelayUnavailable = () => {},
  debug = () => {},
}) {
  // Su Windows, node-pty usa CreateProcess che non risolve .cmd/.bat come fa
  // una shell (es. `claude` e' in realta' `claude.cmd`, uno shim npm). Si passa
  // quindi sempre per cmd.exe, che risolve PATH/PATHEXT correttamente.
  const [spawnCmd, spawnArgs] =
    process.platform === 'win32'
      ? [process.env.ComSpec || 'cmd.exe', ['/c', cmd, ...args]]
      : [cmd, args];

  debug(`prima di pty.spawn(${spawnCmd}, ${JSON.stringify(spawnArgs)})`);
  const ptyProcess = pty.spawn(spawnCmd, spawnArgs, {
    name: 'xterm-color',
    cols,
    rows,
    cwd,
    env: process.env,
  });
  debug(`pty.spawn ritornato, pid=${ptyProcess.pid}`);

  let ws = null;
  let registered = false;

  function connectRelay() {
    const url = `${relayUrl}?role=owner&cwd=${encodeURIComponent(cwd)}&label=${encodeURIComponent(label)}`;
    debug('apro WebSocket verso ' + url);
    ws = new WebSocket(url);
    ws.on('open', () => debug('WebSocket aperto'));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'registered') {
        registered = true;
        onRegistered(msg.id);
      } else if (msg.type === 'input') {
        ptyProcess.write(msg.data);
      } else if (msg.type === 'resize' && msg.cols > 0 && msg.rows > 0) {
        ptyProcess.resize(msg.cols, msg.rows);
      }
    });

    ws.on('close', () => {
      registered = false;
      ws = null;
    });

    ws.on('error', () => {
      onRelayUnavailable();
      ws = null;
    });
  }

  connectRelay();
  debug('connectRelay() chiamato, registro handler pty.onData/onExit');

  function sendToRelay(payload) {
    if (ws && registered && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  ptyProcess.onData((data) => {
    onData(data);
    sendToRelay({ type: 'data', chunk: data });
  });

  ptyProcess.onExit(({ exitCode }) => {
    sendToRelay({ type: 'exited' });
    onExit(exitCode);
  });

  debug('createSessionOwner: ritorno il controller');
  return {
    write: (data) => ptyProcess.write(data),
    resize: (c, r) => ptyProcess.resize(c, r),
    kill: () => ptyProcess.kill(),
  };
}

module.exports = { createSessionOwner };
