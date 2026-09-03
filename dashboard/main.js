const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const { startRelay } = require('relay');
const { createSessionOwner } = require('wrapper');
const { listAliases, addAlias, shellStatus } = require('./aliases');

const PORT = Number(process.env.RELAY_PORT) || 4455;

let mainWindow = null;
let tray = null;

function localLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 720,
    title: 'sofaJob dashboard',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'tray.png'));
  tray.setToolTip('sofaJob — relay attivo su porta ' + PORT);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Apri dashboard', click: () => mainWindow.show() },
      { type: 'separator' },
      {
        label: 'Esci (ferma il relay)',
        click: () => {
          app.isQuiting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', () => mainWindow.show());
}

app.whenReady().then(async () => {
  await startRelay(PORT);
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // non chiudere l'app: il relay resta attivo in background finché non si
  // fa "Esci" dal tray.
});

ipcMain.handle('launch-session', (event, { cmd, args, cwd, label }) => {
  return new Promise((resolve) => {
    let settled = false;
    createSessionOwner({
      cmd,
      args: args || [],
      cwd: cwd || os.homedir(),
      label: label || '',
      relayUrl: `ws://localhost:${PORT}/ws`,
      onRegistered: (id) => {
        if (!settled) {
          settled = true;
          resolve({ ok: true, id });
        }
      },
      onExit: () => {
        // rimosso dal registry relay lato server già alla chiusura del WS owner
      },
      onRelayUnavailable: () => {
        if (!settled) {
          settled = true;
          resolve({ ok: false, error: 'relay non raggiungibile' });
        }
      },
    });
  });
});

ipcMain.handle('get-relay-info', () => ({ port: PORT, lanIp: localLanIp() }));

ipcMain.handle('list-aliases', () => listAliases());

ipcMain.handle('add-alias', (event, { name, shells }) => addAlias(name, shells));

ipcMain.handle('shell-status', () => shellStatus());
