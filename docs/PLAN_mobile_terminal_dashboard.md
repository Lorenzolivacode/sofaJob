# Piano: Dashboard Mobile per Sessioni Terminale (Claude Code da Divano)

> **Nota per l'agente che legge questo file**: questo NON è un piano per l'app Freedihare.
> È l'idea di un progetto completamente separato, salvata qui solo come appunto temporaneo
> prima di essere spostata in un nuovo repo dedicato. Non ha dipendenze dal codice o
> dalle regole di `CLAUDE.md` di questo progetto.

## Contesto

L'utente vuole seguire da mobile (es. dal divano) le sessioni di terminale aperte sul PC,
in particolare le sessioni di Claude Code CLI. Deve poter:

- vedere una **dashboard** con le sessioni attive
- **nominare** le sessioni per riconoscerle facilmente
- aprirne una e **interagire come se fosse davanti al PC**: dare task, rispondere a
  domande testuali, e rispondere anche a prompt interattivi con opzioni multiple /
  checkbox (i menu TUI che Claude Code mostra nel terminale)

## Vincoli espliciti dell'utente

- **Nessun login** — l'unico perimetro di sicurezza è essere sulla stessa rete wifi
- **Nessun database** — nessuna persistenza server-side
- Il naming delle sessioni si salva in **localStorage sul telefono**, non lato server

---

## 1. Decisione architetturale centrale (da chiarire prima di iniziare)

"Leggere tutti i terminali aperti" ha due letture molto diverse in termini di complessità:

### Interpretazione A — Agganciarsi a terminali già esistenti e indipendenti
Es. finestre di Windows Terminal / VS Code / PowerShell già aperte manualmente
dall'utente, senza che siano state lanciate dal nostro sistema.

**Molto complesso su Windows.** A differenza di Linux (dove `tmux`/`screen` permettono
di attaccarsi a sessioni esistenti), Windows non ha un meccanismo nativo per agganciare
lo stdin/stdout di un processo terminale arbitrario già in esecuzione. Richiederebbe
hook a basso livello, ConPTY tricks non standard, o automazione UI — fragile e non
consigliato per un MVP.

### Interpretazione B — Sessioni lanciate/gestite dal nostro sistema (consigliata)
Il server crea e gestisce lui stesso i processi terminale (via `node-pty`), sia che
l'utente li avvii dal PC (tramite un piccolo launcher/CLI locale) sia che li avvii da
mobile. Da quel momento la sessione è visibile e controllabile sia dal terminale reale
sul PC sia dalla dashboard mobile, perché entrambi si collegano allo stesso processo pty
gestito dal server.

**Fattibile e standard** — è lo stesso principio usato da strumenti come `ttyd`,
`gotty`, `tmux` + web viewer.

**Raccomandazione:** partire dall'Interpretazione B. In pratica: l'utente lancia le
sessioni Claude Code tramite un piccolo wrapper (`npx my-terminal-hub` o simile) invece
che aprendo un terminale a mano. Da quel momento la sessione appare nella dashboard.

---

## 2. Architettura proposta

```
┌─────────────────────┐        LAN wifi         ┌──────────────────────┐
│   PC (server Node)   │ <─────────────────────> │  Telefono (browser)   │
│                       │      WebSocket           │                       │
│  ┌─────────────────┐  │                          │  ┌─────────────────┐  │
│  │ node-pty process │  │                          │  │  xterm.js        │  │
│  │ (sessione 1)     │──┼── stream I/O ────────────┼─▶│  (rendering       │  │
│  ├─────────────────┤  │                          │  │   terminale)      │  │
│  │ node-pty process │  │                          │  └─────────────────┘  │
│  │ (sessione 2)     │  │                          │  ┌─────────────────┐  │
│  └─────────────────┘  │                          │  │ Barra controlli   │  │
│                       │                          │  │ ↑ ↓ ← → Invio Esc │  │
│  Session registry     │                          │  └─────────────────┘  │
│  (in memoria, no DB)  │                          │  localStorage:        │
└─────────────────────┘                          │  { sessionId: nome }  │
                                                     └──────────────────────┘
```

### Server (Node.js, gira sul PC)

- `node-pty` per creare/gestire i processi terminale reali (Claude Code CLI dentro)
- WebSocket server per lo streaming bidirezionale dell'I/O terminale
- Un registry **in memoria** (no DB) delle sessioni attive: `{ id, pid, cwd, startedAt }`
- Bind esplicito su indirizzo IP della LAN (es. `192.168.x.x`), **mai** su `0.0.0.0`
  esposto pubblicamente, nessun port forwarding sul router
- Endpoint HTTP minimale: `GET /sessions` (lista sessioni attive)

### Client (PWA, aperta dal browser del telefono via IP del PC)

- `xterm.js` per il rendering fedele del terminale (incluse sequenze ANSI dei menu
  interattivi di Claude Code)
- Barra di controllo touch-friendly sopra la tastiera: frecce ↑↓←→, Invio, Spazio, Esc
  — necessaria perché la tastiera mobile non ha frecce native e i menu a scelta
  multipla/checkbox di Claude Code si navigano così
- Campo di testo libero per digitare task/risposte
- Dashboard iniziale con elenco sessioni (via `GET /sessions` + WebSocket per update live)
- Naming sessioni: mapping `{ sessionId: nomeScelto }` salvato in `localStorage`,
  nessuna sincronizzazione col server

---

## 3. Identità delle sessioni (perché il naming in localStorage regga)

Perché il mapping `nome ↔ sessione` salvato sul telefono resti valido nel tempo, il
server deve assegnare un **ID stabile** ad ogni sessione al momento della creazione
(es. UUID), e mantenerlo finché il processo pty è vivo.

Se il server riparte, gli ID delle sessioni attive a quel punto cambiano
inevitabilmente (i processi non sopravvivono al riavvio del server) — il mapping in
localStorage per quelle vecchie sessioni diventa orfano. Non è un problema da
risolvere con persistenza server-side (violerebbe il vincolo "no DB"): è un limite
accettato del design, l'utente semplicemente ri-nominerà le sessioni nuove.

```typescript
type TerminalSession = {
  id: string;           // UUID assegnato alla creazione, stabile finché il processo vive
  pid: number;
  cwd: string;
  startedAt: string;    // ISO timestamp
  status: "running" | "exited";
};
```

---

## 4. Sicurezza (solo wifi, nessun login)

- Il server **deve** fare bind esplicito sull'IP della LAN, non su tutte le interfacce
- Nessuna esposizione a internet, nessun port forwarding
- **Rischio accettato:** chiunque sia sulla stessa rete wifi (altri dispositivi di casa,
  o rete condivisa se non è una wifi privata) può aprire la pagina e vedere/controllare
  i terminali. Accettabile su una wifi domestica fidata.
- Miglioria minima a basso costo (opzionale, sempre senza DB/login vero):
  un token statico letto da variabile d'ambiente e passato come query string
  (`?token=xxxx`), giusto per scoraggiare l'accesso casuale da altri dispositivi in rete
  — non è vera autenticazione, è un deterrente

---

## 5. Stack tecnico proposto per l'MVP

| Componente          | Scelta                          | Motivo                                              |
|----------------------|----------------------------------|------------------------------------------------------|
| Server               | Node.js + `node-pty`             | Standard per gestire processi pty cross-platform     |
| Trasporto            | WebSocket (`ws`)                 | Streaming bidirezionale I/O terminale a bassa latenza |
| Client               | PWA (HTML/CSS/JS o React)        | Nessuna installazione, basta il browser del telefono  |
| Rendering terminale  | `xterm.js`                       | Rendering ANSI fedele, stesso motore usato da VS Code |
| Naming sessioni      | `localStorage`                   | Nessun DB richiesto, per requisito esplicito          |
| Sicurezza            | Bind su IP LAN (+ token opzionale)| Nessun login, perimetro = rete wifi fidata            |

Nessuna dipendenza da servizi cloud: tutto gira in locale sul PC.

---

## 6. Roadmap MVP (step incrementali)

1. **Server minimale**: crea una sessione `node-pty` che lancia `claude` (o qualunque
   shell), espone lo stream via WebSocket su un singolo endpoint. Nessuna dashboard
   ancora — solo verificare che lo streaming I/O funzioni.
2. **Client minimale**: pagina con `xterm.js` che si connette al WebSocket e mostra il
   terminale. Testare da un browser desktop prima, poi da mobile sulla stessa wifi.
3. **Barra controlli touch**: aggiungere i bottoni ↑↓←→ Invio Esc Spazio che inviano i
   codici ANSI corrispondenti al pty — verificare che i menu interattivi di Claude Code
   (scelta multipla, checkbox) siano navigabili da mobile.
4. **Multi-sessione**: registry in memoria di più sessioni pty, endpoint `GET /sessions`,
   dashboard con elenco e selezione.
5. **Naming via localStorage**: UI per rinominare una sessione, persistenza locale sul
   telefono.
6. **Hardening minimo**: bind esplicito su IP LAN, eventuale token opzionale in query
   string.

---

## 7. Sfide note

### Rendering mobile di un terminale "pensato" per desktop
`xterm.js` è responsive ma l'output di Claude Code (tabelle larghe, box Unicode) può
risultare stretto su schermi piccoli. Da valutare: font size dinamico o wrap forzato
lato client.

### Input da mobile per navigazione menu
Le frecce/Invio/Spazio vanno mappate ai byte ANSI corretti da inviare al pty
(es. `\x1b[A` per freccia su). Da centralizzare in una piccola utility lato client,
non duplicare la mappatura in più punti.

### Riconnessione
Se il telefono perde la wifi e si riconnette, il client deve poter re-agganciarsi allo
stream della stessa sessione senza perdere l'output già presente (il server può tenere
un buffer degli ultimi N KB di output per sessione, sempre in memoria, per il replay
alla riconnessione).

---

## 8. Possibili evoluzioni future

| Evoluzione                         | Descrizione                                                        |
|--------------------------------------|----------------------------------------------------------------------|
| **Notifiche push**                  | Avviso sul telefono quando una sessione richiede input (idle su prompt) |
| **Token/PIN semplice**              | Deterrente minimo di accesso senza vero login                       |
| **App nativa (invece di PWA)**      | Solo se serve notifiche push affidabili in background                |
| **Buffer di replay più lungo**      | Scroll-back esteso per rivedere l'intera sessione dopo riconnessione |
| **Supporto multi-PC**               | Dashboard che aggrega sessioni da più macchine sulla stessa rete     |
