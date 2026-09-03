const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const WRAPPER_PATH = path.join(__dirname, '..', 'wrapper', 'index.js').replace(/\\/g, '/');
const NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

let cachedPsProfilePath = null;
function resolvePowershellProfilePath() {
  if (cachedPsProfilePath) return cachedPsProfilePath;
  try {
    // Chiediamo a PowerShell stesso dove si aspetta il profilo: su questa
    // macchina "Documenti" e' rediretto su OneDrive, un percorso hardcoded
    // sarebbe stato sbagliato. Solo PowerShell risolve questo correttamente.
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', '$PROFILE.CurrentUserCurrentHost'],
      { encoding: 'utf8' }
    );
    cachedPsProfilePath = out.trim();
  } catch (e) {
    cachedPsProfilePath = path.join(os.homedir(), 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1');
  }
  return cachedPsProfilePath;
}

const SHELLS = {
  bash: {
    id: 'bash',
    label: 'Git Bash',
    profilePath: () => path.join(os.homedir(), '.bashrc'),
    block: (name) =>
      `# sofaJob-alias:start:${name}\n${name}() {\n  node "${WRAPPER_PATH}" ${name} "$@"\n}\n# sofaJob-alias:end:${name}\n`,
  },
  powershell: {
    id: 'powershell',
    label: 'PowerShell',
    profilePath: () => resolvePowershellProfilePath(),
    block: (name) =>
      `# sofaJob-alias:start:${name}\nfunction ${name} {\n    node "${WRAPPER_PATH}" ${name} @args\n}\n# sofaJob-alias:end:${name}\n`,
  },
};

function readProfile(shell) {
  const p = shell.profilePath();
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function markerRegex(name) {
  return new RegExp(`# sofaJob-alias:start:${name}[\\s\\S]*?# sofaJob-alias:end:${name}`);
}

/**
 * Stato dei profili shell supportati: percorso e se esistono già sul disco
 * (indipendentemente dal fatto che contengano alias sofaJob).
 */
function shellStatus() {
  return Object.values(SHELLS).map((shell) => ({
    id: shell.id,
    label: shell.label,
    profilePath: shell.profilePath(),
    exists: fs.existsSync(shell.profilePath()),
  }));
}

/**
 * Elenca gli alias sofaJob su tutte le shell supportate, come
 * { nome: { bash: true|false, powershell: true|false } }.
 */
function listAliases() {
  const result = {};
  for (const shell of Object.values(SHELLS)) {
    const content = readProfile(shell);
    const regex = /# sofaJob-alias:start:(\S+)[\s\S]*?# sofaJob-alias:end:\1/g;
    let m;
    while ((m = regex.exec(content))) {
      const name = m[1];
      result[name] = result[name] || {};
      result[name][shell.id] = true;
    }
  }
  return result;
}

/**
 * Aggiunge l'alias `name` alle shell indicate in `shellIds` (es. ['bash']).
 * Ritorna un risultato per shell: { bash: {ok:true}, powershell: {ok:false, error} }.
 */
function addAlias(name, shellIds) {
  if (!NAME_RE.test(name)) {
    return { ok: false, error: 'nome non valido (lettere, numeri, - e _, deve iniziare con una lettera)' };
  }
  if (!Array.isArray(shellIds) || shellIds.length === 0) {
    return { ok: false, error: 'seleziona almeno una shell' };
  }

  const perShell = {};
  for (const id of shellIds) {
    const shell = SHELLS[id];
    if (!shell) {
      perShell[id] = { ok: false, error: 'shell sconosciuta' };
      continue;
    }
    try {
      const profilePath = shell.profilePath();
      let content = readProfile(shell);
      if (markerRegex(name).test(content)) {
        perShell[id] = { ok: false, error: 'alias già esistente' };
        continue;
      }
      fs.mkdirSync(path.dirname(profilePath), { recursive: true });
      if (content && !content.endsWith('\n')) content += '\n';
      content += '\n' + shell.block(name);
      fs.writeFileSync(profilePath, content);
      perShell[id] = { ok: true };
    } catch (e) {
      perShell[id] = { ok: false, error: e.message };
    }
  }
  return { ok: true, perShell };
}

module.exports = { listAliases, addAlias, shellStatus };
