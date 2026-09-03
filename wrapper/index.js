const { createSessionOwner } = require('./lib/sessionOwner');

const RELAY_URL = process.env.RELAY_URL || 'ws://localhost:4455/ws';
const cmd = process.argv[2] || process.env.WRAPPER_CMD || 'claude';
const args = process.argv.slice(3);

const cols = process.stdout.columns || 80;
const rows = process.stdout.rows || 30;

const session = createSessionOwner({
  cmd,
  args,
  cwd: process.cwd(),
  cols,
  rows,
  relayUrl: RELAY_URL,
  onData: (data) => process.stdout.write(data),
  onRegistered: (id) => console.error(`[wrapper] session registered: ${id}`),
  onRelayUnavailable: () =>
    console.error('[wrapper] relay non raggiungibile, sessione non visibile da mobile'),
  onExit: (exitCode) => {
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    process.exit(exitCode);
  },
});

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.on('data', (chunk) => session.write(chunk.toString('utf8')));

process.stdout.on('resize', () => {
  session.resize(process.stdout.columns || cols, process.stdout.rows || rows);
});
