const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const { DATA_FILE, IMAGE_DIR, BACKUP_DIR } = require('./constants');
const { nowIso, ensureDirSync, fileTimestamp, normalizeFreeText } = require('./utils');

let store = null;
let cleanGeneration = 0;
let adminReceiverName = '';
let adminInitialized = false;
let storeVersion = 1;
let dashboardVersion = 1;

let saveScheduled = false;
let saveInProgress = false;
let pendingSaveAfterCurrent = false;

function createEmptyDashboardState() {
  return {
    imports: [],
    activeImportId: '',
    settings: {
      visibleColumns: [],
      importMatchColumn: '',
      inventoryMatchField: 'selectedText',
      matchMode: 'exact',
      focusRules: [{ column: '', values: [] }]
    },
    importedRows: [],
    inventoryRows: []
  };
}

function createEmptyStore() {
  return {
    meta: {
      cleanGeneration: 0,
      adminReceiverName: '',
      adminInitialized: false,
      lastSyncStatus: 'done',
      lastSyncTime: '',
      storeVersion: 1,
      dashboardVersion: 1
    },
    deviceProfiles: [],
    deletedSessions: [],
    userLogs: [],
    records: [],
    dashboard: createEmptyDashboardState()
  };
}

function normalizeDeviceProfile(profile) {
  return {
    deviceId: String((profile && profile.deviceId) || '').trim(),
    receiverId: String((profile && profile.receiverId) || '').trim(),
    userName: String((profile && profile.userName) || '').trim(),
    lastKnownMode: String((profile && profile.lastKnownMode) || '').trim(),
    lastIp: String((profile && profile.lastIp) || '').trim(),
    updatedAt: String((profile && profile.updatedAt) || nowIso()),
    fingerprint: {
      userAgent: String(profile && profile.fingerprint && profile.fingerprint.userAgent || '').trim(),
      platform: String(profile && profile.fingerprint && profile.fingerprint.platform || '').trim(),
      language: String(profile && profile.fingerprint && profile.fingerprint.language || '').trim(),
      timezone: String(profile && profile.fingerprint && profile.fingerprint.timezone || '').trim(),
      screen: String(profile && profile.fingerprint && profile.fingerprint.screen || '').trim()
    }
  };
}

function normalizeCompareValue(value) {
  return normalizeFreeText(value || '').toLowerCase();
}

function normalizeFocusValues(values, fallbackSingle = '') {
  let list = [];
  if (Array.isArray(values)) list = values;
  else if (typeof values === 'string' && values.trim()) list = values.split(/\r?\n|,/g);
  else if (fallbackSingle) list = [fallbackSingle];
  return [...new Set(list.map(x => normalizeCompareValue(x)).filter(Boolean))].slice(0, 5000);
}

function normalizeFocusRules(rules, legacySettings = {}) {
  let sourceRules = [];
  if (Array.isArray(rules)) sourceRules = rules;
  else if (legacySettings && (legacySettings.focusColumn || legacySettings.focusValues || legacySettings.focusValue)) {
    sourceRules = [{
      column: legacySettings.focusColumn || '',
      values: legacySettings.focusValues || legacySettings.focusValue || []
    }];
  }

  const normalized = sourceRules
    .map(rule => ({
      column: String(rule && rule.column || '').trim(),
      values: normalizeFocusValues(rule && rule.values || [], rule && rule.value || '')
    }))
    .filter(rule => rule.column || rule.values.length)
    .slice(0, 5);

  if (!normalized.length) normalized.push({ column: '', values: [] });
  return normalized.slice(0, 5);
}

function normalizeDashboardSettings(settings) {
  const base = createEmptyDashboardState().settings;
  const s = { ...base, ...(settings || {}) };

  if (!Array.isArray(s.visibleColumns)) s.visibleColumns = [];
  s.visibleColumns = s.visibleColumns.map(x => String(x || '')).filter(Boolean).slice(0, 10);
  s.importMatchColumn = String(s.importMatchColumn || '').trim();
  s.inventoryMatchField = String(s.inventoryMatchField || 'selectedText').trim() || 'selectedText';
  s.matchMode = String(s.matchMode || 'exact').trim().toLowerCase() === 'partial' ? 'partial' : 'exact';
  s.focusRules = normalizeFocusRules(s.focusRules, s);

  delete s.focusColumn;
  delete s.focusValue;
  delete s.focusValues;
  return s;
}

function ensureDashboardShape(dashboard) {
  const base = createEmptyDashboardState();
  const d = {
    ...base,
    ...(dashboard || {}),
    settings: normalizeDashboardSettings((dashboard && dashboard.settings) || {})
  };

  if (!Array.isArray(d.imports)) d.imports = [];
  if (!Array.isArray(d.importedRows)) d.importedRows = [];
  if (!Array.isArray(d.inventoryRows)) d.inventoryRows = [];

  d.imports = d.imports.map(item => ({
    id: item.id || `imp_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    fileName: item.fileName || '',
    importedAt: item.importedAt || nowIso(),
    columns: Array.isArray(item.columns) ? item.columns.map(x => String(x || '')) : [],
    rowCount: Number(item.rowCount || 0)
  }));

  d.importedRows = d.importedRows.map(item => ({
    id: item.id || `dimp_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    importId: item.importId || '',
    sourceIndex: Number(item.sourceIndex || 0),
    sourceData: (item.sourceData && typeof item.sourceData === 'object') ? item.sourceData : {},
    dashboardComment: item.dashboardComment || '',
    createdAt: item.createdAt || nowIso(),
    updatedAt: item.updatedAt || nowIso()
  }));

  d.inventoryRows = d.inventoryRows.map(item => ({
    id: item.id || `dinv_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    recordId: item.recordId || '',
    dashboardComment: item.dashboardComment || '',
    createdAt: item.createdAt || nowIso(),
    updatedAt: item.updatedAt || nowIso()
  }));

  return d;
}

function ensureStoreShape(data) {
  const base = createEmptyStore();
  const merged = {
    ...base,
    ...(data || {}),
    meta: { ...base.meta, ...((data && data.meta) || {}) }
  };

  if (!Array.isArray(merged.deviceProfiles)) merged.deviceProfiles = [];
  if (!Array.isArray(merged.deletedSessions)) merged.deletedSessions = [];
  if (!Array.isArray(merged.userLogs)) merged.userLogs = [];
  if (!Array.isArray(merged.records)) merged.records = [];
  merged.dashboard = ensureDashboardShape(merged.dashboard);

  merged.deviceProfiles = merged.deviceProfiles
    .map(normalizeDeviceProfile)
    .filter(x => x.deviceId || x.receiverId);

  merged.records = merged.records.map(r => ({
    id: r.id || '',
    timestamp: r.timestamp || nowIso(),
    senderName: r.senderName || '',
    deviceId: r.deviceId || '',
    recordType: (String(r.recordType || 'photo').toLowerCase() === 'scanner') ? 'scanner' : 'photo',
    selectedText: r.selectedText || '',
    selectedSourceText: r.selectedSourceText || '',
    comment: r.comment || '',
    reviewedBy: r.reviewedBy || '',
    addedBy: r.addedBy || '',
    exportedName: r.exportedName || '',
    completed: !!r.completed,
    deleted: !!r.deleted,
    isAddNew: !!r.isAddNew,
    images: Array.isArray(r.images) ? r.images.map(img => ({
      id: img.id || '',
      name: img.name || '',
      storedName: img.storedName || '',
      url: img.url || (img.storedName ? `/image/${encodeURIComponent(img.storedName)}` : ''),
      createdAt: img.createdAt || nowIso(),
      sortOrder: Number(img.sortOrder || 0)
    })) : [],
    timeline: Array.isArray(r.timeline) ? r.timeline.map(t => ({
      id: t.id || '',
      type: t.type || '',
      actorRole: t.actorRole || '',
      actorName: t.actorName || '',
      time: t.time || nowIso(),
      selectedText: t.selectedText || '',
      selectedSourceText: t.selectedSourceText || '',
      comment: t.comment || '',
      reviewedBy: t.reviewedBy || '',
      exportedName: t.exportedName || ''
    })) : []
  }));

  merged.meta.storeVersion = Number(merged.meta.storeVersion || 1);
  merged.meta.dashboardVersion = Number(merged.meta.dashboardVersion || 1);
  return merged;
}

async function loadStore() {
  ensureDirSync(IMAGE_DIR);
  if (!fs.existsSync(DATA_FILE)) {
    store = createEmptyStore();
    await writeStoreNow();
  } else {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    const parsed = raw.trim() ? JSON.parse(raw) : createEmptyStore();
    store = ensureStoreShape(parsed);
  }

  cleanGeneration = Number(store.meta.cleanGeneration || 0);
  adminReceiverName = String(store.meta.adminReceiverName || '');
  adminInitialized = !!store.meta.adminInitialized;
  storeVersion = Number(store.meta.storeVersion || 1);
  dashboardVersion = Number(store.meta.dashboardVersion || 1);
}

async function writeStoreNow() {
  const tempFile = DATA_FILE + '.tmp';
  await fsp.writeFile(tempFile, JSON.stringify(store, null, 2), 'utf8');
  await fsp.rename(tempFile, DATA_FILE);
}

function scheduleSave() {
  if (saveInProgress) {
    pendingSaveAfterCurrent = true;
    return;
  }
  if (saveScheduled) return;

  saveScheduled = true;
  setTimeout(async () => {
    saveScheduled = false;
    saveInProgress = true;
    try {
      await writeStoreNow();
    } catch (e) {
      console.error('[save] Failed to persist JSON store:', e.message);
    } finally {
      saveInProgress = false;
      if (pendingSaveAfterCurrent) {
        pendingSaveAfterCurrent = false;
        scheduleSave();
      }
    }
  }, 50);
}

function setSyncPending() {
  store.meta.lastSyncStatus = 'pending';
  store.meta.lastSyncTime = nowIso();
}

function setSyncDone() {
  store.meta.lastSyncStatus = 'done';
  store.meta.lastSyncTime = nowIso();
}

function withSync(action, opts = {}) {
  setSyncPending();
  const result = action();
  if (opts.dashboard) bumpDashboardVersion();
  if (opts.store !== false) bumpStoreVersion();
  setSyncDone();
  scheduleSave();
  return result;
}

function syncAction(action, opts = {}) {
  return withSync(action, opts);
}

function bumpStoreVersion() {
  storeVersion += 1;
  if (store && store.meta) store.meta.storeVersion = storeVersion;
}

function bumpDashboardVersion() {
  dashboardVersion += 1;
  if (store && store.meta) store.meta.dashboardVersion = dashboardVersion;
}

async function backupCurrentJsonIfExists(reason = 'startup') {
  ensureDirSync(BACKUP_DIR);
  if (!fs.existsSync(DATA_FILE)) return null;
  const backupName = `smartinventory_${fileTimestamp(new Date())}.json`;
  const backupPath = path.join(BACKUP_DIR, backupName);
  await fsp.copyFile(DATA_FILE, backupPath);
  console.log(`[backup] ${reason}: ${backupPath}`);
  return backupPath;
}

function cleanDatabaseAndImages(alertsModule) {
  return async function() {
    ensureDirSync(IMAGE_DIR);
    const files = await fsp.readdir(IMAGE_DIR).catch(() => []);
    for (const file of files) {
      const full = path.join(IMAGE_DIR, file);
      try { await fsp.unlink(full); } catch {}
    }

    syncAction(() => {
      store = createEmptyStore();
      cleanGeneration += 1;
      store.meta.cleanGeneration = cleanGeneration;
      adminReceiverName = '';
      adminInitialized = false;
      store.meta.adminReceiverName = '';
      store.meta.adminInitialized = false;
      storeVersion = 1;
      dashboardVersion = 1;
      store.meta.storeVersion = 1;
      store.meta.dashboardVersion = 1;
    }, { store: true, dashboard: true });

    if (alertsModule) {
      alertsModule.clearAll();
    }

    await writeStoreNow();
  };
}

// Getter functions to access module-level variables
function getStore() { return store; }
function getCleanGeneration() { return cleanGeneration; }
function getAdminReceiverName() { return adminReceiverName; }
function getAdminInitialized() { return adminInitialized; }
function getStoreVersion() { return storeVersion; }
function getDashboardVersion() { return dashboardVersion; }
function getSaveScheduled() { return saveScheduled; }

module.exports = {
  getStore,
  getCleanGeneration,
  getAdminReceiverName,
  getAdminInitialized,
  getStoreVersion,
  getDashboardVersion,
  getSaveScheduled,
  createEmptyStore,
  createEmptyDashboardState,
  ensureStoreShape,
  ensureDashboardShape,
  loadStore,
  writeStoreNow,
  scheduleSave,
  setSyncPending,
  setSyncDone,
  withSync,
  syncAction,
  bumpStoreVersion,
  bumpDashboardVersion,
  backupCurrentJsonIfExists,
  cleanDatabaseAndImages,
  normalizeDeviceProfile,
  normalizeCompareValue,
  normalizeFocusValues,
  normalizeFocusRules,
  normalizeDashboardSettings
};
