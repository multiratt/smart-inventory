const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { URL } = require('url');


const ExcelJS = require('exceljs');
const XLSX = require('xlsx');


const PORT = 3000;
const REVIEW_LOCK_MS = 2 * 60 * 1000;
const OFFLINE_KEEP_MS = 10 * 60 * 1000;
const ACTIVE_ONLINE_MS = 70 * 1000;
const BACKUP_INTERVAL_MS = 60 * 60 * 1000;


const DATA_FILE = path.join(__dirname, 'smartinventory.json');
const IMAGE_DIR = path.join(__dirname, 'image');
const BACKUP_DIR = path.join(__dirname, 'backup');
const ADMIN_RECEIVER_ID = 'receiver_admin_main';


let store = null;
let cleanGeneration = 0;
let adminReceiverName = '';
let adminInitialized = false;
let storeVersion = 1;
let dashboardVersion = 1;


const userSessions = new Map();
const senderAlerts = new Map();
const receiverAlerts = new Map();
const reviewLocks = new Map();


const renameRequests = new Map();
const renameRequestByRequester = new Map();
const renameDecisionInbox = new Map();


let saveScheduled = false;
let saveInProgress = false;
let pendingSaveAfterCurrent = false;


function nowIso() {
  return new Date().toISOString();
}


function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}


function fileTimestamp(date = new Date()) {
  const pad = (n, size = 2) => String(n).padStart(size, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
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


function bumpStoreVersion() {
  storeVersion += 1;
  if (store && store.meta) store.meta.storeVersion = storeVersion;
}
function bumpDashboardVersion() {
  dashboardVersion += 1;
  if (store && store.meta) store.meta.dashboardVersion = dashboardVersion;
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
  rebuildDashboardInventoryRows();
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
  rebuildDashboardInventoryRows();
  if (opts.dashboard) bumpDashboardVersion();
  if (opts.store !== false) bumpStoreVersion();
  setSyncDone();
  scheduleSave();
  return result;
}
function syncAction(action, opts = {}) {
  return withSync(action, opts);
}


function getAllLocalIPs() {
  const ifaces = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) results.push({ interface: name, address: iface.address });
    }
  }
  return results;
}
function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  let ip = req.socket?.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.substring(7);
  return ip;
}
function getRequestHostName(req) {
  return String(req.headers.host || '').trim().split(':')[0].toLowerCase();
}
function isLocalDashboardHost(req) {
  const host = getRequestHostName(req);
  return host === 'localhost' || host === '127.0.0.1';
}
function getDashboardAccessMode(req) {
  return isLocalDashboardHost(req) ? 'full' : 'readonly';
}
function requireDashboardFullAccess(req, res) {
  if (getDashboardAccessMode(req) !== 'full') {
    sendJSON(res, 403, { ok: false, error: 'Read-only dashboard' });
    return false;
  }
  return true;
}


function isRawEnglishOnlyName(raw) {
  return /^[A-Za-z]+$/.test(String(raw || '').trim());
}
function normalizeUserName(raw) {
  return String(raw || '').trim().toUpperCase();
}
function normalizeFreeText(raw) {
  return String(raw || '').replace(/\r\n/g, '\n').replace(/\u00A0/g, ' ').trim();
}
function hasMeaningfulText(raw) {
  return normalizeFreeText(raw).length > 0;
}
function normalizeRecordStatus(status) {
  const s = String(status || 'all').trim().toLowerCase();
  if (s === 'pending' || s === 'completed' || s === 'all') return s;
  return 'all';
}
function normalizeRecordTypeFilter(value) {
  const s = String(value || 'all').trim().toLowerCase();
  if (s === 'photo' || s === 'scanner' || s === 'all') return s;
  return 'all';
}
function normalizePage(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}
function normalizePageSize(value, fallback = 20, max = 300) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, Math.floor(n));
}
function buildPaginationMeta(page, pageSize, total) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  return { page: safePage, pageSize, total, totalPages };
}
function paginateArray(items, page, pageSize) {
  const meta = buildPaginationMeta(page, pageSize, items.length);
  const start = (meta.page - 1) * meta.pageSize;
  const rows = items.slice(start, start + meta.pageSize);
  return { rows, ...meta };
}


function shouldPersistUserLog(type) {
  return [
    'user-login', 'user-logout', 'user-rename', 'user-rename-request', 'user-rename-accepted', 'user-rename-denied',
    'user-deleted',
    'team-message', 'team-wait', 'team-go-ahead'
  ].includes(type);
}
function pushUserLog(type, detail = {}) {
  if (!shouldPersistUserLog(type)) return false;
  store.userLogs.push({
    id: `${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    time: nowIso(),
    type,
    role: detail.role || '',
    userId: detail.userId || '',
    userName: detail.userName || '',
    fromName: detail.fromName || '',
    toName: detail.toName || '',
    deletedBy: detail.deletedBy || '',
    ip: detail.ip || '',
    targetRole: detail.targetRole || '',
    actorRole: detail.actorRole || '',
    requestOldName: detail.requestOldName || '',
    requestNewName: detail.requestNewName || ''
  });
  return true;
}


function pushRecordEvent(recordId, type, actorRole, actorName, detail = {}) {
  const record = store.records.find(r => r.id === recordId);
  if (!record) return false;


  record.timeline.push({
    id: `${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    type,
    actorRole: actorRole || '',
    actorName: actorName || '',
    time: nowIso(),
    selectedText: detail.selectedText || '',
    selectedSourceText: detail.selectedSourceText || '',
    comment: detail.comment || '',
    reviewedBy: detail.reviewedBy || '',
    exportedName: detail.exportedName || ''
  });
  return true;
}


function getSessionKey(deviceId) {
  return String(deviceId || '').trim();
}
function markDeletedSession(deviceId, userName) {
  const key = getSessionKey(deviceId);
  if (!key || !userName) return false;
  const idx = store.deletedSessions.findIndex(x => x.sessionKey === key && x.userName === userName);
  const obj = { sessionKey: key, deviceId: key, userName, time: Date.now() };
  if (idx >= 0) store.deletedSessions[idx] = obj;
  else store.deletedSessions.push(obj);
  return true;
}
function clearDeletedSession(deviceId, userName = '') {
  const key = getSessionKey(deviceId);
  const cleanName = String(userName || '').trim();
  if (!key) return false;


  const before = store.deletedSessions.length;
  store.deletedSessions = store.deletedSessions.filter(x => {
    if (x.deviceId !== key) return true;
    if (!cleanName) return false;
    return x.userName !== cleanName;
  });
  return before !== store.deletedSessions.length;
}
function isDeletedSession(deviceId, userName) {
  const key = getSessionKey(deviceId);
  return store.deletedSessions.some(x => x.sessionKey === key && x.userName === userName);
}
function isAdminReceiverId(receiverId) {
  return String(receiverId || '').trim() === ADMIN_RECEIVER_ID;
}
function normalizeReceiverId(receiverId, req) {
  const clean = String(receiverId || '').trim();
  if (clean) return clean;
  return `receiver_${getClientIP(req) || 'unknown'}`;
}
function getPresenceKeyByRoleId(role, id) {
  return `${role}:${id}`;
}
function normalizeProfileMode(mode) {
  const m = String(mode || '').trim().toLowerCase();
  if (m === 'admin' || m === 'receiver' || m === 'dashboard' || m === 'sender') return m;
  return '';
}
function isCompatibleMode(profileMode, requestedMode) {
  const a = normalizeProfileMode(profileMode);
  const b = normalizeProfileMode(requestedMode);
  if (!a || !b) return false;
  if (a === b) return true;
  if ((a === 'admin' && b === 'dashboard') || (a === 'dashboard' && b === 'admin')) return true;
  return false;
}
function getEffectiveSessionRole(session) {
  if (!session) return 'sender';
  if (session.isAdmin) return 'admin';
  if (session.currentMode === 'dashboard') return 'admin';
  if (session.currentMode === 'receiver') return 'receiver';
  return 'sender';
}
function isEffectiveAdminSession(session) {
  return getEffectiveSessionRole(session) === 'admin';
}
function getUserSessionByName(name, exclude = {}) {
  const cleanName = normalizeUserName(name);
  if (!cleanName) return null;


  for (const s of userSessions.values()) {
    if (s.userName === cleanName) {
      if (exclude.deviceId && exclude.deviceId === s.deviceId) continue;
      if (exclude.allowSameDevice && exclude.deviceId && exclude.deviceId === s.deviceId) continue;
      return s;
    }
  }


  if (adminInitialized && adminReceiverName === cleanName) {
    if (!(exclude.deviceId && exclude.deviceId === ADMIN_RECEIVER_ID)) {
      return {
        userName: cleanName,
        deviceId: ADMIN_RECEIVER_ID,
        currentMode: 'admin',
        currentReceiverId: ADMIN_RECEIVER_ID,
        isAdmin: true,
        lastSeen: Date.now()
      };
    }
  }
  return null;
}
function getRoleIcon(role) {
  if (role === 'admin') return '👑';
  if (role === 'receiver') return '📥';
  return '📤';
}
function getActiveUsers() {
  const now = Date.now();
  const byName = new Map();


  for (const s of userSessions.values()) {
    if ((now - Number(s.lastSeen || 0)) > OFFLINE_KEEP_MS) continue;


    const role = getEffectiveSessionRole(s);
    const nameKey = normalizeUserName(s.userName || '');
    if (!nameKey) continue;


    const senderAlert = senderAlerts.get(nameKey);
    const receiverAlert = s.currentReceiverId ? receiverAlerts.get(s.currentReceiverId) : null;


    const row = {
      id: role === 'admin' ? ADMIN_RECEIVER_ID : s.deviceId,
      receiverId: role === 'admin' ? ADMIN_RECEIVER_ID : (s.currentReceiverId || ''),
      name: role === 'admin' ? (adminReceiverName || s.userName) : s.userName,
      role,
      icon: getRoleIcon(role),
      online: (now - Number(s.lastSeen || 0)) <= ACTIVE_ONLINE_MS,
      waiting: !!(
        (senderAlert && String(senderAlert.message || '').trim().toLowerCase() === 'wait') ||
        (receiverAlert && String(receiverAlert.message || '').trim().toLowerCase() === 'wait')
      ),
      lastSeen: Number(s.lastSeen || 0)
    };


    const existing = byName.get(nameKey);
    if (!existing) {
      byName.set(nameKey, row);
      continue;
    }
    const existingPriority = existing.role === 'admin' ? 3 : existing.role === 'receiver' ? 2 : 1;
    const rowPriority = row.role === 'admin' ? 3 : row.role === 'receiver' ? 2 : 1;


    if (rowPriority > existingPriority || row.lastSeen >= existing.lastSeen) byName.set(nameKey, row);
  }


  if (adminInitialized && adminReceiverName) {
    const adminKey = normalizeUserName(adminReceiverName);
    const existing = byName.get(adminKey);
    if (!existing || existing.role !== 'admin') {
      byName.set(adminKey, {
        id: ADMIN_RECEIVER_ID,
        receiverId: ADMIN_RECEIVER_ID,
        name: adminReceiverName,
        role: 'admin',
        icon: getRoleIcon('admin'),
        online: !![...userSessions.values()].find(x => isEffectiveAdminSession(x)),
        waiting: !!(receiverAlerts.get(ADMIN_RECEIVER_ID) && String(receiverAlerts.get(ADMIN_RECEIVER_ID).message || '').trim().toLowerCase() === 'wait'),
        lastSeen: existing ? existing.lastSeen : 0
      });
    }
  }


  return [...byName.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}


function extractFingerprint(req, provided = {}) {
  return {
    userAgent: String(provided.userAgent || req.headers['user-agent'] || '').trim(),
    platform: String(provided.platform || '').trim(),
    language: String(provided.language || '').trim(),
    timezone: String(provided.timezone || '').trim(),
    screen: String(provided.screen || '').trim()
  };
}
function findDeviceProfile({ deviceId = '', receiverId = '', mode = '' }) {
  const cleanDeviceId = String(deviceId || '').trim();
  const cleanReceiverId = String(receiverId || '').trim();
  const cleanMode = normalizeProfileMode(mode);


  if (cleanDeviceId) {
    const byDevice = store.deviceProfiles.find(x => x.deviceId === cleanDeviceId && (!cleanMode || isCompatibleMode(x.lastKnownMode, cleanMode)));
    if (byDevice) return byDevice;
    const byDeviceAny = store.deviceProfiles.find(x => x.deviceId === cleanDeviceId);
    if (byDeviceAny) return byDeviceAny;
  }


  if (cleanReceiverId) {
    const byReceiver = store.deviceProfiles.find(x => x.receiverId === cleanReceiverId && (!cleanMode || isCompatibleMode(x.lastKnownMode, cleanMode)));
    if (byReceiver) return byReceiver;
    const byReceiverAny = store.deviceProfiles.find(x => x.receiverId === cleanReceiverId);
    if (byReceiverAny) return byReceiverAny;
  }
  return null;
}
function upsertDeviceProfile({ deviceId = '', receiverId = '', userName = '', mode = '', req = null, fingerprint = {} }) {
  const cleanDeviceId = String(deviceId || '').trim();
  const cleanReceiverId = String(receiverId || '').trim();
  const cleanUserName = normalizeUserName(userName || '');
  const cleanMode = normalizeProfileMode(mode || '');
  if (!cleanDeviceId && !cleanReceiverId) return { profile: null, changed: false };
  if (!cleanUserName) return { profile: null, changed: false };


  let profile = findDeviceProfile({ deviceId: cleanDeviceId, receiverId: cleanReceiverId, mode: cleanMode });
  const mergedFingerprint = extractFingerprint(req || { headers: {} }, fingerprint || {});
  const ip = req ? getClientIP(req) : '';


  if (!profile) {
    profile = normalizeDeviceProfile({
      deviceId: cleanDeviceId,
      receiverId: cleanReceiverId,
      userName: cleanUserName,
      lastKnownMode: cleanMode,
      lastIp: ip,
      updatedAt: nowIso(),
      fingerprint: mergedFingerprint
    });
    store.deviceProfiles.push(profile);
    return { profile, changed: true };
  }


  const changed = (
    profile.deviceId !== (cleanDeviceId || profile.deviceId) ||
    profile.receiverId !== (cleanReceiverId || profile.receiverId) ||
    profile.userName !== cleanUserName ||
    profile.lastKnownMode !== (cleanMode || profile.lastKnownMode || '') ||
    profile.lastIp !== (ip || profile.lastIp || '') ||
    profile.fingerprint.userAgent !== (mergedFingerprint.userAgent || profile.fingerprint.userAgent || '') ||
    profile.fingerprint.platform !== (mergedFingerprint.platform || profile.fingerprint.platform || '') ||
    profile.fingerprint.language !== (mergedFingerprint.language || profile.fingerprint.language || '') ||
    profile.fingerprint.timezone !== (mergedFingerprint.timezone || profile.fingerprint.timezone || '') ||
    profile.fingerprint.screen !== (mergedFingerprint.screen || profile.fingerprint.screen || '')
  );


  if (!changed) return { profile, changed: false };


  profile.deviceId = cleanDeviceId || profile.deviceId;
  profile.receiverId = cleanReceiverId || profile.receiverId;
  profile.userName = cleanUserName;
  profile.lastKnownMode = cleanMode || profile.lastKnownMode || '';
  profile.lastIp = ip || profile.lastIp || '';
  profile.updatedAt = nowIso();
  profile.fingerprint = {
    userAgent: mergedFingerprint.userAgent || profile.fingerprint.userAgent || '',
    platform: mergedFingerprint.platform || profile.fingerprint.platform || '',
    language: mergedFingerprint.language || profile.fingerprint.language || '',
    timezone: mergedFingerprint.timezone || profile.fingerprint.timezone || '',
    screen: mergedFingerprint.screen || profile.fingerprint.screen || ''
  };


  return { profile, changed: true };
}
function getRememberedIdentity({ deviceId = '', receiverId = '', mode = '' }) {
  const profile = findDeviceProfile({ deviceId, receiverId, mode });
  if (!profile) return null;
  return {
    deviceId: profile.deviceId || '',
    receiverId: profile.receiverId || '',
    userName: profile.userName || '',
    lastKnownMode: profile.lastKnownMode || '',
    updatedAt: profile.updatedAt || ''
  };
}
function renameDeviceProfiles(oldName, newName, requesterId = '') {
  const cleanOld = normalizeUserName(oldName || '');
  const cleanNew = normalizeUserName(newName || '');
  if (!cleanOld || !cleanNew || cleanOld === cleanNew) return false;


  let changed = false;
  store.deviceProfiles.forEach(profile => {
    if (profile.userName === cleanOld) {
      if (!requesterId || profile.deviceId === requesterId || profile.receiverId === requesterId || profile.deviceId === ADMIN_RECEIVER_ID || profile.receiverId === ADMIN_RECEIVER_ID) {
        profile.userName = cleanNew;
        profile.updatedAt = nowIso();
        changed = true;
      }
    }
  });
  return changed;
}


function registerUserMode(req, userName, deviceId, mode, receiverId = '', fingerprint = {}, options = {}) {
  const ip = getClientIP(req);
  const cleanName = normalizeUserName(userName);
  const cleanDeviceId = String(deviceId || '').trim() || (ip || cleanName);
  const cleanMode = normalizeProfileMode(mode) || 'sender';
  if (!cleanName || !cleanDeviceId) return null;


  let changed = false;
  const removedDeleted = clearDeletedSession(cleanDeviceId, cleanName);
  if (removedDeleted) changed = true;


  const profileResult = upsertDeviceProfile({ deviceId: cleanDeviceId, receiverId: receiverId || '', userName: cleanName, mode: cleanMode, req, fingerprint });
  if (profileResult.changed) changed = true;


  const existing = userSessions.get(cleanDeviceId);
  const now = Date.now();


  if (existing) {
    const previousMode = existing.currentMode;
    const previousName = existing.userName;
    const previousReceiverId = existing.currentReceiverId || '';
    const previousAdmin = !!existing.isAdmin;


    existing.userName = cleanName;
    existing.ip = ip || existing.ip || '';
    existing.lastSeen = now;
    existing.lastActive = now;
    existing.currentMode = cleanMode;
    if (receiverId) existing.currentReceiverId = receiverId;
    existing.isAdmin = cleanMode === 'admin' || cleanMode === 'dashboard';


    if (
      previousMode !== cleanMode ||
      previousName !== cleanName ||
      previousReceiverId !== (receiverId || previousReceiverId) ||
      previousAdmin !== existing.isAdmin
    ) changed = true;


    if (!options.silentLog && (!previousMode || previousMode !== cleanMode)) {
      if (pushUserLog('user-login', {
        role: cleanMode === 'dashboard' ? 'admin' : cleanMode,
        userId: cleanDeviceId,
        userName: cleanName,
        ip
      })) changed = true;
    }


    if (changed) {
      setSyncPending(); bumpStoreVersion(); setSyncDone(); scheduleSave();
    }
    return existing;
  }


  const session = {
    userName: cleanName,
    deviceId: cleanDeviceId,
    ip,
    firstSeen: now,
    lastSeen: now,
    lastActive: now,
    currentMode: cleanMode,
    currentReceiverId: receiverId || '',
    isAdmin: cleanMode === 'admin' || cleanMode === 'dashboard'
  };


  userSessions.set(cleanDeviceId, session);
  changed = true;


  if (!options.silentLog) {
    if (pushUserLog('user-login', {
      role: cleanMode === 'dashboard' ? 'admin' : cleanMode,
      userId: cleanDeviceId,
      userName: cleanName,
      ip
    })) changed = true;
  }


  if (changed) {
    setSyncPending(); bumpStoreVersion(); setSyncDone(); scheduleSave();
  }
  return session;
}
function touchUserHeartbeat(req, userName, deviceId, mode, receiverId = '', fingerprint = {}) {
  const ip = getClientIP(req);
  const cleanName = normalizeUserName(userName);
  const cleanDeviceId = String(deviceId || '').trim() || (ip || cleanName);
  const cleanMode = normalizeProfileMode(mode) || 'sender';
  if (!cleanName || !cleanDeviceId) return null;


  const existing = userSessions.get(cleanDeviceId);
  const now = Date.now();


  if (existing) {
    existing.lastSeen = now;
    existing.lastActive = now;
    existing.ip = ip || existing.ip || '';
    existing.userName = cleanName;
    existing.currentMode = cleanMode;
    if (receiverId) existing.currentReceiverId = receiverId;
    existing.isAdmin = cleanMode === 'admin' || cleanMode === 'dashboard';
  } else {
    userSessions.set(cleanDeviceId, {
      userName: cleanName,
      deviceId: cleanDeviceId,
      ip,
      firstSeen: now,
      lastSeen: now,
      lastActive: now,
      currentMode: cleanMode,
      currentReceiverId: receiverId || '',
      isAdmin: cleanMode === 'admin' || cleanMode === 'dashboard'
    });
  }


  const profileResult = upsertDeviceProfile({ deviceId: cleanDeviceId, receiverId: receiverId || '', userName: cleanName, mode: cleanMode, req, fingerprint });
  if (profileResult.changed) {
    setSyncPending(); bumpStoreVersion(); setSyncDone(); scheduleSave();
  }
  return userSessions.get(cleanDeviceId);
}
function expirePresenceAndPersistLogout() {
  const now = Date.now();
  let changed = false;


  for (const [deviceId, s] of [...userSessions.entries()]) {
    if ((now - Number(s.lastSeen || 0)) > OFFLINE_KEEP_MS) {
      if (pushUserLog('user-logout', {
        role: s.isAdmin ? 'admin' : (s.currentMode || 'sender'),
        userId: deviceId,
        userName: s.userName || '',
        ip: s.ip || ''
      })) changed = true;
      userSessions.delete(deviceId);
      changed = true;
    }
  }


  if (changed) {
    setSyncPending(); bumpStoreVersion(); setSyncDone(); scheduleSave();
  }
}


function isUserNameDuplicate(name, deviceId = '', mode = '') {
  const cleanName = normalizeUserName(name);
  const cleanDeviceId = String(deviceId || '').trim();
  const cleanMode = normalizeProfileMode(mode || '');
  if (!cleanName) return false;


  if ((cleanMode === 'admin' || cleanMode === 'dashboard') && adminInitialized && adminReceiverName === cleanName) return false;
  const profile = findDeviceProfile({ deviceId: cleanDeviceId, receiverId: cleanDeviceId, mode: cleanMode });
  if (profile && profile.userName === cleanName) return false;


  const owner = getUserSessionByName(cleanName, { deviceId: cleanDeviceId, allowSameDevice: true });
  if (!owner) return false;
  if (cleanDeviceId && owner.deviceId === cleanDeviceId) return false;
  if ((cleanMode === 'admin' || cleanMode === 'dashboard') && owner.isAdmin) return false;
  return true;
}


function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}
function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}


function sanitizeFileName(name) {
  return String(name || 'export')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'export';
}
function formatDateForFile(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
function formatCsvDateTime(iso) {
  try { return new Date(iso).toLocaleString('en-GB'); } catch { return iso || ''; }
}


function getRecordById(recordId, includeImages = true) {
  const record = store.records.find(r => r.id === recordId);
  if (!record) return null;


  return {
    ok: true,
    id: record.id,
    timestamp: record.timestamp,
    senderName: record.senderName,
    deviceId: record.deviceId,
    recordType: record.recordType,
    selectedText: record.selectedText || '',
    selectedSourceText: record.selectedSourceText || '',
    comment: record.comment || '',
    reviewedBy: record.reviewedBy || '',
    addedBy: record.addedBy || '',
    exportedName: record.exportedName || '',
    completed: !!record.completed,
    deleted: !!record.deleted,
    isAddNew: !!record.isAddNew,
    images: includeImages ? (record.images || []).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map(img => ({
      id: img.id,
      name: img.name,
      storedName: img.storedName,
      url: img.url || `/image/${encodeURIComponent(img.storedName)}`
    })) : [],
    timeline: (record.timeline || []).slice().sort((a, b) => String(a.time).localeCompare(String(b.time))).map(t => ({
      id: t.id,
      type: t.type,
      actorRole: t.actorRole,
      actorName: t.actorName,
      time: t.time,
      selectedText: t.selectedText || '',
      selectedSourceText: t.selectedSourceText || '',
      comment: t.comment || '',
      reviewedBy: t.reviewedBy || '',
      exportedName: t.exportedName || ''
    }))
  };
}


function getReviewLock(recordId) {
  const lock = reviewLocks.get(recordId);
  if (!lock) return null;
  if (Date.now() - lock.time > REVIEW_LOCK_MS) {
    reviewLocks.delete(recordId);
    return null;
  }
  return lock;
}
function claimReviewLock(recordId, receiverId, receiverName) {
  const current = getReviewLock(recordId);
  if (current && current.receiverId !== receiverId) return { ok: false, lock: current };
  const next = { recordId, receiverId, receiverName, time: Date.now() };
  reviewLocks.set(recordId, next);
  return { ok: true, lock: next };
}
function releaseReviewLock(recordId, receiverId) {
  const current = getReviewLock(recordId);
  if (!current) return true;
  if (current.receiverId !== receiverId) return false;
  reviewLocks.delete(recordId);
  return true;
}


function buildRecordSummaryItems(rows) {
  return rows.map(r => ({
    id: r.id,
    timestamp: r.timestamp,
    senderName: r.senderName,
    deviceId: r.deviceId,
    recordType: r.recordType,
    selectedText: r.selectedText || '',
    selectedSourceText: r.selectedSourceText || '',
    comment: r.comment || '',
    reviewedBy: r.reviewedBy || '',
    addedBy: r.addedBy || '',
    exportedName: r.exportedName || '',
    completed: !!r.completed,
    deleted: !!r.deleted,
    isAddNew: !!r.isAddNew,
    foundInDashboard: isRecordFoundInDashboard(r.id),
    ownRecordBlocked: false,
    reviewLock: getReviewLock(r.id),
    images: (r.images || []).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map(img => ({
      id: img.id,
      name: img.name,
      storedName: img.storedName,
      url: img.url || `/image/${encodeURIComponent(img.storedName)}`
    }))
  }));
}


function recordMatchesSearch(record, search) {
  const keyword = normalizeFreeText(search || '').toLowerCase();
  if (!keyword) return true;
  const fields = [
    record.id, record.senderName, record.recordType, record.selectedText, record.selectedSourceText,
    record.comment, record.reviewedBy, record.addedBy, record.exportedName, record.isAddNew ? 'add new' : '',
    ...(Array.isArray(record.images) ? record.images.map(img => img.name || '') : [])
  ];
  return fields.some(v => String(v || '').toLowerCase().includes(keyword));
}
function getFilteredRecords(query = {}) {
  const status = normalizeRecordStatus(query.status);
  const recordType = normalizeRecordTypeFilter(query.recordType);
  const senderName = query.senderName ? normalizeUserName(query.senderName) : '';
  const search = query.search || '';


  let items = store.records.filter(r => !r.deleted);
  if (status === 'pending') items = items.filter(r => !r.completed);
  if (status === 'completed') items = items.filter(r => !!r.completed);
  if (recordType !== 'all') items = items.filter(r => r.recordType === recordType);
  if (senderName) items = items.filter(r => r.senderName === senderName);
  if (search) items = items.filter(r => recordMatchesSearch(r, search));
  items.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return items;
}
function getRecordsPage(query = {}) {
  const page = normalizePage(query.page, 1);
  const pageSize = normalizePageSize(query.pageSize, 20, 200);
  const filtered = getFilteredRecords(query);
  const result = paginateArray(filtered, page, pageSize);


  return {
    ok: true,
    items: buildRecordSummaryItems(result.rows),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    totalPages: result.totalPages,
    version: storeVersion
  };
}


function getActivityLogsPage(query = {}) {
  const page = normalizePage(query.page, 1);
  const pageSize = normalizePageSize(query.pageSize, 50, 300);
  const search = normalizeFreeText(query.search || '').toLowerCase();
  const action = normalizeFreeText(query.action || '');
  const recordType = normalizeRecordTypeFilter(query.recordType);


  const logs = [];
  for (const record of store.records) {
    for (const t of (record.timeline || [])) {
      logs.push({
        recordId: record.id,
        type: t.type || '',
        actorRole: t.actorRole || '',
        actorName: t.actorName || '',
        senderName: record.senderName || '',
        recordType: record.recordType || '',
        selectedText: t.selectedText || '',
        selectedSourceText: t.selectedSourceText || '',
        comment: t.comment || '',
        reviewedBy: t.reviewedBy || '',
        exportedName: t.exportedName || '',
        dateTime: t.time || '',
        fileName: (record.images || []).map(x => x.name).join(' | ') || '-'
      });
    }
  }


  let filtered = logs;
  if (action) filtered = filtered.filter(x => x.type === action);
  if (recordType !== 'all') filtered = filtered.filter(x => x.recordType === recordType);
  if (search) {
    filtered = filtered.filter(x => [
      x.recordId, x.type, x.actorRole, x.actorName, x.senderName, x.recordType,
      x.selectedText, x.selectedSourceText, x.comment, x.reviewedBy, x.exportedName, x.fileName
    ].some(v => String(v || '').toLowerCase().includes(search)));
  }


  filtered.sort((a, b) => String(b.dateTime).localeCompare(String(a.dateTime)));
  const result = paginateArray(filtered, page, pageSize);
  return { ok: true, items: result.rows, page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages, version: storeVersion };
}


function getUserLogsPage(query = {}) {
  const page = normalizePage(query.page, 1);
  const pageSize = normalizePageSize(query.pageSize, 50, 300);
  const search = normalizeFreeText(query.search || '').toLowerCase();
  const type = normalizeFreeText(query.type || '');
  const role = normalizeFreeText(query.role || '');


  let items = store.userLogs.slice().filter(x => x.role !== 'dashboard');
  if (type) items = items.filter(x => x.type === type);
  if (role) items = items.filter(x => x.role === role);
  if (search) {
    items = items.filter(x => [
      x.id, x.type, x.role, x.userId, x.userName, x.fromName, x.toName,
      x.deletedBy, x.ip, x.targetRole, x.actorRole, x.requestOldName, x.requestNewName
    ].some(v => String(v || '').toLowerCase().includes(search)));
  }


  items.sort((a, b) => String(b.time).localeCompare(String(a.time)));
  const result = paginateArray(items, page, pageSize);
  return { ok: true, items: result.rows, page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages, version: storeVersion };
}


async function saveBase64ImageToFile(dataUrl, fallbackName) {
  const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid image data');


  const mime = match[1];
  const ext = mime.includes('png') ? 'png' : 'jpg';
  const storedName = `${Date.now()}_${Math.floor(Math.random() * 100000)}.${ext}`;
  const outputPath = path.join(IMAGE_DIR, storedName);
  await fsp.writeFile(outputPath, Buffer.from(match[2], 'base64'));


  return { storedName, fileName: fallbackName || storedName };
}


function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  if (platform === 'win32') cmd = `start "" "${url}"`;
  else if (platform === 'darwin') cmd = `open "${url}"`;
  else cmd = `xdg-open "${url}"`;
  exec(cmd, () => {});
}


async function buildWorkbookBuffer(sheetName, columns, rows, title) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smart Inventory';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });


  ws.columns = columns.map(c => ({
    header: c.header,
    key: c.key,
    width: c.width || Math.max(14, String(c.header || '').length + 4)
  }));


  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E78' } };
  ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  ws.getRow(1).height = 22;


  for (const row of rows) ws.addRow(row);


  ws.eachRow((row, rowNumber) => {
    row.alignment = { vertical: 'top', wrapText: true };
    if (rowNumber > 1 && rowNumber % 2 === 0) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7FBFF' } };
    }
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'D9E2F3' } },
        left: { style: 'thin', color: { argb: 'D9E2F3' } },
        bottom: { style: 'thin', color: { argb: 'D9E2F3' } },
        right: { style: 'thin', color: { argb: 'D9E2F3' } }
      };
    });
  });


  if (columns.length <= 26) {
    ws.autoFilter = { from: 'A1', to: String.fromCharCode(64 + columns.length) + '1' };
  }


  ws.pageSetup.orientation = 'landscape';
  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;


  if (title) ws.headerFooter.oddHeader = `&C&"Arial,Bold"${title}`;
  return await wb.xlsx.writeBuffer();
}


async function buildExportWorkbookForRole(requesterRole) {
  const completedRows = store.records.filter(r => r.completed && !r.deleted).slice().sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smart Inventory';
  wb.created = new Date();


  const summaryColumns = [
    { header: 'ID', key: 'id', width: 24 },
    { header: 'Timestamp', key: 'timestamp', width: 22 },
    { header: 'Sender Name', key: 'senderName', width: 18 },
    { header: 'Record Type', key: 'recordType', width: 14 },
    { header: 'Selected Text', key: 'selectedText', width: 32 },
    { header: 'Source Text', key: 'selectedSourceText', width: 32 },
    { header: 'Comment', key: 'comment', width: 24 },
    { header: 'Reviewed By', key: 'reviewedBy', width: 18 },
    { header: 'Added By', key: 'addedBy', width: 18 },
    { header: 'Add New', key: 'isAddNew', width: 14 },
    { header: 'Found In Import', key: 'foundInDashboard', width: 16 },
    { header: 'Exported Name', key: 'exportedName', width: 34 },
    { header: 'Completed', key: 'completed', width: 12 },
    { header: 'Image Names', key: 'imageNames', width: 44 }
  ];


  const summaryRows = completedRows.map(row => ({
    id: row.id,
    timestamp: formatCsvDateTime(row.timestamp),
    senderName: row.senderName || '',
    recordType: row.recordType || '',
    selectedText: row.selectedText || '',
    selectedSourceText: row.selectedSourceText || '',
    comment: row.comment || '',
    reviewedBy: row.reviewedBy || '',
    addedBy: row.addedBy || '',
    isAddNew: row.isAddNew ? 'yes' : 'no',
    foundInDashboard: isRecordFoundInDashboard(row.id) ? 'yes' : 'no',
    exportedName: row.exportedName || '',
    completed: row.completed ? 'true' : 'false',
    imageNames: (row.images || []).map(x => x.name).join(' | ')
  }));


  const summarySheet = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  summarySheet.columns = summaryColumns.map(c => ({ header: c.header, key: c.key, width: c.width }));
  summaryRows.forEach(r => summarySheet.addRow(r));


  if (requesterRole === 'admin') {
    const activityLogs = getActivityLogsPage({ page: 1, pageSize: 100000000 }).items.slice().reverse();
    const wsA = wb.addWorksheet('Activity Log', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsA.columns = [
      { header: 'Date Time', key: 'dateTime', width: 22 },
      { header: 'Record ID', key: 'recordId', width: 24 },
      { header: 'Action', key: 'type', width: 18 },
      { header: 'Actor Role', key: 'actorRole', width: 14 },
      { header: 'Actor Name', key: 'actorName', width: 18 },
      { header: 'Record Type', key: 'recordType', width: 14 },
      { header: 'Sender Name', key: 'senderName', width: 18 },
      { header: 'Selected Text', key: 'selectedText', width: 32 },
      { header: 'Source Text', key: 'selectedSourceText', width: 32 },
      { header: 'Comment', key: 'comment', width: 24 },
      { header: 'Reviewed By', key: 'reviewedBy', width: 18 },
      { header: 'Exported Name', key: 'exportedName', width: 34 },
      { header: 'File Name', key: 'fileName', width: 40 }
    ];
    activityLogs.forEach(x => wsA.addRow({ ...x, dateTime: formatCsvDateTime(x.dateTime) }));


    const userLogs = getUserLogsPage({ page: 1, pageSize: 100000000 }).items.slice().reverse();
    const wsU = wb.addWorksheet('User Log', { views: [{ state: 'frozen', ySplit: 1 }] });
    wsU.columns = [
      { header: 'Date Time', key: 'time', width: 22 },
      { header: 'Action', key: 'type', width: 20 },
      { header: 'Role', key: 'role', width: 12 },
      { header: 'User ID', key: 'userId', width: 24 },
      { header: 'User Name', key: 'userName', width: 18 },
      { header: 'From Name', key: 'fromName', width: 18 },
      { header: 'To Name', key: 'toName', width: 18 },
      { header: 'Target Role', key: 'targetRole', width: 14 },
      { header: 'Deleted By', key: 'deletedBy', width: 18 },
      { header: 'IP', key: 'ip', width: 18 },
      { header: 'Requested Old Name', key: 'requestOldName', width: 20 },
      { header: 'Requested New Name', key: 'requestNewName', width: 20 }
    ];
    userLogs.forEach(x => wsU.addRow({ ...x, time: formatCsvDateTime(x.time) }));
  }


  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `summary_${formatDateForFile(nowIso())}.xlsx`;
  return { buffer: Buffer.from(buffer), fileName };
}


function requestBody(req, limit = 120 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
function requestBuffer(req, limit = 120 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}


function parseMultipartForm(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) throw new Error('Multipart boundary not found');
  const boundary = '--' + (match[1] || match[2]);


  const text = buffer.toString('binary');
  const parts = text.split(boundary).slice(1, -1);
  const result = [];


  for (const part of parts) {
    const cleaned = part.replace(/^\r\n/, '').replace(/\r\n$/, '');
    const sepIndex = cleaned.indexOf('\r\n\r\n');
    if (sepIndex < 0) continue;


    const rawHeaders = cleaned.slice(0, sepIndex);
    const bodyBinary = cleaned.slice(sepIndex + 4);
    const headers = {};


    rawHeaders.split('\r\n').forEach(line => {
      const idx = line.indexOf(':');
      if (idx > -1) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    });


    const cd = headers['content-disposition'] || '';
    const nameMatch = /name="([^"]+)"/i.exec(cd);
    const fileMatch = /filename="([^"]*)"/i.exec(cd);


    result.push({
      fieldName: nameMatch ? nameMatch[1] : '',
      fileName: fileMatch ? fileMatch[1] : '',
      contentType: headers['content-type'] || '',
      data: Buffer.from(bodyBinary, 'binary')
    });
  }
  return result;
}


function stringifyCellValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.result !== 'undefined') return String(value.result);
    if (typeof value.richText !== 'undefined' && Array.isArray(value.richText)) return value.richText.map(x => x && x.text ? x.text : '').join('');
    if (typeof value.formula !== 'undefined' && typeof value.result !== 'undefined') return String(value.result ?? '');
    if (typeof value.hyperlink === 'string' && typeof value.text === 'string') return value.text;
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}
function parseCsvText(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;


  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];


    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
      continue;
    }


    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (ch === '\r') continue;
    cell += ch;
  }


  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}
function parseWorksheetToObjects(rowsArray) {
  if (!Array.isArray(rowsArray) || !rowsArray.length) throw new Error('Worksheet is empty');


  const headerRow = rowsArray[0] || [];
  const headers = headerRow.map((x, i) => String(x == null ? '' : x).trim() || `Column${i + 1}`);
  if (!headers.length) throw new Error('Worksheet header is empty');


  const dataRows = rowsArray.slice(1).map(row => {
    const arr = Array.isArray(row) ? row : [];
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = String(arr[idx] == null ? '' : arr[idx]); });
    return obj;
  }).filter(obj => Object.values(obj).some(v => String(v || '').trim() !== ''));


  return { columns: headers, rows: dataRows };
}
async function parseWorkbookWithExcelJS(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = Array.isArray(wb.worksheets) && wb.worksheets.length ? wb.worksheets[0] : null;
  if (!ws) throw new Error('Workbook has no readable worksheet');


  const firstRow = ws.getRow(1);
  const headers = [];
  const maxCol = Math.max(firstRow.cellCount || 0, firstRow.actualCellCount || 0);


  for (let colNumber = 1; colNumber <= maxCol; colNumber++) {
    const cell = firstRow.getCell(colNumber);
    const raw = cell && typeof cell.text !== 'undefined' && cell.text !== '' ? cell.text : stringifyCellValue(cell ? cell.value : '');
    headers[colNumber - 1] = String(raw || '').trim() || `Column${colNumber}`;
  }


  if (!headers.length) throw new Error('Worksheet header is empty');


  const dataRows = [];
  const totalRows = ws.rowCount || ws.actualRowCount || 0;


  for (let rowNumber = 2; rowNumber <= totalRows; rowNumber++) {
    const row = ws.getRow(rowNumber);
    const obj = {};
    let hasAny = false;


    for (let idx = 0; idx < headers.length; idx++) {
      const cell = row.getCell(idx + 1);
      const raw = cell && typeof cell.text !== 'undefined' && cell.text !== '' ? cell.text : stringifyCellValue(cell ? cell.value : '');
      const str = String(raw ?? '');
      obj[headers[idx]] = str;
      if (str.trim() !== '') hasAny = true;
    }


    if (hasAny) dataRows.push(obj);
  }


  return { columns: headers, rows: dataRows };
}
function parseWorkbookWithXLSX(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
  if (!wb || !Array.isArray(wb.SheetNames) || !wb.SheetNames.length) throw new Error('Workbook has no readable worksheet');
  const firstSheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[firstSheetName];
  if (!sheet) throw new Error('Workbook has no readable worksheet');


  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  return parseWorksheetToObjects(rows);
}
async function parseDashboardImportPayload(fileName, buffer) {
  const ext = path.extname(String(fileName || '')).toLowerCase();


  if (ext === '.csv') {
    const text = buffer.toString('utf8');
    const rows = parseCsvText(text);
    if (!rows.length) throw new Error('CSV is empty');
    const headers = rows[0].map((x, i) => String(x || '').trim() || `Column${i + 1}`);
    const dataRows = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = String(row[idx] ?? ''); });
      return obj;
    }).filter(obj => Object.values(obj).some(v => String(v || '').trim() !== ''));
    return { columns: headers, rows: dataRows };
  }


  if (ext === '.xlsx' || ext === '.xlsm') {
    try { return await parseWorkbookWithExcelJS(buffer); }
    catch (e1) {
      try { return parseWorkbookWithXLSX(buffer); }
      catch (e2) { throw new Error(`Cannot read workbook: ${e2.message || e1.message || 'Unknown error'}`); }
    }
  }


  if (ext === '.xls') {
    try { return parseWorkbookWithXLSX(buffer); }
    catch (e) { throw new Error(`Cannot read workbook: ${e.message || 'Unsupported XLS structure'}`); }
  }


  throw new Error('Only CSV, XLSX, XLSM, and XLS are supported');
}


function getInventoryMatchableFields() {
  return ['id', 'senderName', 'recordType', 'selectedText', 'selectedSourceText', 'comment', 'reviewedBy', 'timestamp', 'exportedName'];
}
function getInventoryFieldValue(record, field) {
  switch (field) {
    case 'id': return record.id || '';
    case 'senderName': return record.senderName || '';
    case 'recordType': return record.recordType || '';
    case 'selectedText': return record.selectedText || '';
    case 'selectedSourceText': return record.selectedSourceText || '';
    case 'comment': return record.comment || '';
    case 'reviewedBy': return record.reviewedBy || '';
    case 'timestamp': return record.timestamp || '';
    case 'exportedName': return record.exportedName || '';
    default: return '';
  }
}
function getDashboardEligibleRecords() {
  return store.records.filter(r => !r.deleted && !!r.completed);
}
function rebuildDashboardInventoryRows() {
  const eligibleRecords = getDashboardEligibleRecords();
  const existingByRecordId = new Map((store.dashboard.inventoryRows || []).map(x => [x.recordId, x]));


  store.dashboard.inventoryRows = eligibleRecords.map(r => {
    const prev = existingByRecordId.get(r.id);
    return {
      id: prev ? prev.id : `dinv_${Date.now()}_${Math.floor(Math.random() * 100000)}_${r.id}`,
      recordId: r.id,
      dashboardComment: prev ? (prev.dashboardComment || '') : '',
      createdAt: prev ? prev.createdAt : nowIso(),
      updatedAt: nowIso()
    };
  });
}


function getDashboardActiveImport() {
  if (!store.dashboard.activeImportId) return null;
  return store.dashboard.imports.find(x => x.id === store.dashboard.activeImportId) || null;
}
function getImportedRowsForActiveImport() {
  const activeImport = getDashboardActiveImport();
  if (!activeImport) return [];
  return store.dashboard.importedRows.filter(x => x.importId === activeImport.id).sort((a, b) => a.sourceIndex - b.sourceIndex);
}


function rowPassesFocus(row) {
  const focusRules = Array.isArray(store.dashboard.settings.focusRules) ? store.dashboard.settings.focusRules : [];
  const activeRules = focusRules
    .map(rule => ({
      column: String(rule && rule.column || '').trim(),
      values: normalizeFocusValues(rule && rule.values || [])
    }))
    .filter(rule => rule.column && rule.values.length)
    .slice(0, 5);


  if (!activeRules.length) return true;


  return activeRules.every(rule => {
    const current = normalizeCompareValue((row.sourceData || {})[rule.column] || '');
    return rule.values.includes(current);
  });
}


function exactMatchSingle(left, right) {
  if (!left || !right) return false;
  return left === right;
}
function partialMatchSingle(left, right) {
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}
function matchImportRowToRecord(importRow, record) {
  const leftCol = String(store.dashboard.settings.importMatchColumn || '').trim();
  const rightField = String(store.dashboard.settings.inventoryMatchField || 'selectedText').trim();
  const mode = String(store.dashboard.settings.matchMode || 'exact').trim().toLowerCase();


  if (!leftCol || !rightField) return false;
  const left = normalizeCompareValue((importRow.sourceData || {})[leftCol] || '');
  const right = normalizeCompareValue(getInventoryFieldValue(record, rightField));
  if (mode === 'partial') return partialMatchSingle(left, right);
  return exactMatchSingle(left, right);
}
function getDashboardMatchedTextForRecord(record) {
  const rightField = String(store.dashboard.settings.inventoryMatchField || 'selectedText').trim();
  return getInventoryFieldValue(record, rightField) || '';
}
function computeOneToOneDashboardMatches() {
  const importRows = getImportedRowsForActiveImport().filter(rowPassesFocus);
  const availableRecords = getDashboardEligibleRecords().slice().sort((a, b) => {
    const timeCmp = String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
    if (timeCmp !== 0) return timeCmp;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });


  const usedRecordIds = new Set();
  const importToRecord = new Map();
  const recordToImport = new Map();


  for (const row of importRows) {
    const match = availableRecords.find(record => !usedRecordIds.has(record.id) && matchImportRowToRecord(row, record));
    if (!match) continue;
    usedRecordIds.add(match.id);
    importToRecord.set(row.id, match.id);
    recordToImport.set(match.id, row.id);
  }


  return { importRows, importToRecord, recordToImport };
}
function isRecordFoundInDashboard(recordId) {
  const { recordToImport } = computeOneToOneDashboardMatches();
  return recordToImport.has(recordId);
}
function getDashboardImportRowsWithMatches() {
  const { importRows, importToRecord } = computeOneToOneDashboardMatches();
  return importRows.map(row => {
    const recordId = importToRecord.get(row.id) || '';
    const match = recordId ? store.records.find(r => r.id === recordId && !r.deleted && r.completed) : null;
    return { row, match };
  });
}
function getDashboardSummary() {
  rebuildDashboardInventoryRows();


  const activeImport = getDashboardActiveImport();
  const importRowsWithMatches = getDashboardImportRowsWithMatches();
  const importPending = importRowsWithMatches.filter(x => !x.match).length;
  const importFound = importRowsWithMatches.filter(x => !!x.match).length;


  const matchedRecordIds = new Set();
  importRowsWithMatches.forEach(x => { if (x.match) matchedRecordIds.add(x.match.id); });


  const unmatchedInventoryRecords = getDashboardEligibleRecords().filter(r => !matchedRecordIds.has(r.id));
  const addNewCount = unmatchedInventoryRecords.filter(r => !!r.isAddNew).length;
  const photoScannerPending = unmatchedInventoryRecords.filter(r => !r.isAddNew).length;


  const total = importRowsWithMatches.length + unmatchedInventoryRecords.length;
  const matchRate = importRowsWithMatches.length ? Math.round((importFound / importRowsWithMatches.length) * 100) : 0;


  return {
    ok: true,
    hasData: !!activeImport,
    activeImport: activeImport ? {
      id: activeImport.id,
      fileName: activeImport.fileName,
      importedAt: activeImport.importedAt,
      rowCount: activeImport.rowCount,
      columns: activeImport.columns
    } : null,
    cards: { total, importPending, importFound, photoScannerPending, newCount: addNewCount, matchRate },
    settings: {
      visibleColumns: store.dashboard.settings.visibleColumns || [],
      importMatchColumn: store.dashboard.settings.importMatchColumn || '',
      inventoryMatchField: store.dashboard.settings.inventoryMatchField || 'selectedText',
      matchMode: store.dashboard.settings.matchMode || 'exact',
      focusRules: store.dashboard.settings.focusRules || [{ column: '', values: [] }],
      inventoryFields: getInventoryMatchableFields()
    },
    version: dashboardVersion
  };
}


function valueMatchesMultiFilter(value, filterValues) {
  if (!Array.isArray(filterValues) || !filterValues.length) return true;
  const current = String(value || '').toLowerCase();
  return filterValues.some(v => current === String(v || '').toLowerCase());
}


function buildDashboardUnifiedRowsRaw(query = {}) {
  rebuildDashboardInventoryRows();


  const activeImport = getDashboardActiveImport();
  const statusFilter = String(query.status || '').trim().toLowerCase();
  const recordTypeFilter = normalizeRecordTypeFilter(query.recordType);
  const search = normalizeFreeText(query.search || '').toLowerCase();
  const sortBy = String(query.sortBy || '').trim();
  const sortDir = String(query.sortDir || 'asc').trim().toLowerCase() === 'desc' ? 'desc' : 'asc';
  const filtersRaw = query.filters && typeof query.filters === 'object' ? query.filters : {};


  const items = [];
  const importRowsWithMatches = getDashboardImportRowsWithMatches();
  const matchedRecordIds = new Set();


  if (activeImport) {
    importRowsWithMatches.forEach(({ row, match }) => {
      if (match) matchedRecordIds.add(match.id);
      const status = match ? 'found' : 'pending';
      const recordType = match ? match.recordType : '';
      items.push({
        id: row.id,
        origin: 'import',
        sourceIndex: row.sourceIndex,
        sourceData: row.sourceData,
        dashboardComment: row.dashboardComment || '',
        status,
        recordType,
        matchedRecordId: match ? match.id : '',
        matchedSelectedText: match ? getDashboardMatchedTextForRecord(match) : '',
        matchedSenderName: match ? (match.senderName || '') : '',
        matchedReviewedBy: match ? (match.reviewedBy || '') : '',
        matchedTimestamp: match ? (match.timestamp || '') : '',
        matchedIsAddNew: match ? !!match.isAddNew : false,
        canAddNew: false,
        isAddNew: false,
        badgeStatus: status
      });
    });
  }


  store.dashboard.inventoryRows.forEach(row => {
    const record = store.records.find(r => r.id === row.recordId && !r.deleted && r.completed);
    if (!record) return;
    if (matchedRecordIds.has(record.id)) return;


    const status = record.isAddNew ? 'new' : 'pending';
    items.push({
      id: row.id,
      origin: record.recordType === 'scanner' ? 'scanner' : 'photo',
      sourceIndex: 0,
      sourceData: {},
      dashboardComment: row.dashboardComment || '',
      status,
      recordType: record.recordType || '',
      matchedRecordId: record.id,
      matchedSelectedText: getDashboardMatchedTextForRecord(record),
      matchedSenderName: record.senderName || '',
      matchedReviewedBy: record.reviewedBy || '',
      matchedTimestamp: record.timestamp || '',
      inventoryRecordId: record.id,
      canAddNew: !record.isAddNew,
      isAddNew: !!record.isAddNew,
      badgeStatus: status
    });
  });


  let rows = items;


  if (statusFilter) {
    if (statusFilter === 'found') rows = rows.filter(x => x.status === 'found');
    else if (statusFilter === 'pending') rows = rows.filter(x => x.status === 'pending');
    else if (statusFilter === 'new') rows = rows.filter(x => x.status === 'new');
  }


  if (recordTypeFilter !== 'all') rows = rows.filter(x => x.recordType === recordTypeFilter);


  const filterEntries = Object.entries(filtersRaw)
    .map(([k, v]) => {
      const arr = Array.isArray(v) ? [...new Set(v.map(x => String(x || '').trim()).filter(Boolean))] : [];
      return [String(k), arr];
    })
    .filter(([, arr]) => arr.length);


  if (filterEntries.length) {
    rows = rows.filter(row => {
      return filterEntries.every(([key, values]) => {
        const src = row.sourceData && Object.prototype.hasOwnProperty.call(row.sourceData, key) ? row.sourceData[key] : '';
        return valueMatchesMultiFilter(src, values);
      });
    });
  }


  if (search) {
    rows = rows.filter(row => {
      const values = [
        row.id, row.origin, row.status, row.recordType, row.dashboardComment,
        row.matchedRecordId, row.matchedSelectedText, row.matchedSenderName,
        row.matchedReviewedBy, row.matchedTimestamp,
        row.isAddNew ? 'add new' : '',
        ...Object.values(row.sourceData || {})
      ];
      return values.some(v => String(v || '').toLowerCase().includes(search));
    });
  }


  if (sortBy) {
    rows.sort((a, b) => {
      let av = '';
      let bv = '';
      if (['origin', 'status', 'recordType', 'dashboardComment', 'matchedSelectedText', 'matchedSenderName', 'matchedReviewedBy', 'matchedTimestamp'].includes(sortBy)) {
        av = String(a[sortBy] || '');
        bv = String(b[sortBy] || '');
      } else {
        av = String((a.sourceData || {})[sortBy] || '');
        bv = String((b.sourceData || {})[sortBy] || '');
      }
      return sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv);
    });
  } else {
    rows.sort((a, b) => {
      const orderMap = { import: 0, photo: 1, scanner: 2 };
      const oa = orderMap[a.origin] ?? 9;
      const ob = orderMap[b.origin] ?? 9;
      if (oa !== ob) return oa - ob;
      if (a.origin === 'import' && b.origin === 'import') return a.sourceIndex - b.sourceIndex;
      return String(b.matchedTimestamp || '').localeCompare(String(a.matchedTimestamp || ''));
    });
  }


  return rows;
}
function getDashboardUnifiedRows(query = {}) {
  const rows = buildDashboardUnifiedRowsRaw(query);
  const page = normalizePage(query.page, 1);
  const pageSize = normalizePageSize(query.pageSize, 20, 300);
  const result = paginateArray(rows, page, pageSize);


  return {
    ok: true,
    items: result.rows,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    totalPages: result.totalPages,
    version: dashboardVersion
  };
}
function getDashboardUnifiedRowsAll(query = {}) {
  return buildDashboardUnifiedRowsRaw(query);
}
function getDashboardRowFull(rowId) {
  rebuildDashboardInventoryRows();


  const importRow = store.dashboard.importedRows.find(x => x.id === rowId);
  if (importRow) {
    const { importToRecord } = computeOneToOneDashboardMatches();
    const recordId = importToRecord.get(importRow.id) || '';
    const match = recordId ? store.records.find(r => r.id === recordId && !r.deleted && r.completed) : null;
    const activeImport = store.dashboard.imports.find(x => x.id === importRow.importId) || null;
    return {
      ok: true,
      id: importRow.id,
      origin: 'import',
      importId: importRow.importId,
      importFileName: activeImport ? activeImport.fileName : '',
      sourceIndex: importRow.sourceIndex,
      sourceData: importRow.sourceData,
      dashboardComment: importRow.dashboardComment || '',
      createdAt: importRow.createdAt,
      updatedAt: importRow.updatedAt,
      status: match ? 'found' : 'pending',
      matchedRecord: match ? getRecordById(match.id, true) : null,
      canAddNew: false,
      isAddNew: false
    };
  }


  const inventoryRow = store.dashboard.inventoryRows.find(x => x.id === rowId);
  if (inventoryRow) {
    const record = store.records.find(r => r.id === inventoryRow.recordId && !r.deleted && r.completed);
    if (!record) return null;


    const { recordToImport } = computeOneToOneDashboardMatches();
    const matchedImportId = recordToImport.get(record.id) || '';
    const matchedImport = matchedImportId ? store.dashboard.importedRows.find(x => x.id === matchedImportId) : null;


    return {
      ok: true,
      id: inventoryRow.id,
      origin: record.recordType === 'scanner' ? 'scanner' : 'photo',
      importId: '',
      importFileName: '',
      sourceIndex: 0,
      sourceData: {},
      dashboardComment: inventoryRow.dashboardComment || '',
      createdAt: inventoryRow.createdAt,
      updatedAt: inventoryRow.updatedAt,
      status: record.isAddNew ? 'new' : (matchedImport ? 'found' : 'pending'),
      matchedRecord: getRecordById(record.id, true),
      matchedImport: matchedImport ? {
        id: matchedImport.id,
        sourceIndex: matchedImport.sourceIndex,
        sourceData: matchedImport.sourceData
      } : null,
      canAddNew: !record.isAddNew && !matchedImport,
      isAddNew: !!record.isAddNew
    };
  }
  return null;
}


async function buildDashboardExportWorkbook(mode = 'visible') {
  const activeImport = getDashboardActiveImport();
  const settings = store.dashboard.settings || {};
  const rows = getDashboardUnifiedRowsAll({
    search: '',
    status: '',
    recordType: 'all',
    sortBy: '',
    sortDir: 'asc',
    filters: {}
  });


  const visibleColumns = Array.isArray(settings.visibleColumns) ? settings.visibleColumns : [];
  const exportColumns = mode === 'full'
    ? (activeImport ? (activeImport.columns || []) : visibleColumns)
    : visibleColumns;


  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smart Inventory';
  wb.created = new Date();


  const summarySheet = wb.addWorksheet('Dashboard Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  summarySheet.columns = [
    { header: 'Field', key: 'field', width: 28 },
    { header: 'Value', key: 'value', width: 60 }
  ];
  const summary = getDashboardSummary();
  const focusRules = Array.isArray(settings.focusRules) ? settings.focusRules : [];
  const focusText = focusRules
    .filter(rule => String(rule && rule.column || '').trim())
    .map((rule, idx) => `Rule ${idx + 1}: ${rule.column} => ${(Array.isArray(rule.values) ? rule.values : []).join(' | ')}`)
    .join(' || ');


  const summaryRows = [
    { field: 'Active Import File', value: summary.activeImport ? summary.activeImport.fileName : '' },
    { field: 'Imported At', value: summary.activeImport ? formatCsvDateTime(summary.activeImport.importedAt) : '' },
    { field: 'Import Row Count', value: summary.activeImport ? String(summary.activeImport.rowCount || 0) : '0' },
    { field: 'Visible Columns', value: visibleColumns.join(' | ') },
    { field: 'Export Mode', value: mode === 'full' ? 'full' : 'visible' },
    { field: 'Import Match Column', value: settings.importMatchColumn || '' },
    { field: 'Inventory Match Field', value: settings.inventoryMatchField || 'selectedText' },
    { field: 'Match Mode', value: settings.matchMode || 'exact' },
    { field: 'Focus Rules', value: focusText },
    { field: 'Total', value: String(summary.cards.total || 0) },
    { field: 'Import Pending', value: String(summary.cards.importPending || 0) },
    { field: 'Import Found', value: String(summary.cards.importFound || 0) },
    { field: 'Inventory Pending', value: String(summary.cards.photoScannerPending || 0) },
    { field: 'New Count', value: String(summary.cards.newCount || 0) },
    { field: 'Match Rate', value: `${summary.cards.matchRate || 0}%` }
  ];
  summaryRows.forEach(r => summarySheet.addRow(r));


  const dataColumns = [
    { header: 'Dashboard Row ID', key: 'dashboardRowId', width: 26 },
    { header: 'Origin', key: 'origin', width: 14 },
    { header: '#', key: 'sourceIndex', width: 8 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Record Type', key: 'recordType', width: 14 },
    { header: 'Is Add New', key: 'isAddNew', width: 12 },
    { header: 'Dashboard Comment', key: 'dashboardComment', width: 24 },
    { header: 'Matched Record ID', key: 'matchedRecordId', width: 24 },
    { header: 'Matched Text', key: 'matchedSelectedText', width: 32 },
    { header: 'Matched Sender Name', key: 'matchedSenderName', width: 18 },
    { header: 'Matched Reviewed By', key: 'matchedReviewedBy', width: 18 },
    { header: 'Matched Timestamp', key: 'matchedTimestamp', width: 22 },
    ...exportColumns.map(col => ({
      header: col,
      key: `src__${col}`,
      width: Math.max(16, String(col).length + 4)
    }))
  ];


  const dataRows = rows.map(row => {
    const out = {
      dashboardRowId: row.id || '',
      origin: row.origin || '',
      sourceIndex: row.sourceIndex || '',
      status: row.status || '',
      recordType: row.recordType || '',
      isAddNew: row.isAddNew ? 'yes' : 'no',
      dashboardComment: row.dashboardComment || '',
      matchedRecordId: row.matchedRecordId || '',
      matchedSelectedText: row.matchedSelectedText || '',
      matchedSenderName: row.matchedSenderName || '',
      matchedReviewedBy: row.matchedReviewedBy || '',
      matchedTimestamp: row.matchedTimestamp ? formatCsvDateTime(row.matchedTimestamp) : ''
    };
    exportColumns.forEach(col => {
      out[`src__${col}`] = String((row.sourceData || {})[col] || '');
    });
    return out;
  });


  const dataSheet = wb.addWorksheet('Dashboard Rows', { views: [{ state: 'frozen', ySplit: 1 }] });
  dataSheet.columns = dataColumns;
  dataRows.forEach(r => dataSheet.addRow(r));


  [summarySheet, dataSheet].forEach(ws => {
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E78' } };
    ws.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    ws.eachRow((row, rowNumber) => {
      row.alignment = { vertical: 'top', wrapText: true };
      if (rowNumber > 1 && rowNumber % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F7FBFF' } };
      }
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'D9E2F3' } },
          left: { style: 'thin', color: { argb: 'D9E2F3' } },
          bottom: { style: 'thin', color: { argb: 'D9E2F3' } },
          right: { style: 'thin', color: { argb: 'D9E2F3' } }
        };
      });
    });
  });


  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `dashboard_export_${mode}_${formatDateForFile(nowIso())}.xlsx`;
  return { fileName, buffer: Buffer.from(buffer) };
}


function applyApprovedRename(reqObj, adminName, forceAdminDirect = false) {
  const target = userSessions.get(reqObj.requesterId);
  if (!target && !forceAdminDirect) throw new Error('Requester not found');


  const currentTarget = target || {
    userName: reqObj.currentName,
    currentMode: reqObj.requesterRole,
    isAdmin: reqObj.requesterRole === 'admin'
  };


  const oldName = currentTarget.userName;
  const newName = reqObj.requestedName;
  if (oldName === newName) return false;


  if (target) {
    target.userName = newName;
    target.lastActive = Date.now();
  }


  const oldSenderAlert = senderAlerts.get(oldName);
  if (oldSenderAlert) {
    senderAlerts.delete(oldName);
    senderAlerts.set(newName, oldSenderAlert);
  }


  let changed = false;
  changed = renameDeviceProfiles(oldName, newName, reqObj.requesterId) || changed;


  if (currentTarget.isAdmin || reqObj.requesterRole === 'admin') {
    adminReceiverName = newName;
    store.meta.adminReceiverName = newName;
    store.meta.adminInitialized = true;
    adminInitialized = true;
    changed = true;
  }


  if (pushUserLog('user-rename', {
    role: currentTarget.isAdmin ? 'admin' : (currentTarget.currentMode || 'sender'),
    userId: reqObj.requesterId,
    fromName: oldName,
    toName: newName
  })) changed = true;


  if (adminName && pushUserLog('user-rename-accepted', {
    role: 'admin',
    userId: ADMIN_RECEIVER_ID,
    userName: adminName,
    fromName: oldName,
    toName: newName
  })) changed = true;


  return changed;
}


async function cleanDatabaseAndImages() {
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


  userSessions.clear();
  senderAlerts.clear();
  receiverAlerts.clear();
  reviewLocks.clear();
  renameRequests.clear();
  renameRequestByRequester.clear();
  renameDecisionInbox.clear();


  await writeStoreNow();
}


function canDeleteRecord(requesterRole, record) {
  if (requesterRole !== 'admin') return false;
  if (!record) return false;
  if (record.deleted) return false;
  if (record.completed) return false;
  return true;
}
function isOwnRecordReviewerBlocked(currentUserName, record) {
  const user = normalizeUserName(currentUserName || '');
  if (!user) return false;
  return normalizeUserName(record.senderName || '') === user;
}
function canUseWaitGoAhead(fromRole, targetRole) {
  if (fromRole === 'admin') {
    if (targetRole === 'all') return false;
    return targetRole === 'sender' || targetRole === 'receiver' || targetRole === 'all-receivers' || targetRole === 'admin';
  }
  if (fromRole === 'receiver') return targetRole === 'sender';
  return false;
}
function clearWaitForTarget(targetRole, targetId, targetName) {
  let changed = false;
  if (targetRole === 'sender' && targetName) {
    const current = senderAlerts.get(targetName);
    if (current && String(current.message || '').trim().toLowerCase() === 'wait') {
      senderAlerts.delete(targetName);
      changed = true;
    }
  } else if ((targetRole === 'receiver' || targetRole === 'admin') && targetId) {
    const current = receiverAlerts.get(targetId);
    if (current && String(current.message || '').trim().toLowerCase() === 'wait') {
      receiverAlerts.delete(targetId);
      changed = true;
    }
  }
  return changed;
}
function isSameTargetAsSender(target, fromRole, fromId, fromName) {
  if (!target) return false;
  const targetRole = String(target.role || '').trim();
  const targetId = String(target.id || target.receiverId || '').trim();
  const targetName = normalizeUserName(target.name || '');


  const cleanFromRole = String(fromRole || '').trim();
  const cleanFromId = String(fromId || '').trim();
  const cleanFromName = normalizeUserName(fromName || '');


  if (targetRole === cleanFromRole && cleanFromId && targetId === cleanFromId) return true;
  if (targetName && cleanFromName && targetName === cleanFromName) return true;
  if (cleanFromRole === 'admin' && targetRole === 'admin') return true;
  if (cleanFromRole === 'receiver' && targetRole === 'receiver' && cleanFromId && targetId === cleanFromId) return true;
  if (cleanFromRole === 'sender' && targetRole === 'sender' && cleanFromId && targetId === cleanFromId) return true;
  return false;
}


function deleteUserSessionByAdmin(targetRole, targetId, targetName, adminName) {
  const cleanRole = String(targetRole || '').trim();
  const cleanId = String(targetId || '').trim();
  const cleanName = normalizeUserName(targetName || '');
  if (!cleanRole || !cleanId || !cleanName) return false;
  if (cleanRole === 'admin' && cleanId === ADMIN_RECEIVER_ID) return false;


  let changed = false;


  if (userSessions.has(cleanId)) {
    userSessions.delete(cleanId);
    changed = true;
  }


  changed = markDeletedSession(cleanId, cleanName) || changed;


  if (cleanRole === 'sender') {
    if (senderAlerts.has(cleanName)) {
      senderAlerts.delete(cleanName);
      changed = true;
    }
  } else {
    if (receiverAlerts.has(cleanId)) {
      receiverAlerts.delete(cleanId);
      changed = true;
    }
  }


  for (const [recordId, lock] of [...reviewLocks.entries()]) {
    if (lock && lock.receiverId === cleanId) {
      reviewLocks.delete(recordId);
      changed = true;
    }
  }


  store.deviceProfiles.forEach(profile => {
    const matchesId = profile.deviceId === cleanId || profile.receiverId === cleanId;
    if (matchesId && profile.userName === cleanName) {
      profile.updatedAt = nowIso();
      changed = true;
    }
  });


  if (pushUserLog('user-deleted', {
    role: 'admin',
    userId: ADMIN_RECEIVER_ID,
    userName: adminName || adminReceiverName || 'ADMIN',
    toName: cleanName,
    targetRole: cleanRole
  })) changed = true;


  return changed;
}


function requestHandler(req, res) {
  expirePresenceAndPersistLogout();


  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;


  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');


  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }


  if (req.method === 'GET' && pathname === '/api/dashboard-access') {
    const accessMode = getDashboardAccessMode(req);
    return sendJSON(res, 200, {
      ok: true,
      allowDashboard: true,
      accessMode,
      message: accessMode === 'full' ? 'full access' : 'read only access',
      version: storeVersion
    });
  }


  if (req.method === 'GET' && pathname.startsWith('/image/')) {
    ensureDirSync(IMAGE_DIR);
    const fileName = decodeURIComponent(pathname.substring('/image/'.length));
    const filePath = path.resolve(IMAGE_DIR, fileName);
    const imageBase = path.resolve(IMAGE_DIR) + path.sep;
    if (!(filePath + path.sep).startsWith(imageBase) && filePath !== path.resolve(IMAGE_DIR, path.basename(fileName))) {
      return sendText(res, 403, 'Forbidden');
    }


    fs.readFile(filePath, (err, data) => {
      if (err) return sendText(res, 404, 'Image not found');
      const ext = path.extname(filePath).toLowerCase();
      const type = ext === '.png' ? 'image/png' : 'image/jpeg';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' });
      res.end(data);
    });
    return;
  }


  if (req.method === 'GET' && pathname === '/api/device-identity') {
    const deviceId = String(parsedUrl.searchParams.get('deviceId') || '').trim();
    const receiverId = String(parsedUrl.searchParams.get('receiverId') || '').trim();
    const mode = String(parsedUrl.searchParams.get('mode') || '').trim();
    const remembered = getRememberedIdentity({ deviceId, receiverId, mode });


    return sendJSON(res, 200, {
      ok: true,
      found: !!remembered,
      rememberedName: remembered ? remembered.userName : '',
      lastKnownMode: remembered ? remembered.lastKnownMode : '',
      identity: remembered || null,
      cleanGeneration,
      adminReceiverId: ADMIN_RECEIVER_ID,
      version: storeVersion
    });
  }


  if (req.method === 'GET' && pathname === '/api/check-sender-name') {
    const rawName = String(parsedUrl.searchParams.get('name') || '').trim();
    const deviceId = String(parsedUrl.searchParams.get('deviceId') || '').trim();
    if (!rawName) return sendJSON(res, 200, { ok: true, duplicate: false, valid: false, normalized: '' });
    if (!isRawEnglishOnlyName(rawName)) return sendJSON(res, 200, { ok: true, duplicate: false, valid: false, normalized: '' });


    const normalized = normalizeUserName(rawName);
    const exists = isUserNameDuplicate(normalized, deviceId, 'sender');
    return sendJSON(res, 200, { ok: true, duplicate: exists, valid: true, normalized, version: storeVersion });
  }


  if (req.method === 'GET' && pathname === '/api/check-receiver-name') {
    const rawName = String(parsedUrl.searchParams.get('name') || '').trim();
    const receiverId = String(parsedUrl.searchParams.get('receiverId') || '').trim();
    const mode = String(parsedUrl.searchParams.get('mode') || 'receiver').trim();
    const deviceId = String(parsedUrl.searchParams.get('deviceId') || receiverId || '').trim();
    if (!rawName) {
      return sendJSON(res, 200, {
        ok: true,
        duplicate: false,
        valid: false,
        normalized: '',
        adminName: adminReceiverName,
        adminInitialized,
        version: storeVersion
      });
    }
    if (!isRawEnglishOnlyName(rawName)) {
      return sendJSON(res, 200, {
        ok: true,
        duplicate: false,
        valid: false,
        normalized: '',
        adminName: adminReceiverName,
        adminInitialized,
        version: storeVersion
      });
    }


    const normalized = normalizeUserName(rawName);
    const exists = isUserNameDuplicate(normalized, deviceId, mode);
    return sendJSON(res, 200, {
      ok: true,
      duplicate: exists,
      valid: true,
      normalized,
      adminName: adminReceiverName,
      adminInitialized,
      version: storeVersion
    });
  }


  if (req.method === 'POST' && pathname === '/api/rename-request') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const requesterRole = String(json.requesterRole || '').trim();
      const requesterId = String(json.requesterId || '').trim();
      const currentName = normalizeUserName(json.currentName || '');
      const requestedNameRaw = String(json.requestedName || '').trim();


      if (!requesterRole || !requesterId || !currentName || !requestedNameRaw) {
        return sendJSON(res, 400, { ok: false, error: 'requesterRole, requesterId, currentName, requestedName are required' });
      }
      if (!isRawEnglishOnlyName(requestedNameRaw)) {
        return sendJSON(res, 400, { ok: false, error: 'Username must contain English letters only' });
      }


      const requestedName = normalizeUserName(requestedNameRaw);
      if (requestedName === currentName) {
        return sendJSON(res, 400, { ok: false, error: 'New name must be different from current name' });
      }


      const owner = getUserSessionByName(requestedName, { deviceId: requesterId });
      if (owner && !owner.isAdmin) {
        return sendJSON(res, 400, { ok: false, error: 'Requested name already exists in system' });
      }


      if (requesterRole === 'admin') {
        let changed = false;
        syncAction(() => {
          changed = applyApprovedRename({
            requesterRole,
            requesterId,
            currentName,
            requestedName
          }, currentName, true);
        }, { store: true, dashboard: false });
        return sendJSON(res, 200, { ok: true, directApplied: changed, version: storeVersion });
      }


      if (!adminInitialized || !adminReceiverName) {
        return sendJSON(res, 400, { ok: false, error: 'Admin is not ready yet' });
      }


      const requesterKey = getPresenceKeyByRoleId(requesterRole, requesterId);
      const pendingId = renameRequestByRequester.get(requesterKey);
      if (pendingId) {
        const existingReq = renameRequests.get(pendingId);
        if (existingReq && existingReq.status === 'pending') {
          return sendJSON(res, 400, { ok: false, error: 'A rename request is already pending' });
        }
      }


      const requestId = `rename_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const reqObj = {
        id: requestId,
        status: 'pending',
        createdAt: nowIso(),
        requesterRole,
        requesterId,
        currentName,
        requestedName
      };


      renameRequests.set(requestId, reqObj);
      renameRequestByRequester.set(requesterKey, requestId);
      receiverAlerts.set(ADMIN_RECEIVER_ID, {
        id: `rename_alert_${requestId}`,
        type: 'rename-request',
        requestId,
        fromRole: requesterRole,
        fromId: requesterId,
        fromName: currentName,
        targetRole: 'admin',
        targetId: ADMIN_RECEIVER_ID,
        targetName: adminReceiverName,
        message: `${currentName} requests rename to ${requestedName}`,
        time: nowIso()
      });


      syncAction(() => {
        pushUserLog('user-rename-request', {
          role: requesterRole,
          userId: requesterId,
          userName: currentName,
          requestOldName: currentName,
          requestNewName: requestedName
        });
      }, { store: true, dashboard: false });


      sendJSON(res, 200, { ok: true, requestId, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'GET' && pathname === '/api/rename-request-status') {
    const requesterRole = String(parsedUrl.searchParams.get('requesterRole') || '').trim();
    const requesterId = String(parsedUrl.searchParams.get('requesterId') || '').trim();
    const key = getPresenceKeyByRoleId(requesterRole, requesterId);
    const requestId = renameRequestByRequester.get(key);


    if (!requestId) {
      const decision = renameDecisionInbox.get(key) || null;
      return sendJSON(res, 200, { ok: true, pending: false, decision, version: storeVersion });
    }


    const reqObj = renameRequests.get(requestId);
    if (!reqObj) {
      const decision = renameDecisionInbox.get(key) || null;
      return sendJSON(res, 200, { ok: true, pending: false, decision, version: storeVersion });
    }


    if (reqObj.status === 'pending') return sendJSON(res, 200, { ok: true, pending: true, request: reqObj, version: storeVersion });
    const decision = renameDecisionInbox.get(key) || null;
    return sendJSON(res, 200, { ok: true, pending: false, decision, version: storeVersion });
  }


  if (req.method === 'POST' && pathname === '/api/rename-decision-ack') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const requesterRole = String(json.requesterRole || '').trim();
      const requesterId = String(json.requesterId || '').trim();
      const key = getPresenceKeyByRoleId(requesterRole, requesterId);
      renameDecisionInbox.delete(key);
      sendJSON(res, 200, { ok: true, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'GET' && pathname === '/api/admin-rename-requests') {
    const requesterRole = String(parsedUrl.searchParams.get('requesterRole') || '').trim();
    const requesterId = String(parsedUrl.searchParams.get('requesterId') || '').trim();
    if (requesterRole !== 'admin' || requesterId !== ADMIN_RECEIVER_ID) return sendJSON(res, 403, { ok: false, error: 'Admin only' });


    const items = [...renameRequests.values()].filter(x => x.status === 'pending').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return sendJSON(res, 200, { ok: true, items, version: storeVersion });
  }


  if (req.method === 'POST' && pathname === '/api/admin-rename-decision') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const requesterRole = String(json.requesterRole || '').trim();
      const requesterId = String(json.requesterId || '').trim();
      const adminName = normalizeUserName(json.adminName || '');
      const requestId = String(json.requestId || '').trim();
      const decision = String(json.decision || '').trim().toLowerCase();


      if (requesterRole !== 'admin' || requesterId !== ADMIN_RECEIVER_ID) return sendJSON(res, 403, { ok: false, error: 'Admin only' });
      if (!requestId || !['accept', 'deny'].includes(decision)) return sendJSON(res, 400, { ok: false, error: 'requestId and valid decision are required' });


      const reqObj = renameRequests.get(requestId);
      if (!reqObj) return sendJSON(res, 404, { ok: false, error: 'Rename request not found' });
      if (reqObj.status !== 'pending') return sendJSON(res, 400, { ok: false, error: 'Rename request already processed' });


      const requesterKey = getPresenceKeyByRoleId(reqObj.requesterRole, reqObj.requesterId);
      receiverAlerts.delete(ADMIN_RECEIVER_ID);


      if (decision === 'accept') {
        const owner = getUserSessionByName(reqObj.requestedName, { deviceId: reqObj.requesterId });
        if (owner && !owner.isAdmin) {
          reqObj.status = 'denied';
          reqObj.decidedAt = nowIso();
          reqObj.decision = 'deny';
          renameRequestByRequester.delete(requesterKey);
          renameDecisionInbox.set(requesterKey, {
            type: 'rename-decision',
            requestId,
            decision: 'deny',
            oldName: reqObj.currentName,
            newName: reqObj.requestedName,
            message: `Rename denied. The requested name "${reqObj.requestedName}" is no longer available.`
          });


          syncAction(() => {
            pushUserLog('user-rename-denied', {
              role: 'admin',
              userId: ADMIN_RECEIVER_ID,
              userName: adminName,
              requestOldName: reqObj.currentName,
              requestNewName: reqObj.requestedName
            });
          }, { store: true, dashboard: false });


          return sendJSON(res, 200, { ok: true, applied: false, autoDenied: true, version: storeVersion });
        }


        syncAction(() => {
          applyApprovedRename(reqObj, adminName || adminReceiverName || 'ADMIN');
          reqObj.status = 'accepted';
          reqObj.decidedAt = nowIso();
          reqObj.decision = 'accept';
          renameRequestByRequester.delete(requesterKey);
          renameDecisionInbox.set(requesterKey, {
            type: 'rename-decision',
            requestId,
            decision: 'accept',
            oldName: reqObj.currentName,
            newName: reqObj.requestedName,
            message: `Rename approved. Your name is now "${reqObj.requestedName}".`
          });
        }, { store: true, dashboard: false });


        return sendJSON(res, 200, { ok: true, applied: true, version: storeVersion });
      }


      syncAction(() => {
        reqObj.status = 'denied';
        reqObj.decidedAt = nowIso();
        reqObj.decision = 'deny';
        renameRequestByRequester.delete(requesterKey);
        renameDecisionInbox.set(requesterKey, {
          type: 'rename-decision',
          requestId,
          decision: 'deny',
          oldName: reqObj.currentName,
          newName: reqObj.requestedName,
          message: 'Rename denied by admin.'
        });


        pushUserLog('user-rename-denied', {
          role: 'admin',
          userId: ADMIN_RECEIVER_ID,
          userName: adminName || adminReceiverName || 'ADMIN',
          requestOldName: reqObj.currentName,
          requestNewName: reqObj.requestedName
        });
      }, { store: true, dashboard: false });


      sendJSON(res, 200, { ok: true, applied: false, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'POST' && pathname === '/api/set-receiver-name') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const receiverId = normalizeReceiverId(json.receiverId, req);
      const receiverRaw = String(json.receiverName || '').trim();
      const isAdmin = !!json.isAdmin;
      const mode = normalizeProfileMode(json.mode || (isAdmin ? 'admin' : 'receiver')) || (isAdmin ? 'admin' : 'receiver');
      const fingerprint = json.fingerprint || {};
      const deviceId = String(json.deviceId || (isAdmin ? ADMIN_RECEIVER_ID : receiverId) || '').trim() || (isAdmin ? ADMIN_RECEIVER_ID : receiverId);


      if (!receiverRaw) return sendJSON(res, 400, { ok: false, error: 'receiverName is required' });
      if (!isRawEnglishOnlyName(receiverRaw)) return sendJSON(res, 400, { ok: false, error: 'Username must contain English letters only' });


      const receiverName = normalizeUserName(receiverRaw);
      clearDeletedSession(deviceId || receiverId, receiverName);


      if (isAdmin) {
        if (!isAdminReceiverId(receiverId)) return sendJSON(res, 403, { ok: false, error: 'Only admin id can register as admin' });
        if (isUserNameDuplicate(receiverName, deviceId, mode) && receiverName !== adminReceiverName) {
          return sendJSON(res, 400, { ok: false, error: 'Receiver name already exists in system' });
        }


        syncAction(() => {
          adminReceiverName = receiverName;
          adminInitialized = true;
          store.meta.adminReceiverName = adminReceiverName;
          store.meta.adminInitialized = true;
          upsertDeviceProfile({ deviceId, receiverId, userName: receiverName, mode, req, fingerprint });
        }, { store: true, dashboard: false });


        registerUserMode(req, receiverName, deviceId, mode, receiverId, fingerprint, { silentLog: mode === 'dashboard' });
      } else {
        if (isUserNameDuplicate(receiverName, deviceId, mode)) return sendJSON(res, 400, { ok: false, error: 'Receiver name already exists in system' });
        const result = upsertDeviceProfile({ deviceId, receiverId, userName: receiverName, mode, req, fingerprint });
        if (result.changed) { setSyncPending(); bumpStoreVersion(); setSyncDone(); scheduleSave(); }
        registerUserMode(req, receiverName, deviceId, mode, receiverId, fingerprint);
      }


      const remembered = getRememberedIdentity({ deviceId, receiverId, mode });
      sendJSON(res, 200, {
        ok: true,
        normalized: receiverName,
        rememberedName: remembered ? remembered.userName : receiverName,
        adminName: adminReceiverName,
        adminInitialized,
        cleanGeneration,
        version: storeVersion
      });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'POST' && pathname === '/api/receiver-heartbeat') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const receiverId = normalizeReceiverId(json.receiverId, req);
      const receiverName = normalizeUserName(json.receiverName || '');
      const isAdmin = !!json.isAdmin;
      const mode = normalizeProfileMode(json.mode || (isAdmin ? 'admin' : 'receiver')) || (isAdmin ? 'admin' : 'receiver');
      const clientGeneration = Number(json.cleanGeneration || 0);
      const fingerprint = json.fingerprint || {};
      const deviceId = String(json.deviceId || (isAdmin ? ADMIN_RECEIVER_ID : receiverId) || '').trim();


      if (clientGeneration !== cleanGeneration) return sendJSON(res, 200, { ok: false, deletedByAdmin: true, cleanGeneration });


      const remembered = getRememberedIdentity({ deviceId, receiverId, mode });


      if (!receiverName) {
        return sendJSON(res, 200, {
          ok: true,
          rememberedName: remembered ? remembered.userName : '',
          deletedByAdmin: false,
          cleanGeneration,
          adminName: adminReceiverName,
          adminInitialized,
          version: storeVersion
        });
      }


      if (isDeletedSession(deviceId || receiverId, receiverName)) return sendJSON(res, 200, { ok: false, deletedByAdmin: true, cleanGeneration });
      if (isAdmin && !isAdminReceiverId(receiverId)) return sendJSON(res, 403, { ok: false, error: 'Invalid admin receiver id' });


      touchUserHeartbeat(req, receiverName, deviceId || receiverId, mode, receiverId, fingerprint);
      sendJSON(res, 200, {
        ok: true,
        adminName: adminReceiverName,
        adminInitialized,
        rememberedName: receiverName,
        deletedByAdmin: false,
        cleanGeneration,
        version: storeVersion
      });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'GET' && pathname === '/api/ping') {
    return sendJSON(res, 200, { ok: true, now: Date.now(), version: storeVersion });
  }


  if (req.method === 'POST' && pathname === '/api/sender-heartbeat') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const senderName = normalizeUserName(json.senderName || '');
      const deviceId = String(json.deviceId || '').trim();
      const clientGeneration = Number(json.cleanGeneration || 0);
      const fingerprint = json.fingerprint || {};


      if (clientGeneration !== cleanGeneration) return sendJSON(res, 200, { ok: false, deletedByReceiver: true, cleanGeneration });


      const remembered = getRememberedIdentity({ deviceId, receiverId: '', mode: 'sender' });


      if (!senderName || !deviceId) {
        return sendJSON(res, 200, {
          ok: true,
          deletedByReceiver: false,
          rememberedName: remembered ? remembered.userName : '',
          cleanGeneration,
          version: storeVersion
        });
      }


      if (isDeletedSession(deviceId, senderName)) {
        return sendJSON(res, 200, { ok: false, deletedByReceiver: true, cleanGeneration, version: storeVersion });
      }


      touchUserHeartbeat(req, senderName, deviceId, 'sender', '', fingerprint);
      sendJSON(res, 200, {
        ok: true,
        deletedByReceiver: false,
        rememberedName: senderName,
        cleanGeneration,
        version: storeVersion
      });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'GET' && pathname === '/api/active-senders') {
    return sendJSON(res, 200, { ok: true, senders: getActiveUsers(), version: storeVersion });
  }


  if (req.method === 'POST' && pathname === '/api/delete-user') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const requesterRole = String(json.requesterRole || '').trim();
      const targetRole = String(json.targetRole || '').trim();
      const targetId = String(json.targetId || '').trim();
      const targetName = normalizeUserName(json.targetName || '');
      const adminName = normalizeUserName(json.adminName || adminReceiverName || '');


      if (requesterRole !== 'admin') return sendJSON(res, 403, { ok: false, error: 'Admin only' });
      if (!targetRole || !targetId || !targetName) return sendJSON(res, 400, { ok: false, error: 'targetRole, targetId, targetName are required' });
      if (targetRole === 'all' || targetRole === 'all-receivers') return sendJSON(res, 400, { ok: false, error: 'Unsupported target role' });
      if (targetRole === 'admin' && targetId === ADMIN_RECEIVER_ID) return sendJSON(res, 400, { ok: false, error: 'Cannot delete main admin user' });


      let changed = false;
      syncAction(() => {
        changed = deleteUserSessionByAdmin(targetRole, targetId, targetName, adminName);
      }, { store: true, dashboard: false });


      return sendJSON(res, 200, { ok: true, changed, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'POST' && pathname === '/api/team-message') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const fromRole = String(json.fromRole || '').trim();
      const fromId = String(json.fromId || '').trim();
      const fromName = normalizeUserName(json.fromName || '');
      const targetRole = String(json.targetRole || '').trim();
      const targetId = String(json.targetId || '').trim();
      const targetName = normalizeUserName(json.targetName || '');
      const message = normalizeFreeText(json.message || '');
      const normalizedMessage = String(message).trim().toLowerCase();


      if (!fromRole || !fromId || !fromName || !message) {
        return sendJSON(res, 400, { ok: false, error: 'fromRole, fromId, fromName, message are required' });
      }


      const isWaitAction = normalizedMessage === 'wait' || normalizedMessage === 'go ahead';
      if (isWaitAction && !canUseWaitGoAhead(fromRole, targetRole)) {
        return sendJSON(res, 400, { ok: false, error: 'This role cannot send wait/go ahead to target role' });
      }


      const messageLogType = normalizedMessage === 'wait'
        ? 'team-wait'
        : normalizedMessage === 'go ahead'
          ? 'team-go-ahead'
          : 'team-message';


      if (targetRole === 'sender') {
        if (!targetName) return sendJSON(res, 400, { ok: false, error: 'targetName is required for sender target' });
        if (fromName === targetName && fromRole === 'sender') return sendJSON(res, 400, { ok: false, error: 'Cannot send message to self' });


        syncAction(() => {
          if (normalizedMessage === 'go ahead') clearWaitForTarget('sender', '', targetName);
          senderAlerts.set(targetName, {
            id: `${Date.now()}_${Math.floor(Math.random() * 100000)}`,
            fromRole, fromId, fromName, targetRole, targetId, targetName, message, time: nowIso()
          });
          pushUserLog(messageLogType, {
            role: fromRole, userId: fromId, userName: fromName, fromName, toName: targetName, targetRole, actorRole: fromRole
          });
        }, { store: true, dashboard: false });


        return sendJSON(res, 200, { ok: true, version: storeVersion });
      }


      if (targetRole === 'receiver' || targetRole === 'admin') {
        if (!targetId) return sendJSON(res, 400, { ok: false, error: 'targetId is required for receiver/admin target' });
        if (fromId === targetId && fromRole !== 'admin') return sendJSON(res, 400, { ok: false, error: 'Cannot send message to self' });


        syncAction(() => {
          if (normalizedMessage === 'go ahead') clearWaitForTarget(targetRole, targetId, '');
          receiverAlerts.set(targetId, {
            id: `${Date.now()}_${Math.floor(Math.random() * 100000)}`,
            fromRole, fromId, fromName, targetRole, targetId, targetName, message, time: nowIso()
          });
          pushUserLog(messageLogType, {
            role: fromRole, userId: fromId, userName: fromName, fromName, toName: targetName, targetRole, actorRole: fromRole
          });
        }, { store: true, dashboard: false });


        return sendJSON(res, 200, { ok: true, version: storeVersion });
      }


      if (targetRole === 'all-receivers') {
        const targets = getActiveUsers().filter(x => (x.role === 'receiver' || x.role === 'admin') && !isSameTargetAsSender(x, fromRole, fromId, fromName));


        syncAction(() => {
          for (const target of targets) {
            if (normalizedMessage === 'go ahead') clearWaitForTarget(target.role, target.receiverId || target.id, '');
            receiverAlerts.set(target.receiverId || target.id, {
              id: `${Date.now()}_${Math.floor(Math.random() * 100000)}_${target.id}`,
              fromRole, fromId, fromName,
              targetRole: target.role,
              targetId: target.receiverId || target.id,
              targetName: target.name,
              message, time: nowIso()
            });


            pushUserLog(messageLogType, {
              role: fromRole, userId: fromId, userName: fromName, fromName, toName: target.name, targetRole: target.role, actorRole: fromRole
            });
          }
        }, { store: true, dashboard: false });
        return sendJSON(res, 200, { ok: true, delivered: targets.length, version: storeVersion });
      }


      if (targetRole === 'all') {
        const senderTargets = getActiveUsers().filter(x => x.role === 'sender' && !isSameTargetAsSender(x, fromRole, fromId, fromName));
        const receiverTargets = getActiveUsers().filter(x => (x.role === 'receiver' || x.role === 'admin') && !isSameTargetAsSender(x, fromRole, fromId, fromName));


        syncAction(() => {
          senderTargets.forEach(target => {
            senderAlerts.set(target.name, {
              id: `${Date.now()}_${Math.floor(Math.random() * 100000)}_${target.id}`,
              fromRole, fromId, fromName,
              targetRole: target.role, targetId: target.id, targetName: target.name, message, time: nowIso(),
              broadcast: true
            });
            pushUserLog(messageLogType, {
              role: fromRole, userId: fromId, userName: fromName, fromName, toName: target.name, targetRole: target.role, actorRole: fromRole
            });
          });


          receiverTargets.forEach(target => {
            receiverAlerts.set(target.receiverId || target.id, {
              id: `${Date.now()}_${Math.floor(Math.random() * 100000)}_${target.id}`,
              fromRole, fromId, fromName,
              targetRole: target.role, targetId: target.receiverId || target.id, targetName: target.name, message, time: nowIso(),
              broadcast: true
            });
            pushUserLog(messageLogType, {
              role: fromRole, userId: fromId, userName: fromName, fromName, toName: target.name, targetRole: target.role, actorRole: fromRole
            });
          });
        }, { store: true, dashboard: false });


        return sendJSON(res, 200, { ok: true, delivered: senderTargets.length + receiverTargets.length, version: storeVersion });
      }


      return sendJSON(res, 400, { ok: false, error: 'Unsupported target role' });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'GET' && pathname === '/api/sender-alert') {
    const senderName = normalizeUserName(parsedUrl.searchParams.get('senderName') || '');
    const deviceId = String(parsedUrl.searchParams.get('deviceId') || '').trim();


    if (!senderName && deviceId) {
      const remembered = getRememberedIdentity({ deviceId, mode: 'sender' });
      return sendJSON(res, 200, { ok: true, alert: null, deletedByReceiver: false, rememberedName: remembered ? remembered.userName : '', cleanGeneration, version: storeVersion });
    }


    if (!senderName) return sendJSON(res, 200, { ok: true, alert: null, deletedByReceiver: false, version: storeVersion });
    if (deviceId && isDeletedSession(deviceId, senderName)) {
      return sendJSON(res, 200, { ok: true, deletedByReceiver: true, alert: null, cleanGeneration, version: storeVersion });
    }


    const alert = senderAlerts.get(senderName) || null;
    return sendJSON(res, 200, { ok: true, alert, deletedByReceiver: false, cleanGeneration, version: storeVersion });
  }


  if (req.method === 'GET' && pathname === '/api/receiver-alert') {
    const receiverId = String(parsedUrl.searchParams.get('receiverId') || '').trim();
    const receiverName = normalizeUserName(parsedUrl.searchParams.get('receiverName') || '');


    if (!receiverId) return sendJSON(res, 200, { ok: true, alert: null, deletedByAdmin: false, version: storeVersion });
    if (receiverName && isDeletedSession(receiverId, receiverName)) {
      return sendJSON(res, 200, { ok: true, alert: null, deletedByAdmin: true, cleanGeneration, version: storeVersion });
    }


    const alert = receiverAlerts.get(receiverId) || null;
    return sendJSON(res, 200, { ok: true, alert, deletedByAdmin: false, cleanGeneration, version: storeVersion });
  }


  if (req.method === 'POST' && pathname === '/api/sender-alert-ack') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const senderName = normalizeUserName(json.senderName || '');
      const alertId = String(json.alertId || '').trim();
      const existing = senderAlerts.get(senderName);
      if (existing && existing.id === alertId) {
        if (String(existing.message || '').trim().toLowerCase() !== 'wait') {
          senderAlerts.delete(senderName);
          setSyncPending(); bumpStoreVersion(); setSyncDone(); scheduleSave();
        }
      }
      sendJSON(res, 200, { ok: true, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'POST' && pathname === '/api/receiver-alert-ack') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const receiverId = String(json.receiverId || '').trim();
      const alertId = String(json.alertId || '').trim();
      const existing = receiverAlerts.get(receiverId);
      if (existing && existing.id === alertId) {
        if (String(existing.message || '').trim().toLowerCase() !== 'wait' && existing.type !== 'rename-request') {
          receiverAlerts.delete(receiverId);
          setSyncPending(); bumpStoreVersion(); setSyncDone(); scheduleSave();
        }
      }
      sendJSON(res, 200, { ok: true, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'GET' && pathname === '/api/interfaces') {
    return sendJSON(res, 200, {
      ok: true,
      senderUrls: getAllLocalIPs().map((item, index) => ({
        label: `[${index + 1}] ${item.interface}`,
        interface: item.interface,
        address: item.address,
        senderUrl: `http://${item.address}:${PORT}/sender`,
        receiverUrl: `http://${item.address}:${PORT}/receiver`,
        dashboardUrl: `http://${item.address}:${PORT}/dashboard`
      })),
      version: storeVersion
    });
  }


  if (req.method === 'GET' && pathname === '/api/sync-status') {
    return sendJSON(res, 200, {
      ok: true,
      status: store.meta.lastSyncStatus || 'done',
      lastSyncTime: store.meta.lastSyncTime || '',
      cleanGeneration,
      version: storeVersion
    });
  }


  if (req.method === 'POST' && pathname === '/api/review-lock/claim') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const recordId = String(json.recordId || '').trim();
      const receiverId = normalizeReceiverId(json.receiverId, req);
      const receiverName = normalizeUserName(json.receiverName || '');


      if (!recordId || !receiverName) return sendJSON(res, 400, { ok: false, error: 'recordId and receiverName are required' });
      if (isDeletedSession(receiverId, receiverName)) return sendJSON(res, 403, { ok: false, deletedByAdmin: true, error: 'Receiver deleted by admin' });


      const record = store.records.find(r => r.id === recordId && !r.deleted);
      if (!record) return sendJSON(res, 404, { ok: false, error: 'Record not found' });
      if (isOwnRecordReviewerBlocked(receiverName, record)) return sendJSON(res, 403, { ok: false, error: 'You cannot review your own submitted record' });


      const result = claimReviewLock(recordId, receiverId, receiverName);
      if (!result.ok) return sendJSON(res, 200, { ok: false, lockedBy: result.lock.receiverName, lock: result.lock, version: storeVersion });


      syncAction(() => {
        pushRecordEvent(recordId, 'review-claimed', 'receiver', receiverName, { reviewedBy: receiverName });
      }, { store: true, dashboard: false });


      sendJSON(res, 200, { ok: true, lock: result.lock, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'POST' && pathname === '/api/review-lock/release') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const recordId = String(json.recordId || '').trim();
      const receiverId = normalizeReceiverId(json.receiverId, req);
      if (!recordId) return sendJSON(res, 400, { ok: false, error: 'recordId is required' });


      const current = getReviewLock(recordId);
      const ok = releaseReviewLock(recordId, receiverId);


      if (ok && current && current.receiverId === receiverId) {
        syncAction(() => {
          pushRecordEvent(recordId, 'review-released', 'receiver', current.receiverName, { reviewedBy: current.receiverName });
        }, { store: true, dashboard: false });
      }


      sendJSON(res, 200, { ok, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'GET' && pathname === '/api/review-lock') {
    const recordId = String(parsedUrl.searchParams.get('recordId') || '').trim();
    const lock = getReviewLock(recordId);
    return sendJSON(res, 200, { ok: true, lock, version: storeVersion });
  }


  if (req.method === 'GET' && pathname === '/api/export-complete-zip') {
    const requesterRole = String(parsedUrl.searchParams.get('requesterRole') || '').trim();
    if (requesterRole !== 'admin') return sendText(res, 403, 'Forbidden');


    buildExportWorkbookForRole('admin')
      .then(({ buffer, fileName }) => {
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length': buffer.length,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.end(buffer);
      })
      .catch(e => sendText(res, 500, e.message));
    return;
  }


  if (req.method === 'POST' && pathname === '/api/clean-database') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const requesterRole = String(json.requesterRole || '').trim();
      if (requesterRole !== 'admin') return sendJSON(res, 403, { ok: false, error: 'Only admin can clean database' });


      cleanDatabaseAndImages()
        .then(() => sendJSON(res, 200, { ok: true, cleanGeneration, version: storeVersion }))
        .catch(e => sendJSON(res, 500, { ok: false, error: e.message }));
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'POST' && pathname === '/api/upload-record') {
    requestBody(req).then(async body => {
      const json = JSON.parse(body || '{}');
      const images = Array.isArray(json.images) ? json.images : [];
      const senderRaw = String(json.senderName || '').trim();
      const deviceId = String(json.deviceId || '').trim();
      const recordType = String(json.recordType || 'photo').trim().toLowerCase() === 'scanner' ? 'scanner' : 'photo';
      const comment = normalizeFreeText(json.comment || '');
      const requireComment = !!json.requireComment;
      const clientGeneration = Number(json.cleanGeneration || 0);
      const fingerprint = json.fingerprint || {};


      if (!senderRaw || !deviceId) return sendJSON(res, 400, { ok: false, error: 'senderName and deviceId are required' });
      if (!isRawEnglishOnlyName(senderRaw)) return sendJSON(res, 400, { ok: false, error: 'Invalid sender name' });


      const senderName = normalizeUserName(senderRaw);


      if (clientGeneration !== cleanGeneration) {
        return sendJSON(res, 400, { ok: false, deletedByReceiver: true, error: 'Session reset. Please set a name again.', cleanGeneration });
      }
      if (isDeletedSession(deviceId, senderName)) {
        return sendJSON(res, 400, { ok: false, deletedByReceiver: true, error: 'This user was deleted by receiver. Please set a name again.', cleanGeneration });
      }


      if (requireComment && !hasMeaningfulText(comment)) return sendJSON(res, 400, { ok: false, error: 'Comment is required' });


      if (recordType === 'photo') {
        if (images.length < 2 || images.length > 4) {
          return sendJSON(res, 400, { ok: false, error: 'Minimum 2 and maximum 4 images are required per record.' });
        }
      } else {
        if (images.length !== 0) return sendJSON(res, 400, { ok: false, error: 'Scanner records must not include images.' });
        if (!hasMeaningfulText(json.scannerText || '')) return sendJSON(res, 400, { ok: false, error: 'scannerText is required for scanner record.' });
      }


      registerUserMode(req, senderName, deviceId, 'sender', '', fingerprint);


      const id = Date.now().toString() + '_' + Math.floor(Math.random() * 100000);
      const scannerText = normalizeFreeText(json.scannerText || '');
      const savedImages = [];


      for (let i = 0; i < images.length; i++) {
        const saved = await saveBase64ImageToFile(images[i].data, images[i].name || `timestamp_${Date.now()}_${i + 1}.jpg`);
        savedImages.push(saved);
      }


      syncAction(() => {
        const record = {
          id,
          timestamp: nowIso(),
          senderName,
          deviceId,
          recordType,
          selectedText: recordType === 'scanner' ? scannerText : '',
          selectedSourceText: recordType === 'scanner' ? scannerText : '',
          comment,
          reviewedBy: '',
          addedBy: '',
          exportedName: '',
          completed: false,
          deleted: false,
          isAddNew: false,
          images: savedImages.map((img, i) => ({
            id: `${id}_img_${i + 1}`,
            name: img.fileName,
            storedName: img.storedName,
            url: `/image/${encodeURIComponent(img.storedName)}`,
            createdAt: nowIso(),
            sortOrder: i + 1
          })),
          timeline: []
        };


        store.records.push(record);
        pushRecordEvent(id, 'submitted', 'sender', senderName, {
          selectedText: recordType === 'scanner' ? scannerText : '',
          selectedSourceText: recordType === 'scanner' ? scannerText : '',
          comment
        });
      }, { store: true, dashboard: true });


      sendJSON(res, 200, { ok: true, id, version: storeVersion, dashboardVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'POST' && pathname === '/api/delete-record') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const requesterRole = String(json.requesterRole || '').trim();
      const item = store.records.find(r => r.id === json.id);


      if (!item) return sendJSON(res, 404, { ok: false, error: 'Record not found' });
      if (!canDeleteRecord(requesterRole, item)) {
        if (requesterRole !== 'admin') return sendJSON(res, 403, { ok: false, error: 'Only admin can delete records' });
        if (item.completed) return sendJSON(res, 400, { ok: false, error: 'Completed records cannot be deleted' });
        return sendJSON(res, 400, { ok: false, error: 'Delete not allowed' });
      }


      syncAction(() => {
        item.deleted = true;
        reviewLocks.delete(json.id);
        pushRecordEvent(json.id, 'deleted', 'admin', normalizeUserName(json.actorName || ''), {});
      }, { store: true, dashboard: true });


      sendJSON(res, 200, { ok: true, version: storeVersion, dashboardVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'GET' && pathname === '/api/records') {
    const result = getRecordsPage({
      page: parsedUrl.searchParams.get('page'),
      pageSize: parsedUrl.searchParams.get('pageSize'),
      status: parsedUrl.searchParams.get('status'),
      search: parsedUrl.searchParams.get('search'),
      recordType: parsedUrl.searchParams.get('recordType'),
      senderName: parsedUrl.searchParams.get('senderName')
    });
    return sendJSON(res, 200, result);
  }


  if (req.method === 'GET' && pathname.startsWith('/api/record/')) {
    const id = pathname.substring('/api/record/'.length);
    const item = getRecordById(id, true);
    if (!item) return sendJSON(res, 404, { ok: false, error: 'Record not found' });


    const requesterName = normalizeUserName(parsedUrl.searchParams.get('requesterName') || '');
    const recordRaw = store.records.find(r => r.id === id);
    return sendJSON(res, 200, {
      ...item,
      foundInDashboard: isRecordFoundInDashboard(id),
      reviewLock: getReviewLock(id),
      ownRecordBlocked: requesterName ? isOwnRecordReviewerBlocked(requesterName, recordRaw) : false,
      version: storeVersion
    });
  }


  if (req.method === 'POST' && pathname === '/api/select-ocr') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const item = store.records.find(r => r.id === json.id);
      if (!item) return sendJSON(res, 404, { ok: false, error: 'Record not found' });


      const receiverId = normalizeReceiverId(json.receiverId, req);
      const receiverName = normalizeUserName(json.receiverName || '');
      if (isOwnRecordReviewerBlocked(receiverName, item)) return sendJSON(res, 403, { ok: false, error: 'You cannot review your own submitted record' });


      const lock = getReviewLock(json.id);
      if (lock && lock.receiverId !== receiverId) return sendJSON(res, 409, { ok: false, error: `Locked by ${lock.receiverName}` });


      syncAction(() => {
        item.selectedSourceText = String(json.selectedText || '');
        item.selectedText = String(json.selectedText || '');
        pushRecordEvent(json.id, 'ocr-selected', 'receiver', lock?.receiverName || '', {
          selectedText: String(json.selectedText || ''),
          selectedSourceText: String(json.selectedText || '')
        });
      }, { store: true, dashboard: true });


      sendJSON(res, 200, { ok: true, version: storeVersion, dashboardVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'POST' && pathname === '/api/update-selected-text') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const item = store.records.find(r => r.id === json.id);
      if (!item) return sendJSON(res, 404, { ok: false, error: 'Record not found' });


      const receiverId = normalizeReceiverId(json.receiverId, req);
      const reviewerName = normalizeUserName(json.reviewedBy || json.receiverName || '');
      if (isOwnRecordReviewerBlocked(reviewerName, item)) return sendJSON(res, 403, { ok: false, error: 'You cannot review your own submitted record' });


      const lock = getReviewLock(json.id);
      if (lock && lock.receiverId !== receiverId) return sendJSON(res, 409, { ok: false, error: `Locked by ${lock.receiverName}` });


      const beforeCompleted = !!item.completed;
      const newCompleted = typeof json.completed !== 'undefined' ? !!json.completed : !!item.completed;
      const nextSelectedText = normalizeFreeText(json.selectedText || '');
      const nextComment = typeof json.comment !== 'undefined' ? normalizeFreeText(json.comment || '') : (item.comment || '');
      let nextReviewedBy = item.reviewedBy || '';


      if (newCompleted) {
        if (!hasMeaningfulText(nextSelectedText)) return sendJSON(res, 400, { ok: false, error: 'selectedText is required before complete' });
        if (!hasMeaningfulText(nextComment)) return sendJSON(res, 400, { ok: false, error: 'comment is required before complete' });
      }


      if (typeof json.reviewedBy !== 'undefined') {
        nextReviewedBy = normalizeUserName(json.reviewedBy || '');
      } else if (newCompleted && lock?.receiverName) {
        nextReviewedBy = normalizeUserName(lock.receiverName);
      }


      syncAction(() => {
        item.selectedText = nextSelectedText;
        item.comment = nextComment;
        item.completed = newCompleted;
        item.reviewedBy = nextReviewedBy;


        if (!beforeCompleted && newCompleted) {
          pushRecordEvent(json.id, 'completed', 'receiver', nextReviewedBy || lock?.receiverName || '', {
            selectedText: nextSelectedText,
            selectedSourceText: item.selectedSourceText || '',
            comment: nextComment,
            reviewedBy: nextReviewedBy || lock?.receiverName || ''
          });
        } else if (beforeCompleted && !newCompleted) {
          pushRecordEvent(json.id, 'reverted', 'receiver', normalizeUserName(json.reviewedBy || '') || lock?.receiverName || '', {
            selectedText: nextSelectedText,
            selectedSourceText: item.selectedSourceText || '',
            comment: nextComment
          });
        } else {
          pushRecordEvent(json.id, 'edited', 'receiver', nextReviewedBy || lock?.receiverName || '', {
            selectedText: nextSelectedText,
            selectedSourceText: item.selectedSourceText || '',
            comment: nextComment,
            reviewedBy: nextReviewedBy || ''
          });
        }
      }, { store: true, dashboard: true });


      if (newCompleted) reviewLocks.delete(json.id);
      sendJSON(res, 200, { ok: true, version: storeVersion, dashboardVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'GET' && pathname === '/api/logs') {
    const result = getActivityLogsPage({
      page: parsedUrl.searchParams.get('page'),
      pageSize: parsedUrl.searchParams.get('pageSize'),
      search: parsedUrl.searchParams.get('search'),
      action: parsedUrl.searchParams.get('action'),
      recordType: parsedUrl.searchParams.get('recordType')
    });
    return sendJSON(res, 200, result);
  }


  if (req.method === 'GET' && pathname === '/api/user-logs') {
    const requesterRole = String(parsedUrl.searchParams.get('requesterRole') || '').trim();
    if (requesterRole !== 'admin') return sendJSON(res, 403, { ok: false, error: 'Admin only' });


    const result = getUserLogsPage({
      page: parsedUrl.searchParams.get('page'),
      pageSize: parsedUrl.searchParams.get('pageSize'),
      search: parsedUrl.searchParams.get('search'),
      type: parsedUrl.searchParams.get('type'),
      role: parsedUrl.searchParams.get('role')
    });
    return sendJSON(res, 200, result);
  }


  if (req.method === 'GET' && pathname.startsWith('/api/export-image/')) {
    const parts = pathname.substring('/api/export-image/'.length).split('/');
    const recordId = parts[0];
    const imageIndex = Number(parts[1] || '0');


    const item = store.records.find(r => r.id === recordId);
    if (!item) return sendText(res, 404, 'Record not found');
    if (item.recordType !== 'photo') return sendText(res, 400, 'Scanner records do not have exportable images');
    if (!item.selectedText) return sendText(res, 400, 'Selected OCR text is required before export');


    const images = (item.images || []).slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const image = images[imageIndex];
    if (!image) return sendText(res, 404, 'Image not found');


    const imagePath = path.join(IMAGE_DIR, image.storedName);
    let buffer;
    try { buffer = fs.readFileSync(imagePath); }
    catch { return sendText(res, 404, 'Image file missing'); }


    const ext = path.extname(imagePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    const fileName = `${sanitizeFileName(item.selectedText || 'no_selected_text')}_${sanitizeFileName(item.senderName || 'unknown_sender')}_${formatDateForFile(item.timestamp)}_${imageIndex + 1}${ext || '.jpg'}`;


    syncAction(() => {
      item.exportedName = fileName;
      pushRecordEvent(recordId, 'exported', 'receiver', item.reviewedBy || '', {
        selectedText: item.selectedText || '',
        selectedSourceText: item.selectedSourceText || '',
        reviewedBy: item.reviewedBy || '',
        exportedName: fileName
      });
    }, { store: true, dashboard: true });


    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${fileName}"`
    });
    res.end(buffer);
    return;
  }


  if (req.method === 'GET' && pathname === '/api/server-owner') {
    return sendJSON(res, 200, {
      ok: true,
      adminReceiverId: ADMIN_RECEIVER_ID,
      adminReceiverName,
      adminInitialized,
      cleanGeneration,
      version: storeVersion
    });
  }


  if (req.method === 'GET' && pathname === '/api/dashboard/meta') {
    const summary = getDashboardSummary();
    return sendJSON(res, 200, {
      ok: true,
      accessMode: getDashboardAccessMode(req),
      imports: store.dashboard.imports.slice().sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt))),
      activeImportId: store.dashboard.activeImportId || '',
      settings: summary.settings,
      version: dashboardVersion
    });
  }


  if (req.method === 'GET' && pathname === '/api/dashboard/summary') {
    return sendJSON(res, 200, {
      ...getDashboardSummary(),
      accessMode: getDashboardAccessMode(req)
    });
  }


  if (req.method === 'GET' && pathname === '/api/dashboard/rows') {
    let filters = {};
    const rawFilters = parsedUrl.searchParams.get('filters');
    if (rawFilters) {
      try { filters = JSON.parse(rawFilters); } catch {}
    }


    const result = getDashboardUnifiedRows({
      page: parsedUrl.searchParams.get('page'),
      pageSize: parsedUrl.searchParams.get('pageSize'),
      search: parsedUrl.searchParams.get('search'),
      sortBy: parsedUrl.searchParams.get('sortBy'),
      sortDir: parsedUrl.searchParams.get('sortDir'),
      status: parsedUrl.searchParams.get('status'),
      recordType: parsedUrl.searchParams.get('recordType'),
      filters
    });


    return sendJSON(res, 200, { ...result, accessMode: getDashboardAccessMode(req) });
  }


  if (req.method === 'GET' && pathname.startsWith('/api/dashboard/row/')) {
    const id = pathname.substring('/api/dashboard/row/'.length);
    const row = getDashboardRowFull(id);
    if (!row) return sendJSON(res, 404, { ok: false, error: 'Dashboard row not found' });
    return sendJSON(res, 200, { ok: true, row, version: dashboardVersion, accessMode: getDashboardAccessMode(req) });
  }


  if (req.method === 'GET' && pathname === '/api/dashboard/focus-values') {
    const column = String(parsedUrl.searchParams.get('column') || '').trim();
    const keyword = normalizeFreeText(parsedUrl.searchParams.get('keyword') || '').toLowerCase();
    if (!column) return sendJSON(res, 200, { ok: true, items: [], version: dashboardVersion });


    const rows = getImportedRowsForActiveImport();
    const unique = [...new Set(
      rows.map(r => String((r.sourceData || {})[column] || '').trim()).filter(Boolean)
    )]
      .filter(v => !keyword || v.toLowerCase().includes(keyword))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 5000);


    return sendJSON(res, 200, { ok: true, items: unique, version: dashboardVersion });
  }


  if (req.method === 'POST' && pathname === '/api/dashboard/settings') {
    if (!requireDashboardFullAccess(req, res)) return;
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const requesterRole = String(json.requesterRole || '').trim();
      if (requesterRole !== 'admin') return sendJSON(res, 403, { ok: false, error: 'Admin only' });


      const visibleColumns = Array.isArray(json.visibleColumns) ? json.visibleColumns.map(x => String(x || '')).filter(Boolean).slice(0, 10) : [];
      const importMatchColumn = String(json.importMatchColumn || '').trim();
      const inventoryMatchField = String(json.inventoryMatchField || 'selectedText').trim() || 'selectedText';
      const matchMode = String(json.matchMode || 'exact').trim().toLowerCase() === 'partial' ? 'partial' : 'exact';
      const focusRules = normalizeFocusRules(json.focusRules || [], json);


      syncAction(() => {
        store.dashboard.settings = normalizeDashboardSettings({
          visibleColumns, importMatchColumn, inventoryMatchField, matchMode, focusRules
        });
      }, { store: true, dashboard: true });


      sendJSON(res, 200, { ok: true, settings: store.dashboard.settings, version: dashboardVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'POST' && pathname === '/api/dashboard/comment') {
    if (!requireDashboardFullAccess(req, res)) return;
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const requesterRole = String(json.requesterRole || '').trim();
      const rowId = String(json.rowId || '').trim();
      const dashboardComment = normalizeFreeText(json.dashboardComment || '');


      if (requesterRole !== 'admin') return sendJSON(res, 403, { ok: false, error: 'Admin only' });


      const importRow = store.dashboard.importedRows.find(x => x.id === rowId);
      if (importRow) {
        syncAction(() => {
          importRow.dashboardComment = dashboardComment;
          importRow.updatedAt = nowIso();
        }, { store: true, dashboard: true });
        return sendJSON(res, 200, { ok: true, version: dashboardVersion });
      }


      const inventoryRow = store.dashboard.inventoryRows.find(x => x.id === rowId);
      if (!inventoryRow) return sendJSON(res, 404, { ok: false, error: 'Dashboard row not found' });


      syncAction(() => {
        inventoryRow.dashboardComment = dashboardComment;
        inventoryRow.updatedAt = nowIso();
      }, { store: true, dashboard: true });


      sendJSON(res, 200, { ok: true, version: dashboardVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'POST' && pathname === '/api/dashboard/add-found') {
    if (!requireDashboardFullAccess(req, res)) return;
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const requesterRole = String(json.requesterRole || '').trim();
      const requesterName = normalizeUserName(json.requesterName || '');
      const rowId = String(json.rowId || '').trim();


      if (requesterRole !== 'admin') return sendJSON(res, 403, { ok: false, error: 'Admin only' });


      const inventoryRow = store.dashboard.inventoryRows.find(x => x.id === rowId);
      if (!inventoryRow) return sendJSON(res, 404, { ok: false, error: 'Dashboard inventory row not found' });


      const record = store.records.find(r => r.id === inventoryRow.recordId && !r.deleted && r.completed);
      if (!record) return sendJSON(res, 404, { ok: false, error: 'Record not found' });


      const { recordToImport } = computeOneToOneDashboardMatches();
      const hasMatchedImport = recordToImport.has(record.id);
      if (hasMatchedImport) return sendJSON(res, 400, { ok: false, error: 'This inventory record already has import match' });


      const selectedText = normalizeFreeText(json.selectedText || '');
      const comment = normalizeFreeText(json.comment || '');


      const recordType = String(record.recordType || 'photo').trim().toLowerCase() === 'scanner' ? 'scanner' : 'photo';
      const reviewedBy = normalizeUserName(record.reviewedBy || '');
      const senderName = normalizeUserName(record.senderName || '');
      const addBy = normalizeUserName(requesterName || '');
      const originalTimestamp = record.timestamp || nowIso();


      if (!hasMeaningfulText(selectedText)) return sendJSON(res, 400, { ok: false, error: 'selectedText is required' });
      if (!hasMeaningfulText(comment)) return sendJSON(res, 400, { ok: false, error: 'comment is required' });


      syncAction(() => {
        record.recordType = recordType;
        record.senderName = senderName || record.senderName;
        record.selectedText = selectedText;
        record.selectedSourceText = selectedText;
        record.comment = comment;
        record.reviewedBy = reviewedBy || record.reviewedBy;
        record.timestamp = originalTimestamp;
        record.isAddNew = true;
        record.completed = true;
        record.addedBy = addBy;
        inventoryRow.updatedAt = nowIso();


        pushRecordEvent(record.id, 'edited', 'admin', requesterName || 'ADMIN', {
          selectedText: record.selectedText || '',
          selectedSourceText: record.selectedSourceText || '',
          comment: record.comment || '',
          reviewedBy: record.reviewedBy || ''
        });
      }, { store: true, dashboard: true });


      sendJSON(res, 200, { ok: true, version: dashboardVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'POST' && pathname === '/api/dashboard/import') {
    if (!requireDashboardFullAccess(req, res)) return;


    const contentType = String(req.headers['content-type'] || '');
    if (contentType.includes('multipart/form-data')) {
      requestBuffer(req).then(async buffer => {
        const parts = parseMultipartForm(buffer, contentType);
        const filePart = parts.find(p => p.fieldName === 'file' && p.fileName);
        const requesterRolePart = parts.find(p => p.fieldName === 'requesterRole');
        const requesterRole = requesterRolePart ? String(requesterRolePart.data.toString('utf8') || '').trim() : '';


        if (requesterRole !== 'admin') return sendJSON(res, 403, { ok: false, error: 'Admin only' });
        if (!filePart) return sendJSON(res, 400, { ok: false, error: 'File is required' });


        const parsed = await parseDashboardImportPayload(filePart.fileName, filePart.data);
        const importId = `imp_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
        const importedAt = nowIso();


        syncAction(() => {
          store.dashboard.imports = [{
            id: importId,
            fileName: filePart.fileName,
            importedAt,
            columns: parsed.columns,
            rowCount: parsed.rows.length
          }];


          store.dashboard.importedRows = parsed.rows.map((row, index) => ({
            id: `dimp_${Date.now()}_${Math.floor(Math.random() * 100000)}_${index + 1}`,
            importId,
            sourceIndex: index + 1,
            sourceData: row,
            dashboardComment: '',
            createdAt: importedAt,
            updatedAt: importedAt
          }));


          store.dashboard.activeImportId = importId;
          store.dashboard.settings.visibleColumns = parsed.columns.slice(0, 10);
          store.dashboard.settings.importMatchColumn = parsed.columns.length ? parsed.columns[0] : '';
          store.dashboard.settings.focusRules = [{ column: '', values: [] }];
        }, { store: true, dashboard: true });


        sendJSON(res, 200, { ok: true, importId, columns: parsed.columns, rowCount: parsed.rows.length, version: dashboardVersion });
      }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
      return;
    }


    requestBody(req).then(async body => {
      const json = JSON.parse(body || '{}');
      const requesterRole = String(json.requesterRole || '').trim();
      if (requesterRole !== 'admin') return sendJSON(res, 403, { ok: false, error: 'Admin only' });


      const fileName = String(json.fileName || '').trim();
      const base64Data = String(json.base64Data || '').trim();
      if (!fileName || !base64Data) return sendJSON(res, 400, { ok: false, error: 'fileName and base64Data are required' });


      const parsed = await parseDashboardImportPayload(fileName, Buffer.from(base64Data, 'base64'));
      const importId = `imp_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const importedAt = nowIso();


      syncAction(() => {
        store.dashboard.imports = [{
          id: importId,
          fileName,
          importedAt,
          columns: parsed.columns,
          rowCount: parsed.rows.length
        }];


        store.dashboard.importedRows = parsed.rows.map((row, index) => ({
          id: `dimp_${Date.now()}_${Math.floor(Math.random() * 100000)}_${index + 1}`,
          importId,
          sourceIndex: index + 1,
          sourceData: row,
          dashboardComment: '',
          createdAt: importedAt,
          updatedAt: importedAt
        }));


        store.dashboard.activeImportId = importId;
        store.dashboard.settings.visibleColumns = parsed.columns.slice(0, 10);
        store.dashboard.settings.importMatchColumn = parsed.columns.length ? parsed.columns[0] : '';
        store.dashboard.settings.focusRules = [{ column: '', values: [] }];
      }, { store: true, dashboard: true });


      sendJSON(res, 200, { ok: true, importId, columns: parsed.columns, rowCount: parsed.rows.length, version: dashboardVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'POST' && pathname === '/api/dashboard/clear-imports') {
    if (!requireDashboardFullAccess(req, res)) return;
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const requesterRole = String(json.requesterRole || '').trim();
      if (requesterRole !== 'admin') return sendJSON(res, 403, { ok: false, error: 'Admin only' });


      syncAction(() => {
        store.dashboard.imports = [];
        store.dashboard.activeImportId = '';
        store.dashboard.importedRows = [];
        store.dashboard.settings.importMatchColumn = '';
        store.dashboard.settings.focusRules = [{ column: '', values: [] }];
      }, { store: true, dashboard: true });


      sendJSON(res, 200, { ok: true, version: dashboardVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'GET' && pathname === '/api/dashboard/export') {
    const mode = String(parsedUrl.searchParams.get('mode') || 'visible').trim().toLowerCase();
    buildDashboardExportWorkbook(mode === 'full' ? 'full' : 'visible')
      .then(result => {
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${result.fileName}"`,
          'Content-Length': result.buffer.length,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.end(result.buffer);
      })
      .catch(e => sendJSON(res, 500, { ok: false, error: e.message }));
    return;
  }


  if (req.method === 'GET' && (pathname === '/' || pathname === '/sender' || pathname === '/receiver' || pathname === '/dashboard')) {
    return serveFile(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');
  }


  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}


(async () => {
  ensureDirSync(BACKUP_DIR);
  ensureDirSync(IMAGE_DIR);


  await backupCurrentJsonIfExists('startup');
  await loadStore();


  setInterval(expirePresenceAndPersistLogout, 10000);
  setInterval(() => {
    backupCurrentJsonIfExists('hourly').catch(err => {
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
    console.log(` Data File : ${DATA_FILE}`);
    console.log(` Image Dir : ${IMAGE_DIR}`);
    console.log(` Backup Dir: ${BACKUP_DIR}`);
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