'use strict';

// ============================================================
// Constants
// ============================================================

const PORT = 3000;
const REVIEW_LOCK_MS = 2 * 60 * 1000;
const OFFLINE_KEEP_MS = 10 * 60 * 1000;
const ACTIVE_ONLINE_MS = 70 * 1000;
const BACKUP_INTERVAL_MS = 60 * 60 * 1000;

const DATA_FILE = 'smartinventory.json';
const IMAGE_DIR = 'image';
const BACKUP_DIR = 'backup';
const ADMIN_RECEIVER_ID = 'receiver_admin_main';

module.exports = {
  PORT,
  REVIEW_LOCK_MS,
  OFFLINE_KEEP_MS,
  ACTIVE_ONLINE_MS,
  BACKUP_INTERVAL_MS,
  DATA_FILE,
  IMAGE_DIR,
  BACKUP_DIR,
  ADMIN_RECEIVER_ID,
};
