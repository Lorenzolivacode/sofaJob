export function getTerminalHtml(host) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />
<script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"></script>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #1e1e1e; color: #eee; font-family: sans-serif; }
  #list { padding: 12px; }
  #list h2 { font-size: 16px; color: #aaa; font-weight: normal; }
  .session { background: #2a2a2a; border-radius: 8px; padding: 12px; margin-bottom: 8px; }
  .session .cwd { font-size: 13px; word-break: break-all; }
  .session .meta { font-size: 11px; color: #888; margin-top: 4px; }
  .session-row { display: flex; align-items: center; gap: 6px; }
  .session-name { flex: 1; }
  .renameBtn { background: none; border: none; color: #777; cursor: pointer; font-size: 14px; padding: 4px 6px; }
  .renameInput { flex: 1; background: #1e1e1e; color: #eee; border: 1px solid #4caf50; border-radius: 4px; padding: 6px; font-size: 14px; }
  .renameSave { background: #4caf50; color: #fff; border: none; border-radius: 4px; padding: 6px 10px; font-size: 13px; }
  .session .status { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .status.running { background: #4caf50; }
  .status.exited { background: #777; }
  #refresh { background: #333; color: #eee; border: none; padding: 8px 12px; border-radius: 6px; margin: 12px; }
  #term-view { display: none; height: 100%; flex-direction: column; min-width: 0; }
  #terminal { flex: 1; overflow: hidden; min-width: 0; }
  #terminal .xterm { height: 100%; }
  #controls { background: #252525; padding: 6px; display: flex; flex-wrap: wrap; gap: 6px; }
  #controls button { flex: 1; min-width: 40px; background: #3a3a3a; color: #eee; border: none; border-radius: 6px; padding: 10px 0; font-size: 16px; }
  #inputRow { display: flex; padding: 6px; background: #252525; gap: 6px; }
  #freeText { flex: 1; background: #1e1e1e; color: #eee; border: 1px solid #444; border-radius: 6px; padding: 8px; }
  #sendBtn, #backBtn { background: #3a3a3a; color: #eee; border: none; border-radius: 6px; padding: 8px 12px; }
</style>
</head>
<body>

<div id="list">
  <h2>Sessioni su ${host}</h2>
  <div id="sessions"></div>
  <button id="refresh">Aggiorna</button>
</div>

<div id="term-view">
  <div id="terminal"></div>
  <div id="controls">
    <button data-key="up">&uarr;</button>
    <button data-key="down">&darr;</button>
    <button data-key="left">&larr;</button>
    <button data-key="right">&rarr;</button>
    <button data-key="enter">Invio</button>
    <button data-key="esc">Esc</button>
    <button data-key="space">Spazio</button>
  </div>
  <div id="inputRow">
    <button id="backBtn">&lt; Lista</button>
    <input id="freeText" type="text" placeholder="scrivi un comando..." />
    <button id="sendBtn">Invia</button>
  </div>
</div>

<script>
  const host = ${JSON.stringify(host)};
  let ws = null;
  let term = null;
  let fitAddon = null;

  function sendResize() {
    if (term && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    }
  }

  window.addEventListener('resize', () => {
    if (fitAddon && document.getElementById('term-view').style.display !== 'none') {
      fitAddon.fit();
      sendResize();
    }
  });

  // Le sequenze ANSI DEVONO essere definite qui (dentro lo script), non come
  // attributi HTML: solo i literal string JS interpretano \\u001b/\\r come
  // byte di controllo reali, gli attributi HTML li trattano come testo.
  const SEQ = {
    up: '\\u001b[A',
    down: '\\u001b[B',
    left: '\\u001b[D',
    right: '\\u001b[C',
    enter: '\\r',
    esc: '\\u001b',
    space: ' ',
  };

  function loadSessions() {
    fetch('http://' + host + '/sessions')
      .then(r => r.json())
      .then(renderSessions)
      .catch(err => {
        document.getElementById('sessions').innerHTML =
          '<div class="session">Errore di connessione al relay: ' + err.message + '</div>';
      });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function getStoredNames() {
    try { return JSON.parse(localStorage.getItem('sofajob-names') || '{}'); } catch (e) { return {}; }
  }

  function setStoredName(id, name) {
    const names = getStoredNames();
    if (name) names[id] = name; else delete names[id];
    localStorage.setItem('sofajob-names', JSON.stringify(names));
  }

  function renderSessions(sessions) {
    const el = document.getElementById('sessions');
    if (!sessions.length) {
      el.innerHTML = '<div class="session">Nessuna sessione attiva</div>';
      return;
    }
    const names = getStoredNames();
    el.innerHTML = sessions.map(s => {
      const displayName = names[s.id] || s.label || s.id.slice(0, 8);
      return (
        '<div class="session" data-id="' + s.id + '">' +
          '<div class="session-row">' +
            '<span class="status ' + s.status + '"></span>' +
            '<span class="session-name">' + escapeHtml(displayName) + '</span>' +
            '<button class="renameBtn" data-id="' + s.id + '" data-name="' + escapeHtml(displayName) + '">✎</button>' +
          '</div>' +
          '<div class="cwd">' + s.cwd + '</div>' +
          '<div class="meta">avviata ' + new Date(s.startedAt).toLocaleTimeString() + '</div>' +
        '</div>'
      );
    }).join('');

    [...el.querySelectorAll('.session[data-id]')].forEach(node => {
      node.addEventListener('click', (ev) => {
        if (ev.target.closest('.renameBtn') || ev.target.closest('.renameInput') || ev.target.closest('.renameSave')) return;
        openSession(node.dataset.id);
      });
    });

    [...el.querySelectorAll('.renameBtn')].forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const id = btn.dataset.id;
        const row = btn.closest('.session-row');
        const current = btn.dataset.name;
        row.innerHTML =
          '<input class="renameInput" type="text" value="' + escapeHtml(current) + '" />' +
          '<button class="renameSave">OK</button>';
        const input = row.querySelector('.renameInput');
        input.focus();
        const save = () => {
          setStoredName(id, input.value.trim());
          loadSessions();
        };
        row.querySelector('.renameSave').addEventListener('click', (e) => { e.stopPropagation(); save(); });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      });
    });
  }

  function openSession(id) {
    document.getElementById('list').style.display = 'none';
    const view = document.getElementById('term-view');
    view.style.display = 'flex';

    if (term) { term.dispose(); }
    term = new Terminal({ convertEol: true, fontSize: 13, theme: { background: '#1e1e1e' } });
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal'));
    requestAnimationFrame(() => { fitAddon.fit(); sendResize(); });

    ws = new WebSocket('ws://' + host + '/ws?role=viewer&sessionId=' + id);
    ws.onopen = () => sendResize();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'data') term.write(msg.chunk);
      else if (msg.type === 'exited') term.write('\\r\\n[sessione terminata]\\r\\n');
      else if (msg.type === 'error') term.write('\\r\\n[errore: ' + msg.message + ']\\r\\n');
    };
    ws.onerror = () => term.write('\\r\\n[errore di connessione al relay]\\r\\n');
  }

  function sendInput(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data }));
    }
  }

  document.getElementById('refresh').addEventListener('click', loadSessions);

  document.getElementById('backBtn').addEventListener('click', () => {
    if (ws) ws.close();
    document.getElementById('term-view').style.display = 'none';
    document.getElementById('list').style.display = 'block';
    loadSessions();
  });

  [...document.querySelectorAll('#controls button')].forEach(btn => {
    btn.addEventListener('click', () => sendInput(SEQ[btn.dataset.key]));
  });

  document.getElementById('sendBtn').addEventListener('click', () => {
    const field = document.getElementById('freeText');
    if (field.value) {
      sendInput(field.value + '\\r');
      field.value = '';
    }
  });
  document.getElementById('freeText').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') document.getElementById('sendBtn').click();
  });

  loadSessions();
</script>
</body>
</html>`;
}
