'use strict';

// ============================================================
// Smart Inventory Server — Entry Point
// ============================================================

const http = require('http');
const path = require('path');

const { PORT, DATA_FILE, IMAGE_DIR, BACKUP_DIR, BACKUP_INTERVAL_MS } = require('./constants');
const { ensureDirSync, getAllLocalIPs, openBrowser } = require('./utils');
const storeMod = require('./store');
const { requestHandler } = require('./routes');

const DATA_FILE_FULL = path.join(__dirname, '..', DATA_FILE);
const IMAGE_DIR_FULL = path.join(__dirname, '..', IMAGE_DIR);
const BACKUP_DIR_FULL = path.join(__dirname, '..', BACKUP_DIR);

// Patch DATA_FILE for store (it uses __dirname relative paths)
storeMod.setDataPaths(DATA_FILE_FULL, IMAGE_DIR_FULL, BACKUP_DIR_FULL);

(async () => {
  ensureDirSync(BACKUP_DIR_FULL);
  ensureDirSync(IMAGE_DIR_FULL);

  await storeMod.backupCurrentJsonIfExists('startup');
  await storeMod.loadStore();

  setInterval(() => storeMod.expirePresenceAndPersistLogout(), 10000);
  setInterval(() => {
    storeMod.backupCurrentJsonIfExists('hourly').catch(err => {
      console.error('[backup] hourly backup failed:', err.message);
    });
  }, BACKUP_INTERVAL_MS);

  const interfaces = getAllLocalIPs();
  const httpServer = http.createServer(requestHandler);

  httpServer.listen(PORT, '0.0.0.0', () => {
    const receiverUrl = `http://localhost:${PORT}/receiver`;

    console.log('========================================');
    console.log(' Smart Inventory Server Running (JSON) ');
    console.log('========================================');
    console.log(` Data File : ${DATA_FILE_FULL}`);
    console.log(` Image Dir : ${IMAGE_DIR_FULL}`);
    console.log(` Backup Dir: ${BACKUP_DIR_FULL}`);
    console.log(` Receiver  : ${receiverUrl}`);
    console.log(' Access URLs (all interfaces):');

    if (!interfaces.length) {
      console.log(`   Sender:    http://127.0.0.1:${PORT}/sender`);
      console.log(`   Receiver:  http://127.0.0.1:${PORT}/receiver`);
      console.log(`   Dashboard: http://127.0.0.1:${PORT}/dashboard`);
    } else {
      interfaces.forEach((item, index) => {
        console.log(`   [${index + 1}] ${item.interface}`);
        console.log(`       Sender:    http://${item.address}:${PORT}/sender`);
        console.log(`       Receiver:  http://${item.address}:${PORT}/receiver`);
        console.log(`       Dashboard: http://${item.address}:${PORT}/dashboard`);
      });
    }

    console.log('========================================');
    openBrowser(receiverUrl);
  });
})();
