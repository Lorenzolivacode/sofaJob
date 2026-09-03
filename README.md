# sofaJob

Segui e controlla da telefono le sessioni Claude Code (o qualunque shell) aperte
sul PC — dal divano, senza login né database.

Per il *perché* delle scelte architetturali, il protocollo e i limiti noti vedi
[`docs/Architecture.md`](docs/Architecture.md). Per l'idea originale/i requisiti
vedi [`docs/PLAN_mobile_terminal_dashboard.md`](docs/PLAN_mobile_terminal_dashboard.md).

## Avvio rapido

Prerequisiti: Node.js, npm. Nessun'altra dipendenza va installata a mano — su
Windows `node-pty` usa un binario precompilato.

```bash
npm install
```

### Modo consigliato: la dashboard

```bash
npm run dashboard
```

Apre un'app desktop che fa da relay (resta attiva in tray anche a finestra
chiusa — "Esci" dal tray per fermarla davvero), mostra le sessioni attive, i
dispositivi collegati, e permette di:
- lanciare nuove sessioni (PowerShell/cmd/bash/`claude`/comando a scelta) da UI
- creare **alias di shell**: fai apparire un comando (es. `claude`) come
  tracciato automaticamente ogni volta che lo digiti in un nuovo terminale
  Bash/PowerShell — nessuna abitudine diversa richiesta
- **rinominare le sessioni** (bottone ✎ accanto al nome) per riconoscerle più
  facilmente — il nome resta salvato solo su questo dispositivo (o telefono),
  non è condiviso col server

### Alternativa da riga di comando

```bash
npm run relay              # in una finestra, resta aperta
npm run wrapper -- claude  # in un'altra, per ogni sessione da tracciare
```

### Da telefono

Stessa wifi del PC. Apri l'app mobile (`app/`, Expo — vedi sotto) e inserisci
`<IP del PC>:4455` (la dashboard te lo mostra già pronto).

## Creare un alias manualmente (senza dashboard)

Se preferisci non passare dalla UI, aggiungi a `~/.bashrc` (Git Bash):

```bash
claude() {
  node "/percorso/assoluto/a/sofaJob/wrapper/index.js" claude "$@"
}
```

Per PowerShell, stesso principio nel file indicato da `$PROFILE.CurrentUserCurrentHost`
(sintassi `function nome { node "..." nome @args }`).

## App mobile (Expo)

```bash
cd app
npx expo start
```

Scansiona il QR con Expo Go sul telefono (stessa wifi del PC).

## Pacchettizzare la dashboard come exe standalone

Per usarla su un altro PC senza installare Node/npm/clonare il repo:

```bash
cd dashboard
npm run build
```

Produce `dashboard/dist/sofaJob <versione>.exe` (~74MB, portable, tutto
incluso — Electron, `node-pty`, relay, wrapper). Copialo sul PC di
destinazione e avvialo, non serve altro lì. Gli alias creati da quell'istanza
si salvano sui profili shell *di quel* PC (il sistema è per-macchina, non
sincronizzato tra macchine diverse).

Testato e funzionante (2026-09-02). Note pratiche:
- Il primo avvio dell'exe è più lento del solito `npm run dashboard` (si
  autoestrae prima di partire) — dai qualche secondo in più prima di controllare
  che il relay risponda
- Se rilanci `npm run build` dopo aver già avviato l'exe generato in
  precedenza, chiudi prima quel processo (`sofaJob.exe`), altrimenti la build
  fallisce con un errore di file bloccato (`EBUSY`) perché Windows non riesce a
  sovrascrivere un eseguibile in esecuzione
- La configurazione in `dashboard/package.json` ha già `"electron"` fissato a
  una versione esatta e `"npmRebuild": false` — non toccare questi due valori:
  servono a evitare che `electron-builder` provi (fallendo) a ricompilare
  `node-pty` da sorgente, per cui servirebbero Python/Visual Studio Build Tools
  non installati su questa macchina

## Struttura repo

```
relay/       registry sessioni + relay WebSocket (riusabile, no dipendenze pty)
wrapper/     possiede il pty reale, si registra sul relay come "owner"
dashboard/   app Electron: relay in-process + launcher UI + gestione alias
app/         app mobile Expo (WebView + xterm.js)
extension/   estensione VS Code/Cursor — accantonata, vedi Architecture.md
docs/        Architecture.md, PLAN_mobile_terminal_dashboard.md
```
