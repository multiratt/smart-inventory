const { ADMIN_RECEIVER_ID, OFFLINE_KEEP_MS, ACTIVE_ONLINE_MS } = require('./constants');
const { normalizeUserName, normalizeFreeText, getClientIP, nowIso } = require('./utils');

const userSessions = new Map();
const pausedUsers = new Set();

function getSessionKey(deviceId) {
  return String(deviceId || '').trim();
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

function getRoleIcon(role) {
  if (role === 'admin') return '👑';
  if (role === 'receiver') return '📥';
  return '📤';
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

function markDeletedSession(deviceId, userName) {
  const { getStore } = require('./store');
  const store = getStore();
  const key = getSessionKey(deviceId);
  if (!key || !userName) return false;
  const idx = store.deletedSessions.findIndex(x => x.sessionKey === key && x.userName === userName);
  const obj = { sessionKey: key, deviceId: key, userName, time: Date.now() };
  if (idx >= 0) store.deletedSessions[idx] = obj;
  else store.deletedSessions.push(obj);
  return true;
}

function clearDeletedSession(deviceId, userName = '') {
  const { getStore } = require('./store');
  const store = getStore();
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
  const { getStore } = require('./store');
  const store = getStore();
  const key = getSessionKey(deviceId);
  return store.deletedSessions.some(x => x.sessionKey === key && x.userName === userName);
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
  const { getStore } = require('./store');
  const store = getStore();
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
  const { getStore } = require('./store');
  const store = getStore();
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
  const { getStore } = require('./store');
  const store = getStore();
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

function getUserSessionByName(name, exclude = {}) {
  const { getAdminInitialized, getAdminReceiverName } = require('./store');
  const cleanName = normalizeUserName(name);
  if (!cleanName) return null;

  for (const s of userSessions.values()) {
    if (s.userName === cleanName) {
      if (exclude.deviceId && exclude.deviceId === s.deviceId) continue;
      if (exclude.allowSameDevice && exclude.deviceId && exclude.deviceId === s.deviceId) continue;
      return s;
    }
  }

  if (getAdminInitialized() && getAdminReceiverName() === cleanName) {
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

function isUserNameDuplicate(name, deviceId = '', mode = '') {
  const { getAdminInitialized, getAdminReceiverName } = require('./store');
  const cleanName = normalizeUserName(name);
  const cleanDeviceId = String(deviceId || '').trim();
  const cleanMode = normalizeProfileMode(mode || '');
  if (!cleanName) return false;

  if ((cleanMode === 'admin' || cleanMode === 'dashboard') && getAdminInitialized() && getAdminReceiverName() === cleanName) return false;
  const profile = findDeviceProfile({ deviceId: cleanDeviceId, receiverId: cleanDeviceId, mode: cleanMode });
  if (profile && profile.userName === cleanName) return false;

  const owner = getUserSessionByName(cleanName, { deviceId: cleanDeviceId, allowSameDevice: true });
  if (!owner) return false;
  if (cleanDeviceId && owner.deviceId === cleanDeviceId) return false;
  if ((cleanMode === 'admin' || cleanMode === 'dashboard') && owner.isAdmin) return false;
  return true;
}

function getActiveUsers(senderAlerts, receiverAlerts) {
  const { getAdminInitialized, getAdminReceiverName } = require('./store');
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
      name: role === 'admin' ? (getAdminReceiverName() || s.userName) : s.userName,
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

  if (getAdminInitialized() && getAdminReceiverName()) {
    const adminKey = normalizeUserName(getAdminReceiverName());
    const existing = byName.get(adminKey);
    if (!existing || existing.role !== 'admin') {
      byName.set(adminKey, {
        id: ADMIN_RECEIVER_ID,
        receiverId: ADMIN_RECEIVER_ID,
        name: getAdminReceiverName(),
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

function registerUserMode(req, userName, deviceId, mode, receiverId = '', fingerprint = {}, options = {}) {
  const { getStore, setSyncPending, bumpStoreVersion, setSyncDone, scheduleSave } = require('./store');
  const store = getStore();
  const { pushUserLog } = require('./alerts');

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
  const { getStore, setSyncPending, bumpStoreVersion, setSyncDone, scheduleSave } = require('./store');
  const store = getStore();
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

function expirePresenceAndPersistLogout(senderAlerts, receiverAlerts) {
  const { setSyncPending, bumpStoreVersion, setSyncDone, scheduleSave } = require('./store');
  const { pushUserLog } = require('./alerts');
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

function deleteUserSessionByAdmin(targetRole, targetId, targetName, adminName, senderAlerts, receiverAlerts, reviewLocks) {
  const { getStore } = require('./store');
  const store = getStore();
  const { pushUserLog } = require('./alerts');

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
    userName: adminName || (require('./store').getAdminReceiverName()) || 'ADMIN',
    toName: cleanName,
    targetRole: cleanRole
  })) changed = true;

  return changed;
}

function pauseUser(userId) {
  if (!userId) return false;
  pausedUsers.add(String(userId).trim());
  return true;
}

function resumeUser(userId) {
  if (!userId) return false;
  pausedUsers.delete(String(userId).trim());
  return true;
}

function isUserPaused(userId) {
  if (!userId) return false;
  return pausedUsers.has(String(userId).trim());
}

module.exports = {
  userSessions,
  pausedUsers,
  getSessionKey,
  registerUserMode,
  touchUserHeartbeat,
  getActiveUsers,
  getEffectiveSessionRole,
  isEffectiveAdminSession,
  getUserSessionByName,
  isUserNameDuplicate,
  expirePresenceAndPersistLogout,
  markDeletedSession,
  clearDeletedSession,
  isDeletedSession,
  getRememberedIdentity,
  upsertDeviceProfile,
  findDeviceProfile,
  renameDeviceProfiles,
  extractFingerprint,
  getRoleIcon,
  isAdminReceiverId,
  normalizeReceiverId,
  getPresenceKeyByRoleId,
  normalizeProfileMode,
  isCompatibleMode,
  deleteUserSessionByAdmin,
  normalizeDeviceProfile,
  pauseUser,
  resumeUser,
  isUserPaused
};
