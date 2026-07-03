const { REVIEW_LOCK_MS, ADMIN_RECEIVER_ID } = require('./constants');
const { normalizeUserName, nowIso } = require('./utils');
const { getStore } = require('./store');

const senderAlerts = new Map();
const receiverAlerts = new Map();
const reviewLocks = new Map();
const renameRequests = new Map();
const renameRequestByRequester = new Map();
const renameDecisionInbox = new Map();

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

function canUseWaitGoAhead(fromRole, targetRole) {
  if (fromRole === 'admin') {
    if (targetRole === 'all') return false;
    return targetRole === 'sender' || targetRole === 'receiver' || targetRole === 'all-receivers' || targetRole === 'admin';
  }
  if (fromRole === 'receiver') return targetRole === 'sender';
  return false;
}

function clearWaitForTarget(targetRole, targetId, targetName, senderAlerts, receiverAlerts) {
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

function shouldPersistUserLog(type) {
  return [
    'user-login', 'user-logout', 'user-rename', 'user-rename-request', 'user-rename-accepted', 'user-rename-denied',
    'user-deleted',
    'team-message', 'team-wait', 'team-go-ahead'
  ].includes(type);
}

function pushUserLog(type, detail = {}) {
  const store = getStore();
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
  const store = getStore();
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

function applyApprovedRename(reqObj, adminName, userSessions, senderAlerts, forceAdminDirect = false) {
  const { getStore, setSyncPending, bumpStoreVersion, setSyncDone, scheduleSave, setAdminReceiverName, setAdminInitialized } = require('./store');
  const { renameDeviceProfiles } = require('./sessions');

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
    const store = getStore();
    store.meta.adminReceiverName = newName;
    store.meta.adminInitialized = true;
    setAdminReceiverName(newName);
    setAdminInitialized(true);
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

function clearAll() {
  userSessions.clear();
  senderAlerts.clear();
  receiverAlerts.clear();
  reviewLocks.clear();
  renameRequests.clear();
  renameRequestByRequester.clear();
  renameDecisionInbox.clear();
}

module.exports = {
  senderAlerts,
  receiverAlerts,
  reviewLocks,
  renameRequests,
  renameRequestByRequester,
  renameDecisionInbox,
  getReviewLock,
  claimReviewLock,
  releaseReviewLock,
  canUseWaitGoAhead,
  clearWaitForTarget,
  isSameTargetAsSender,
  pushUserLog,
  shouldPersistUserLog,
  pushRecordEvent,
  applyApprovedRename,
  clearAll
};
