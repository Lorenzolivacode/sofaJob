const { startRelay } = require('./server');

const PORT = process.env.RELAY_PORT || 4455;

startRelay(PORT);
