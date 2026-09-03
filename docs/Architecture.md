# Architecture — Mobile Terminal Dashboard

> Documento vivo: va tenuto aggiornato ad ogni cambio architetturale o di scaffolding.
> Per il contesto/requisiti originali vedi `PLAN_mobile_terminal_dashboard.md`.

## Panoramica

Il relay (`relay/server.js`) è ora un **modulo riusabile** (`startRelay(port)`),
non più legato a un processo CLI dedicato. Gira in due modi:

- **standalone**: `relay/index.js` lo avvia da riga di comando (`npm run relay`)
- **in-process dentro `dashboard/`**: un'app Electron che lo assorbe come servizio
  interno e gira **da tray**: chiudere la finestra la minimizza (non termina il
  processo), il relay resta attivo finché non si fa "Esci" esplicito dal tray —
  così il mobile funziona senza dover tenere una finestra aperta in primo piano

La logica di possedere un pty e registrarlo sul relay come "owner" è anch'essa un
**modulo riusabile** (`wrapper/lib/sessionOwner.js`), usato sia dal CLI
`wrapper/index.js` (tee su stdout/stdin reali del terminale) sia dalla dashboard
Electron (lancio sessioni da UI, senza terminale reale coinvolto — l'output va
solo al relay, che la dashboard stessa visualizza come farebbe un viewer
qualunque).

Componenti:

```
┌─────────────┐   WS (owner)   ┌──────────────┐   WS (viewer)   ┌─────────────────┐
│  wrapper     │ ─────────────▶│    relay      │◀───────────────│  app (Expo)      │
│  (per        │                │  (sempre      │                 │  WebView +       │
│  sessione,   │   pty I/O      │  acceso,      │   pty I/O       │  xterm.js        │
│  node-pty)   │                │  no DB,       │                 │  (telefono)      │
└──────┬───────┘                │  in memoria)  │                 └─────────────────┘
       │ tee                    └──────────────┘
       ▼
  terminale reale
  sul PC (stdout/stdin
  locali)
```

- **relay** (`relay/`) — processo Node sempre acceso sul PC. Non possiede nessun pty.
  Tiene il registry delle sessioni attive in memoria e fa da smistatore WebSocket tra
  il wrapper "owner" di una sessione e N client "viewer" (telefono) collegati.
- **wrapper** (`wrapper/`) — un processo per ogni sessione terminale, lanciato
  dall'utente al posto di `claude` direttamente. Crea un pty reale (`node-pty`) e ci
  lancia dentro il comando (default `claude`). Fa da _tee_: scrive l'output sia sullo
  stdout locale (il terminale reale sul PC lo mostra normalmente) sia lo inoltra al
  relay via WebSocket. Riceve anche input remoto dal relay e lo scrive nel pty.
- **app** (`app/`) — app Expo (React Native) con un `WebView` che carica una pagina
  HTML con `xterm.js`. Si collega al relay come _viewer_: lista sessioni via
  `GET /sessions`, poi WebSocket per streaming + invio input.

Perché questa separazione (relay vs wrapper) e non un "server" unico: vedi
`PLAN_mobile_terminal_dashboard.md` §2 e la discussione che ha portato a questo
schema — un server unico non spiegherebbe come il terminale reale sul PC continua a
mostrare l'output nativamente.

## Struttura repo

```
sofaJob/
├── PLAN_mobile_terminal_dashboard.md   piano/appunti originali
├── Architecture.md                      questo file
├── package.json                         root, npm workspaces: relay, wrapper
│                                         (app/ NON è nel workspace, vedi nota sotto)
├── relay/
│   ├── package.json
│   └── index.js
├── wrapper/
│   ├── package.json
│   └── index.js
└── app/                                  Expo app (gestione dipendenze indipendente)
    ├── App.js
    ├── terminalHtml.js                   contenuto HTML/JS della WebView (xterm.js)
    └── ...                               struttura standard Expo
```

**Nota:** `app/` è volutamente fuori dai npm workspaces root, per evitare i problemi
noti di risoluzione moduli di Metro (bundler di React Native/Expo) con l'hoisting dei
workspace. Ha il proprio `node_modules` indipendente.

## Struttura repo (aggiornata)

```
sofaJob/
├── PLAN_mobile_terminal_dashboard.md
├── Architecture.md
├── package.json                  root, npm workspaces: relay, wrapper, dashboard
│                                  (app/ resta fuori, vedi nota Metro/hoisting)
├── relay/
│   ├── package.json               main: server.js
│   ├── server.js                  startRelay(port) — modulo riusabile
│   └── index.js                   CLI standalone (npm run relay)
├── wrapper/
│   ├── package.json               main: lib/sessionOwner.js
│   ├── lib/sessionOwner.js        pty + registrazione owner — modulo riusabile
│   └── index.js                   CLI standalone (npm run wrapper -- <cmd>)
├── dashboard/                      app Electron (relay in-process + launcher UI)
│   ├── package.json
│   ├── main.js                    tray, finestra, IPC launch-session/get-relay-info
│   ├── preload.js                 contextBridge -> window.dashboardAPI
│   ├── assets/tray.png
│   └── renderer/index.html        UI: nuova sessione, lista, terminale (xterm.js)
├── extension/                      estensione VS Code/Cursor
│   ├── package.json                 contributes.terminal.profiles: "sofajob.session"
│   ├── extension.js                 Pseudoterminal basato su sessionOwner condiviso
│   └── .vscode/launch.json          F5 per testare in Extension Development Host
└── app/                            Expo (mobile) — WebView su terminalHtml.js
    ├── App.js
    └── terminalHtml.js
```

## Protocollo relay ↔ wrapper/app (WebSocket, JSON)

Endpoint: `ws://<host>:4455/ws?role=owner|viewer&...`

**Owner (wrapper) → relay**, alla connessione: query string `role=owner&cwd=<cwd>`.
Il relay risponde `{ type: "registered", id }` con l'UUID della sessione.

| Direzione                | type         | payload       | significato                                          |
| ------------------------ | ------------ | ------------- | ---------------------------------------------------- |
| owner → relay            | `data`       | `{ chunk }`   | output grezzo del pty, da inoltrare a tutti i viewer |
| owner → relay            | `exited`     | —             | il pty è terminato, sessione da chiudere             |
| relay → viewer           | `data`       | `{ chunk }`   | inoltro dell'output                                  |
| relay → viewer           | `exited`     | —             | notifica fine sessione                               |
| viewer → relay           | `input`      | `{ data }`    | testo/byte da scrivere nel pty                       |
| relay → owner            | `input`      | `{ data }`    | inoltro dell'input remoto                            |
| relay → owner (iniziale) | `registered` | `{ id }`      | conferma registrazione sessione                      |
| relay → viewer (errore)  | `error`      | `{ message }` | es. sessione non trovata                             |
| viewer → relay           | `resize`     | `{ cols, rows }` | dimensioni reali del terminale visualizzato — il relay le inoltra all'owner che ridimensiona il pty |
| relay → owner            | `resize`     | `{ cols, rows }` | inoltro del resize                                    |

**HTTP**: `GET /sessions` → `[{ id, cwd, startedAt, status, viewerCount }]` (registry
in memoria; `viewerCount` = numero di dispositivi/finestre collegati come viewer a
quella sessione in quel momento).

## Decisioni prese e perché

- **No login, no DB** — vincolo esplicito dell'utente. Perimetro di sicurezza = stessa
  rete wifi. Bind del relay solo su IP LAN (da implementare, vedi Limiti noti).
- **`node-pty` verificato funzionante su Windows senza build tools locali** — il
  pacchetto (v1.1.0) installa un binario precompilato, niente Visual Studio/Python
  richiesti su questa macchina (Node v24.13.0). Testato empiricamente il 2026-09-02.
- **Relay separato dal wrapper** — necessario perché il "terminale reale sul PC" deve
  continuare a funzionare nativamente; solo il wrapper può fare da tee locale.
- **Se il relay non è raggiungibile all'avvio del wrapper**, il wrapper continua a
  funzionare in locale (pty + stdout passthrough) e logga solo un warning — non
  blocca l'uso del terminale dal PC.
- **Un solo relay per macchina**, porta fissa `4455` (override via `RELAY_PORT`),
  nessuna discovery automatica per l'MVP.
- **Client mobile: Expo + WebView** (non componenti terminale native RN) — riusa
  `xterm.js`, già maturo per il rendering ANSI fedele (box Unicode, colori, menu TUI
  di Claude Code), evitando il rischio di librerie terminal native immature per RN.
  `app/` fuori dai workspace per evitare conflitti Metro/hoisting.
- **Notifiche**: previste solo _locali_ per l'MVP (app aperta/in background attivo),
  non push vere — la push vera richiederebbe il servizio push di Expo (dipendenza
  cloud esterna), rimandata a evoluzione futura se servirà davvero.

## Bug trovati e corretti durante il test (2026-09-02)

- **`node-pty` non lanciava `claude` su Windows** (`Error: Cannot create process,
  error code: 2`). `CreateProcess` di Windows non risolve `.cmd`/`.bat` come fa una
  shell — `claude` è in realtà lo shim npm `claude.cmd`. Fix in `wrapper/index.js`:
  su `win32` si lancia sempre tramite `cmd.exe /c <comando>` invece del comando
  diretto.
- **CORS mancante nel relay**: una pagina aperta da `file://` (o da una WebView) ha
  origine "null" — `fetch('http://localhost:4455/sessions')` falliva con
  "Failed to fetch" perché il relay non mandava `Access-Control-Allow-Origin`. Fix:
  header `Access-Control-Allow-Origin: *` su tutte le risposte HTTP del relay.
- **Barra controlli (frecce/Invio/Esc) inviava testo letterale invece di byte ANSI
  reali**: le sequenze erano definite come attributi HTML (`data-seq="[A"`),
  ma gli attributi HTML non interpretano gli escape stile JS — arrivava il testo
  letterale `[A` (8 caratteri) invece del vero byte ESC. Confermato dal log del
  relay (`"\\u001b"` con backslash raddoppiato = backslash letterale nella stringa).
  Fix: le sequenze sono ora definite in un oggetto `SEQ` dentro il tag `<script>` di
  `terminalHtml.js` (dove l'escaping JS viene davvero interpretato dal browser), e i
  bottoni referenziano una chiave logica (`data-key="up"`) invece del testo grezzo.
- **`xterm.js` non riempiva la larghezza del contenitore**: mancava il `FitAddon` —
  senza, il terminale resta alla dimensione di default. Fix: aggiunto
  `xterm-addon-fit` (CDN) + `fitAddon.fit()` differito con `requestAnimationFrame`
  (chiamarlo subito dopo aver reso visibile il contenitore dà misure errate, il
  layout non è ancora committato) + `min-width: 0` sui contenitori flex (il default
  browser `min-width: auto` sui flex item impedisce di restringersi sotto la
  larghezza "naturale" del contenuto, causando overflow orizzontale).
- **Layout di Claude Code deformato nelle sessioni lanciate dalla dashboard**: il
  pty veniva creato con `cols`/`rows` hardcoded (80×30, default di
  `sessionOwner.js`) invece delle dimensioni reali del riquadro `xterm.js` nella
  finestra Electron (spesso più stretto) — Claude Code disegnava il suo layout a
  colonne multiple assumendo 80 caratteri di larghezza, schiacciato in uno spazio
  minore. Fix: nuovo messaggio di protocollo `resize` (viewer → relay → owner →
  `ptyProcess.resize()`), inviato dal client subito dopo `fitAddon.fit()` e ad ogni
  resize della finestra.

## Estensione VS Code/Cursor (`extension/`)

**Ricerca (2026-09-02):** `onDidWriteTerminalData`, l'unica API che permetterebbe di
leggere l'output grezzo di un terminale **già aperto** da altri, è un'API
**proposta** (`terminalDataWriteEvent`) — richiede `--enable-proposed-api` e non è
utilizzabile in un'estensione installata normalmente. Quindi, come per Windows
"nudo" (vedi sopra), **non è possibile agganciarsi a un terminale già in corso**
neanche dentro l'editor.

La via percorribile è `vscode.Pseudoterminal` + `registerTerminalProfileProvider`:
un nuovo profilo terminale ("sofaJob (visibile da mobile)") nel menu "+" del
pannello terminale. Sceglierlo apre una shell reale (default `powershell.exe`,
configurabile con `sofajob.shell`) gestita dallo **stesso `sessionOwner` condiviso**
usato dal wrapper CLI — nessun codice duplicato, nessuna modifica al relay. Come per
il wrapper, funziona solo per le sessioni aperte **da quel momento in poi** — non
per terminali già aperti in precedenza.

**Stato: accantonata (bloccata), 2026-09-02.** Testata sia in Cursor sia in VS Code
puro: `pty.spawn()` si blocca (non lancia eccezioni, resta appeso) quando eseguito
dentro l'Extension Host di entrambi gli editor. Causa probabile: il binario nativo
precompilato di `node-pty` non è compatibile con la copia di Node/Electron che gira
nell'Extension Host (diversa sia dal Node di sistema usato dal wrapper CLI sia
dall'Electron della dashboard, dove invece funziona). Si potrebbe forzare con
`electron-rebuild` mirato all'ABI di ciascun editor, ma andrebbe rifatto per ogni
versione di VS Code/Cursor e si romperebbe ad ogni aggiornamento — costo di
manutenzione sproporzionato per l'MVP. Codice lasciato nel repo (funzionante in
teoria, bloccato in pratica) nel caso serva riprenderlo in futuro.

**La soluzione adottata al suo posto** (vedi sezione successiva) non necessita
dell'estensione: basta lanciare `claude` tramite il wrapper CLI da un terminale
normale (incluso quello integrato di Cursor/VS Code, che è un processo esterno
all'Extension Host e quindi non soffre di questo problema).

## Alias shell (soluzione adottata per "comunicare con gli agenti nei terminali di Cursor")

Invece dell'estensione (bloccata, vedi sopra), l'obiettivo principale — poter
seguire/controllare da mobile le sessioni Claude Code aperte nel terminale
integrato di Cursor/VS Code — è coperto da una funzione bash che intercetta il
comando `claude`:

```bash
# in ~/.bashrc (Git Bash)
claude() {
  node "/c/Personal/Doc/Lorenzo/Codec/Project/sofaJob/wrapper/index.js" claude "$@"
}
```

Digitare `claude` normalmente (in un terminale Cursor/VS Code integrato, o
qualunque altro terminale Git Bash) lancia trasparentemente il wrapper, che crea
il pty reale e lo registra sul relay — stesso comando di sempre, nessuna abitudine
diversa richiesta. Testato end-to-end il 2026-09-02.

**Limiti della soluzione alias:**
- Copre **Git Bash** e **PowerShell** (vedi sotto) — non `cmd.exe` (nessun
  meccanismo di profilo persistente equivalente senza toccare il registro di
  sistema, non fatto) né bash dentro WSL (percorso/ambiente diverso, non testato)
- Richiede che il profilo interattivo venga caricato — vale per un terminale aperto
  e usato a mano (il caso d'uso normale), non per invocazioni da script/task non
  interattivi o con il percorso completo dell'eseguibile
- **Non recupera sessioni già in corso** — nessuna soluzione lo permette (vedi
  discussione limiti architetturali sopra): solo le sessioni aperte *dopo* aver
  impostato l'alias diventano visibili

### Gestione alias multi-shell dalla dashboard (`dashboard/aliases.js`)

La dashboard Electron ha una sezione "Alias terminale" che:
- mostra quali shell sono supportate (`Git Bash`, `PowerShell`) e se il relativo
  file di profilo esiste già su disco (`✓`/`✗`)
- elenca gli alias esistenti, con un tag per ciascuna shell su cui sono attivi
  (attenuato/opaco se non presente su quella shell)
- permette di crearne di nuovi da UI, scegliendo su quali shell installarli

Il percorso del profilo PowerShell **non è hardcoded**: viene richiesto a
PowerShell stesso (`$PROFILE.CurrentUserCurrentHost` via `powershell.exe
-NoProfile -Command ...`), perché su questa macchina "Documenti" è rediretto su
OneDrive — un percorso fisso sarebbe stato sbagliato. Ogni alias è delimitato da
marker (`# sofaJob-alias:start:<nome>` / `:end:`) per poterlo individuare e non
toccare il resto del file di profilo dell'utente.

Il file `claude` in `.bashrc` creato manualmente in precedenza è stato convertito
allo stesso formato a marker per comparire nella lista.

## Packaging standalone (`dashboard/dist/`, `electron-builder`)

Per usare la dashboard su un altro PC senza copiare l'intero repo/installare
Node: `npm run build` dentro `dashboard/` produce un eseguibile Windows
"portable" autocontenuto (`dashboard/dist/sofaJob <versione>.exe`, ~74MB).
Testato il 2026-09-02: si avvia, il relay risponde su `:4455`, accetta
connessioni da un wrapper esterno.

Due problemi incontrati e risolti:
- **`electron` come range (`^33.2.0`) non basta** — `electron-builder` deve
  scaricare un binario Electron per una versione *esatta*. Fix: versione pinnata
  (`"electron": "33.4.11"`, presa da quella realmente installata).
- **Rebuild nativo automatico fallisce** — di default `electron-builder` prova a
  ricompilare i moduli nativi (`node-pty`) contro l'ABI di Electron via
  `@electron/rebuild`/`node-gyp`, che richiede Python/build tools (assenti su
  questa macchina, vedi nota Windows più sopra). Non serve comunque: il binario
  precompilato N-API di `node-pty` già funziona con Electron 33 (verificato più
  volte in sviluppo). Fix: `"npmRebuild": false` nella config di build, che salta
  il rebuild e impacchetta il binario così com'è.
- **`asar: false`** — scelto deliberatamente per evitare la complessità di
  `asarUnpack` per i binari nativi di `node-pty` (che non possono girare da
  dentro un archivio asar). Risultato meno "pulito" (una cartella di file invece
  di un archivio) ma niente rischio di rotture — accettabile per uso personale.

**Nota:** gli alias creati lanciando l'eseguibile pacchettizzato su un altro PC
si salvano sui profili shell *di quel* PC — nessuna sincronizzazione con questa
macchina (coerente con "un relay per macchina", vedi sopra).

## Limiti noti / non ancora implementato

- **Nessun bind esplicito su IP LAN** nel relay — al momento ascolta su tutte le
  interfacce (default Node `http.listen`). Da restringere prima di un uso reale fuori
  da un ambiente di test.
- **Nessun token/deterrente** di accesso ancora implementato.
- **`xterm.js` caricato da CDN** all'interno della WebView (per velocità di
  scaffolding) — richiede che il telefono abbia comunque accesso internet oltre alla
  LAN locale. Da valutare bundling offline se diventa un problema pratico.
- **Nessun buffer di replay** per la riconnessione — se il telefono perde la
  connessione WS, alla riconnessione riparte "in diretta", senza vedere l'output perso
  nel frattempo.
- **Nessuna pulizia/garbage collection esplicita** oltre alla rimozione alla
  disconnessione dell'owner — comportamento accettabile per l'uso attuale (single
  owner per sessione, rimozione immediata alla chiusura).
- **Resize multi-viewer**: se più dispositivi guardano la stessa sessione con
  dimensioni diverse (es. telefono e dashboard PC contemporaneamente), l'ultimo che
  invia un `resize` "vince" e ridimensiona il pty per tutti — non c'è un concetto di
  dimensione "per viewer", è intrinseco al fatto che un pty ha un'unica dimensione
  condivisa. Accettabile per l'uso personale attuale (un viewer alla volta nella
  pratica).

## Stato roadmap (rispetto a `PLAN_mobile_terminal_dashboard.md` §6)

- [x] Step 1 — relay + wrapper minimali, streaming I/O verificato end-to-end (test
      con client WS di prova, superato il 2026-09-02)
- [x] Step 2/3 — app Expo scaffoldata (`app/`, SDK 57): schermata impostazioni per
      inserire `host:porta` del relay (salvata in `AsyncStorage`), `WebView` con
      `xterm.js` che legge `GET /sessions`, mostra la lista, apre una sessione via WS
      viewer e ha la barra controlli touch (frecce/Invio/Esc/Spazio + testo libero).
      Testato **in un browser desktop** (non ancora su device/emulatore reale) contro
      relay + wrapper con una sessione `claude` vera: lista sessioni, apertura
      terminale, testo libero e barra controlli (frecce/Invio/Esc) tutti verificati
      funzionanti il 2026-09-02, dopo due bug fix (vedi sotto).
- [x] Step 4 (parziale) — la dashboard con elenco/selezione sessioni è già nell'app
      (dentro `terminalHtml.js`), lato relay il multi-sessione era già supportato
- [x] Step 5 — naming sessioni via storage locale (localStorage, chiave
      `sofajob-names`, mapping `{sessionId: nome}`), implementato sia in
      `dashboard/renderer/index.html` sia in `app/terminalHtml.js`: bottone "✎"
      accanto ad ogni sessione apre un campo di testo inline (non `window.prompt()`,
      per compatibilità con `react-native-webview` che non lo supporta in modo
      affidabile); nessuna sincronizzazione col server, coerente col vincolo "no DB".
      Fallback per il nome mostrato: nome salvato in locale → `label` (se la
      sessione è stata lanciata con un'etichetta, es. dal form "Nuova sessione"
      della dashboard) → id troncato. Testato funzionante il 2026-09-02. Aggiunto anche `label` alla risposta di
      `GET /sessions` (mancava, era salvato ma mai esposto).
- [ ] Step 6 — hardening (bind IP LAN, token opzionale)
