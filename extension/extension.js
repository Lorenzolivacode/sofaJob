const vscode = require('vscode');
const os = require('os');
const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, 'debug.log');
function log(msg) {
  try {
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {
    // niente da fare se anche il log fallisce
  }
}

log('extension.js caricato');

let createSessionOwner;
try {
  ({ createSessionOwner } = require('wrapper'));
  log('require("wrapper") OK');
} catch (e) {
  log('require("wrapper") FALLITO: ' + e.stack);
}

/**
 * Pseudoterminal che possiede una vera shell (via sessionOwner, lo stesso
 * modulo usato dal wrapper CLI e dalla dashboard Electron) e la mostra dentro
 * il pannello terminale di VS Code/Cursor, registrandola in parallelo sul
 * relay come farebbe il wrapper da riga di comando.
 */
class SofaJobPty {
  constructor(cwd, shell, relayUrl) {
    this.cwd = cwd;
    this.shell = shell;
    this.relayUrl = relayUrl;
    this.writeEmitter = new vscode.EventEmitter();
    this.closeEmitter = new vscode.EventEmitter();
    this.onDidWrite = this.writeEmitter.event;
    this.onDidClose = this.closeEmitter.event;
    this.session = null;
  }

  open(initialDimensions) {
    log(
      `open() chiamato: shell=${this.shell} cwd=${this.cwd} dims=${JSON.stringify(initialDimensions)}`
    );
    if (!createSessionOwner) {
      const msg = '[sofaJob] modulo "wrapper" non caricato, vedi debug.log';
      log('open() abortito: createSessionOwner mancante');
      this.writeEmitter.fire('\r\n\x1b[31m' + msg + '\x1b[0m\r\n');
      return;
    }
    try {
      this.session = createSessionOwner({
        cmd: this.shell,
        cwd: this.cwd,
        cols: initialDimensions ? initialDimensions.columns : 80,
        rows: initialDimensions ? initialDimensions.rows : 30,
        relayUrl: this.relayUrl,
        label: 'editor',
        onData: (data) => this.writeEmitter.fire(data),
        onExit: (code) => {
          log('sessione terminata, exitCode=' + code);
          this.closeEmitter.fire(code);
        },
        onRegistered: (id) => log('sessione registrata sul relay: ' + id),
        onRelayUnavailable: () => {
          log('relay non raggiungibile');
          this.writeEmitter.fire(
            '\r\n\x1b[33m[sofaJob] relay non raggiungibile — sessione non visibile da mobile\x1b[0m\r\n'
          );
        },
        debug: (m) => log('sessionOwner: ' + m),
      });
      log('createSessionOwner() eseguito senza eccezioni');
    } catch (e) {
      log('createSessionOwner() ha lanciato: ' + e.stack);
      this.writeEmitter.fire('\r\n\x1b[31m[sofaJob] errore avvio sessione: ' + e.message + '\x1b[0m\r\n');
    }
  }

  handleInput(data) {
    if (this.session) this.session.write(data);
  }

  setDimensions(dims) {
    if (this.session) this.session.resize(dims.columns, dims.rows);
  }

  close() {
    if (this.session) this.session.kill();
  }
}

function activate(context) {
  log('activate() chiamato');
  const provider = vscode.window.registerTerminalProfileProvider('sofajob.session', {
    provideTerminalProfile() {
      log('provideTerminalProfile() chiamato');
      const config = vscode.workspace.getConfiguration('sofajob');
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
      const shell = config.get('shell', 'powershell.exe');
      const relayUrl = config.get('relayUrl', 'ws://localhost:4455/ws');

      return {
        options: {
          name: 'sofaJob',
          pty: new SofaJobPty(cwd, shell, relayUrl),
        },
      };
    },
  });

  context.subscriptions.push(provider);
  log('registerTerminalProfileProvider completato');
}

function deactivate() {}

module.exports = { activate, deactivate };
