'use strict';

// ============================================================
// Routes — all HTTP request handlers
// ============================================================

const path = require('path');
const { URL } = require('url');
const { exec } = require('child_process');
const fs = require('fs');
const fsp = require('fs').promises;

const {
  ADMIN_RECEIVER_ID, IMAGE_DIR,
} = require('./constants');

const storeMod = require('./store');
const {
  sendJSON, sendText, serveFile, nowIso,
  getClientIP, getRequestHostName, isLocalDashboardHost,
  getDashboardAccessMode, requireDashboardFullAccess,
  normalizeUserName, normalizeFreeText, hasMeaningfulText,
  normalizeRecordStatus, normalizeRecordTypeFilter,
  normalizePage, normalizePageSize,
  isRawEnglishOnlyName, sanitizeFileName, formatDateForFile,
} = require('./utils');

const sessionsMod = require('./sessions');
const recordsMod = require('./records');
const dashboardMod = require('./dashboard');
const alertsMod = require('./alerts');
const exportMod = require('./export');

function broadcastEvent(eventType, eventData) {
  if (!global.__sseClients || !global.__sseClients.length) return;
  const payload = 'event: ' + eventType + '\ndata: ' + JSON.stringify({ type: eventType, ...eventData }) + '\n\n';
  for (const client of global.__sseClients) {
    try {
      client.res.write(payload);
    } catch (e) {
      console.error('SSE write error:', e.message);
    }
  }
}

function requestHandler(req, res) {
  const store = storeMod.getStore();
  const { bumpStoreVersion, bumpDashboardVersion, syncAction } = storeMod;
  const cleanGeneration = storeMod.getCleanGeneration();
  const adminReceiverName = storeMod.getAdminReceiverName();
  const adminInitialized = storeMod.getAdminInitialized();
  const storeVersion = storeMod.getStoreVersion();
  const dashboardVersion = storeMod.getDashboardVersion();

  const { userSessions } = sessionsMod;
  const { senderAlerts, receiverAlerts, reviewLocks, renameRequests, renameRequestByRequester, renameDecisionInbox } = alertsMod;

  const { expirePresenceAndPersistLogout } = sessionsMod;
  const { registerUserMode, touchUserHeartbeat, isDeletedSession, isUserNameDuplicate, getRememberedIdentity } = sessionsMod;
  const { getActiveUsers } = sessionsMod;
  const { isOwnRecordReviewerBlocked } = recordsMod;
  const { getReviewLock, claimReviewLock, releaseReviewLock, pushRecordEvent, applyApprovedRename, deleteUserSessionByAdmin } = alertsMod;
  const { normalizeReceiverId, isAdminReceiverId, normalizeProfileMode } = sessionsMod;
  const { getPresenceKeyByRoleId } = alertsMod;
  const { pushUserLog: sessionsPushUserLog } = sessionsMod;
  const { pushUserLog } = alertsMod;

  const {
    getRecordById, getRecordsPage, getActivityLogsPage, getUserLogsPage,
    saveBase64ImageToFile, canDeleteRecord,
  } = recordsMod;

  const {
    getDashboardSummary, getDashboardUnifiedRows, buildDashboardUnifiedRowsRaw,
    getDashboardRowFull, rebuildDashboardInventoryRows,
    getImportedRowsForActiveImport, computeOneToOneDashboardMatches,
    isRecordFoundInDashboard, parseDashboardImportPayload,
    buildDashboardExportWorkbook,
  } = dashboardMod;

  const { parseMultipartForm } = exportMod;

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

  // ── helpers ─────────────────────────────────────────────────
  function requestBody(req, limit = 120 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > limit) { reject(new Error('Payload too large')); req.destroy(); } });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }
  function requestBuffer(req, limit = 120 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      const chunks = []; let total = 0;
      req.on('data', chunk => { total += chunk.length; if (total > limit) { reject(new Error('Payload too large')); req.destroy(); return; } chunks.push(chunk); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  // ── /api/dashboard-access ────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/dashboard-access') {
    const accessMode = getDashboardAccessMode(req);
    return sendJSON(res, 200, { ok: true, allowDashboard: true, accessMode,
      message: accessMode === 'full' ? 'full access' : 'read only access', version: storeVersion });
  }

  // ── /image/ ──────────────────────────────────────────────────
  if (req.method === 'GET' && pathname.startsWith('/image/')) {
    const { ensureDirSync } = require('./utils');
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

  // ── /api/device-identity ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/device-identity') {
    const deviceId = String(parsedUrl.searchParams.get('deviceId') || '').trim();
    const receiverId = String(parsedUrl.searchParams.get('receiverId') || '').trim();
    const mode = String(parsedUrl.searchParams.get('mode') || '').trim();
    const remembered = sessionsMod.getRememberedIdentity({ deviceId, receiverId, mode });
    return sendJSON(res, 200, { ok: true, found: !!remembered, rememberedName: remembered ? remembered.userName : '',
      lastKnownMode: remembered ? remembered.lastKnownMode : '', identity: remembered || null,
      cleanGeneration, adminReceiverId: ADMIN_RECEIVER_ID, version: storeVersion });
  }

  // ── /api/check-sender-name ────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/check-sender-name') {
    const rawName = String(parsedUrl.searchParams.get('name') || '').trim();
    const deviceId = String(parsedUrl.searchParams.get('deviceId') || '').trim();
    if (!rawName) return sendJSON(res, 200, { ok: true, duplicate: false, valid: false, normalized: '' });
    if (!isRawEnglishOnlyName(rawName)) return sendJSON(res, 200, { ok: true, duplicate: false, valid: false, normalized: '' });
    const normalized = normalizeUserName(rawName);
    const exists = sessionsMod.isUserNameDuplicate(normalized, deviceId, 'sender');
    return sendJSON(res, 200, { ok: true, duplicate: exists, valid: true, normalized, version: storeVersion });
  }

  // ── /api/check-receiver-name ──────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/check-receiver-name') {
    const rawName = String(parsedUrl.searchParams.get('name') || '').trim();
    const receiverId = String(parsedUrl.searchParams.get('receiverId') || '').trim();
    const mode = String(parsedUrl.searchParams.get('mode') || 'receiver').trim();
    const deviceId = String(parsedUrl.searchParams.get('deviceId') || receiverId || '').trim();
    if (!rawName) {
      return sendJSON(res, 200, { ok: true, duplicate: false, valid: false, normalized: '', adminName: adminReceiverName, adminInitialized, version: storeVersion });
    }
    if (!isRawEnglishOnlyName(rawName)) {
      return sendJSON(res, 200, { ok: true, duplicate: false, valid: false, normalized: '', adminName: adminReceiverName, adminInitialized, version: storeVersion });
    }
    const normalized = normalizeUserName(rawName);
    const exists = sessionsMod.isUserNameDuplicate(normalized, deviceId, mode);
    return sendJSON(res, 200, { ok: true, duplicate: exists, valid: true, normalized, adminName: adminReceiverName, adminInitialized, version: storeVersion });
  }

  // ── /api/rename-request ───────────────────────────────────────
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
      const owner = sessionsMod.getUserSessionByName(requestedName, { deviceId: requesterId });
      if (owner && !owner.isAdmin) {
        return sendJSON(res, 400, { ok: false, error: 'Requested name already exists in system' });
      }
      if (requesterRole === 'admin') {
        let changed = false;
        syncAction(() => {
          changed = applyApprovedRename({ requesterRole, requesterId, currentName, requestedName }, currentName, true);
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
      const reqObj = { id: requestId, status: 'pending', createdAt: nowIso(), requesterRole, requesterId, currentName, requestedName };
      renameRequests.set(requestId, reqObj);
      renameRequestByRequester.set(requesterKey, requestId);
      receiverAlerts.set(ADMIN_RECEIVER_ID, {
        id: `rename_alert_${requestId}`, type: 'rename-request', requestId,
        fromRole: requesterRole, fromId: requesterId, fromName: currentName,
        targetRole: 'admin', targetId: ADMIN_RECEIVER_ID, targetName: adminReceiverName,
        message: `${currentName} requests rename to ${requestedName}`, time: nowIso()
      });
      sessionsPushUserLog('user-rename-request', {
        role: requesterRole, userId: requesterId, userName: currentName,
        requestOldName: currentName, requestNewName: requestedName
      });
      sendJSON(res, 200, { ok: true, requestId, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  // ── /api/rename-request-status ────────────────────────────────
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

  // ── /api/rename-decision-ack ──────────────────────────────────
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

  // ── /api/admin-rename-requests ─────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/admin-rename-requests') {
    const requesterRole = String(parsedUrl.searchParams.get('requesterRole') || '').trim();
    const requesterId = String(parsedUrl.searchParams.get('requesterId') || '').trim();
    if (requesterRole !== 'admin' || requesterId !== ADMIN_RECEIVER_ID) return sendJSON(res, 403, { ok: false, error: 'Admin only' });
    const items = [...renameRequests.values()].filter(x => x.status === 'pending').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return sendJSON(res, 200, { ok: true, items, version: storeVersion });
  }

  // ── /api/admin-rename-decision ─────────────────────────────────
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
        const owner = sessionsMod.getUserSessionByName(reqObj.requestedName, { deviceId: reqObj.requesterId });
        if (owner && !owner.isAdmin) {
          reqObj.status = 'denied'; reqObj.decidedAt = nowIso(); reqObj.decision = 'deny';
          renameRequestByRequester.delete(requesterKey);
          renameDecisionInbox.set(requesterKey, { type: 'rename-decision', requestId, decision: 'deny', oldName: reqObj.currentName, newName: reqObj.requestedName, message: `Rename denied. The requested name "${reqObj.requestedName}" is no longer available.` });
          sessionsPushUserLog('user-rename-denied', { role: 'admin', userId: ADMIN_RECEIVER_ID, userName: adminName, requestOldName: reqObj.currentName, requestNewName: reqObj.requestedName });
          return sendJSON(res, 200, { ok: true, applied: false, autoDenied: true, version: storeVersion });
        }
        syncAction(() => {
          applyApprovedRename(reqObj, adminName || adminReceiverName || 'ADMIN');
          reqObj.status = 'accepted'; reqObj.decidedAt = nowIso(); reqObj.decision = 'accept';
          renameRequestByRequester.delete(requesterKey);
          renameDecisionInbox.set(requesterKey, { type: 'rename-decision', requestId, decision: 'accept', oldName: reqObj.currentName, newName: reqObj.requestedName, message: `Rename approved. Your name is now "${reqObj.requestedName}".` });
        }, { store: true, dashboard: false });
        return sendJSON(res, 200, { ok: true, applied: true, version: storeVersion });
      }
      // deny
      syncAction(() => {
        reqObj.status = 'denied'; reqObj.decidedAt = nowIso(); reqObj.decision = 'deny';
        renameRequestByRequester.delete(requesterKey);
        renameDecisionInbox.set(requesterKey, { type: 'rename-decision', requestId, decision: 'deny', oldName: reqObj.currentName, newName: reqObj.requestedName, message: 'Rename denied by admin.' });
        sessionsPushUserLog('user-rename-denied', { role: 'admin', userId: ADMIN_RECEIVER_ID, userName: adminName || adminReceiverName || 'ADMIN', requestOldName: reqObj.currentName, requestNewName: reqObj.requestedName });
      }, { store: true, dashboard: false });
      sendJSON(res, 200, { ok: true, applied: false, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  // ── /api/set-receiver-name ─────────────────────────────────────
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
      sessionsMod.clearDeletedSession(deviceId || receiverId, receiverName);
      if (isAdmin) {
        if (!isAdminReceiverId(receiverId)) return sendJSON(res, 403, { ok: false, error: 'Only admin id can register as admin' });
        if (sessionsMod.isUserNameDuplicate(receiverName, deviceId, mode) && receiverName !== adminReceiverName) {
          return sendJSON(res, 400, { ok: false, error: 'Receiver name already exists in system' });
        }
        syncAction(() => {
          storeMod.adminReceiverName = receiverName;
          storeMod.adminInitialized = true;
          store.meta.adminReceiverName = storeMod.adminReceiverName;
          store.meta.adminInitialized = true;
          sessionsMod.upsertDeviceProfile({ deviceId, receiverId, userName: receiverName, mode, req, fingerprint });
        }, { store: true, dashboard: false });
        registerUserMode(req, receiverName, deviceId, mode, receiverId, fingerprint, { silentLog: mode === 'dashboard' });
      } else {
        if (sessionsMod.isUserNameDuplicate(receiverName, deviceId, mode)) return sendJSON(res, 400, { ok: false, error: 'Receiver name already exists in system' });
        const result = sessionsMod.upsertDeviceProfile({ deviceId, receiverId, userName: receiverName, mode, req, fingerprint });
        if (result.changed) { storeMod.setSyncPending(); bumpStoreVersion(); storeMod.setSyncDone(); storeMod.scheduleSave(); }
        registerUserMode(req, receiverName, deviceId, mode, receiverId, fingerprint);
      }
      const remembered = sessionsMod.getRememberedIdentity({ deviceId, receiverId, mode });
      sendJSON(res, 200, { ok: true, normalized: receiverName, rememberedName: remembered ? remembered.userName : receiverName,
        adminName: storeMod.adminReceiverName, adminInitialized: storeMod.adminInitialized, cleanGeneration, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  // ── /api/receiver-heartbeat ────────────────────────────────────
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
      if (clientGeneration !== storeMod.cleanGeneration) return sendJSON(res, 200, { ok: false, deletedByAdmin: true, cleanGeneration: storeMod.cleanGeneration });
      const remembered = sessionsMod.getRememberedIdentity({ deviceId, receiverId, mode });
      if (!receiverName) {
        return sendJSON(res, 200, { ok: true, rememberedName: remembered ? remembered.userName : '', deletedByAdmin: false,
          cleanGeneration: storeMod.cleanGeneration, adminName: storeMod.adminReceiverName, adminInitialized: storeMod.adminInitialized, version: storeVersion });
      }
      if (sessionsMod.isDeletedSession(deviceId || receiverId, receiverName)) return sendJSON(res, 200, { ok: false, deletedByAdmin: true, cleanGeneration: storeMod.cleanGeneration });
      if (isAdmin && !isAdminReceiverId(receiverId)) return sendJSON(res, 403, { ok: false, error: 'Invalid admin receiver id' });
      touchUserHeartbeat(req, receiverName, deviceId || receiverId, mode, receiverId, fingerprint);
      sendJSON(res, 200, { ok: true, adminName: storeMod.adminReceiverName, adminInitialized: storeMod.adminInitialized,
        rememberedName: receiverName, deletedByAdmin: false, cleanGeneration: storeMod.cleanGeneration, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  // ── /api/ping ──────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/ping') {
    return sendJSON(res, 200, { ok: true, now: Date.now(), version: storeVersion });
  }

  // ── /api/sender-heartbeat ──────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/sender-heartbeat') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const senderName = normalizeUserName(json.senderName || '');
      const deviceId = String(json.deviceId || '').trim();
      const clientGeneration = Number(json.cleanGeneration || 0);
      const fingerprint = json.fingerprint || {};
      if (clientGeneration !== storeMod.cleanGeneration) return sendJSON(res, 200, { ok: false, deletedByReceiver: true, cleanGeneration: storeMod.cleanGeneration });
      const remembered = sessionsMod.getRememberedIdentity({ deviceId, receiverId: '', mode: 'sender' });
      if (!senderName || !deviceId) {
        return sendJSON(res, 200, { ok: true, deletedByReceiver: false, rememberedName: remembered ? remembered.userName : '', cleanGeneration: storeMod.cleanGeneration, version: storeVersion });
      }
      if (sessionsMod.isDeletedSession(deviceId, senderName)) {
        return sendJSON(res, 200, { ok: false, deletedByReceiver: true, cleanGeneration: storeMod.cleanGeneration, version: storeVersion });
      }
      touchUserHeartbeat(req, senderName, deviceId, 'sender', '', fingerprint);
      sendJSON(res, 200, { ok: true, deletedByReceiver: false, rememberedName: senderName, cleanGeneration: storeMod.cleanGeneration, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  // ── /api/active-senders ────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/active-senders') {
    return sendJSON(res, 200, { ok: true, senders: sessionsMod.getActiveUsers(), version: storeVersion });
  }

  // ── /api/delete-user ───────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/delete-user') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const requesterRole = String(json.requesterRole || '').trim();
      const targetRole = String(json.targetRole || '').trim();
      const targetId = String(json.targetId || '').trim();
      const targetName = normalizeUserName(json.targetName || '');
      const adminName = normalizeUserName(json.adminName || storeMod.adminReceiverName || '');
      if (requesterRole !== 'admin') return sendJSON(res, 403, { ok: false, error: 'Admin only' });
      if (!targetRole || !targetId || !targetName) return sendJSON(res, 400, { ok: false, error: 'targetRole, targetId, targetName are required' });
      if (targetRole === 'all' || targetRole === 'all-receivers') return sendJSON(res, 400, { ok: false, error: 'Unsupported target role' });
      if (targetRole === 'admin' && targetId === ADMIN_RECEIVER_ID) return sendJSON(res, 400, { ok: false, error: 'Cannot delete main admin user' });
      let changed = false;
      syncAction(() => { changed = deleteUserSessionByAdmin(targetRole, targetId, targetName, adminName); }, { store: true, dashboard: false });
      return sendJSON(res, 200, { ok: true, changed, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  // ── /api/team-message ───────────────────────────────────────────
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
      if (!fromRole || !fromId || !fromName || !message) return sendJSON(res, 400, { ok: false, error: 'fromRole, fromId, fromName, message are required' });
      const isWaitAction = normalizedMessage === 'wait' || normalizedMessage === 'go ahead';
      if (isWaitAction && !alertsMod.canUseWaitGoAhead(fromRole, targetRole)) {
        return sendJSON(res, 400, { ok: false, error: 'This role cannot send wait/go ahead to target role' });
      }
      const messageLogType = normalizedMessage === 'wait' ? 'team-wait' : normalizedMessage === 'go ahead' ? 'team-go-ahead' : 'team-message';
      if (targetRole === 'sender') {
        if (!targetName) return sendJSON(res, 400, { ok: false, error: 'targetName is required for sender target' });
        if (fromName === targetName && fromRole === 'sender') return sendJSON(res, 400, { ok: false, error: 'Cannot send message to self' });
        syncAction(() => {
          if (normalizedMessage === 'go ahead') alertsMod.clearWaitForTarget('sender', '', targetName);
          senderAlerts.set(targetName, { id: `${Date.now()}_${Math.floor(Math.random() * 100000)}`, fromRole, fromId, fromName, targetRole, targetId, targetName, message, time: nowIso() });
          sessionsPushUserLog(messageLogType, { role: fromRole, userId: fromId, userName: fromName, fromName, toName: targetName, targetRole, actorRole: fromRole });
        }, { store: true, dashboard: false });
        return sendJSON(res, 200, { ok: true, version: storeVersion });
      }
      if (targetRole === 'receiver' || targetRole === 'admin') {
        if (!targetId) return sendJSON(res, 400, { ok: false, error: 'targetId is required for receiver/admin target' });
        if (fromId === targetId && fromRole !== 'admin') return sendJSON(res, 400, { ok: false, error: 'Cannot send message to self' });
        syncAction(() => {
          if (normalizedMessage === 'go ahead') alertsMod.clearWaitForTarget(targetRole, targetId, '');
          receiverAlerts.set(targetId, { id: `${Date.now()}_${Math.floor(Math.random() * 100000)}`, fromRole, fromId, fromName, targetRole, targetId, targetName, message, time: nowIso() });
          sessionsPushUserLog(messageLogType, { role: fromRole, userId: fromId, userName: fromName, fromName, toName: targetName, targetRole, actorRole: fromRole });
        }, { store: true, dashboard: false });
        return sendJSON(res, 200, { ok: true, version: storeVersion });
      }
      if (targetRole === 'all-receivers') {
        const targets = sessionsMod.getActiveUsers().filter(x => (x.role === 'receiver' || x.role === 'admin') && !alertsMod.isSameTargetAsSender(x, fromRole, fromId, fromName));
        syncAction(() => {
          for (const target of targets) {
            if (normalizedMessage === 'go ahead') alertsMod.clearWaitForTarget(target.role, target.receiverId || target.id, '');
            receiverAlerts.set(target.receiverId || target.id, { id: `${Date.now()}_${Math.floor(Math.random() * 100000)}_${target.id}`, fromRole, fromId, fromName, targetRole: target.role, targetId: target.receiverId || target.id, targetName: target.name, message, time: nowIso() });
            sessionsPushUserLog(messageLogType, { role: fromRole, userId: fromId, userName: fromName, fromName, toName: target.name, targetRole: target.role, actorRole: fromRole });
          }
        }, { store: true, dashboard: false });
        return sendJSON(res, 200, { ok: true, delivered: targets.length, version: storeVersion });
      }
      if (targetRole === 'all') {
        const senderTargets = sessionsMod.getActiveUsers().filter(x => x.role === 'sender' && !alertsMod.isSameTargetAsSender(x, fromRole, fromId, fromName));
        const receiverTargets = sessionsMod.getActiveUsers().filter(x => (x.role === 'receiver' || x.role === 'admin') && !alertsMod.isSameTargetAsSender(x, fromRole, fromId, fromName));
        syncAction(() => {
          senderTargets.forEach(target => {
            senderAlerts.set(target.name, { id: `${Date.now()}_${Math.floor(Math.random() * 100000)}_${target.id}`, fromRole, fromId, fromName, targetRole: target.role, targetId: target.id, targetName: target.name, message, time: nowIso(), broadcast: true });
            sessionsPushUserLog(messageLogType, { role: fromRole, userId: fromId, userName: fromName, fromName, toName: target.name, targetRole: target.role, actorRole: fromRole });
          });
          receiverTargets.forEach(target => {
            receiverAlerts.set(target.receiverId || target.id, { id: `${Date.now()}_${Math.floor(Math.random() * 100000)}_${target.id}`, fromRole, fromId, fromName, targetRole: target.role, targetId: target.receiverId || target.id, targetName: target.name, message, time: nowIso(), broadcast: true });
            sessionsPushUserLog(messageLogType, { role: fromRole, userId: fromId, userName: fromName, fromName, toName: target.name, targetRole: target.role, actorRole: fromRole });
          });
        }, { store: true, dashboard: false });
        return sendJSON(res, 200, { ok: true, delivered: senderTargets.length + receiverTargets.length, version: storeVersion });
      }
      return sendJSON(res, 400, { ok: false, error: 'Unsupported target role' });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  // ── /api/sender-alert ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/sender-alert') {
    const senderName = normalizeUserName(parsedUrl.searchParams.get('senderName') || '');
    const deviceId = String(parsedUrl.searchParams.get('deviceId') || '').trim();
    if (!senderName && deviceId) {
      const remembered = sessionsMod.getRememberedIdentity({ deviceId, mode: 'sender' });
      return sendJSON(res, 200, { ok: true, alert: null, deletedByReceiver: false, rememberedName: remembered ? remembered.userName : '', cleanGeneration: storeMod.cleanGeneration, version: storeVersion });
    }
    if (!senderName) return sendJSON(res, 200, { ok: true, alert: null, deletedByReceiver: false, version: storeVersion });
    if (deviceId && sessionsMod.isDeletedSession(deviceId, senderName)) {
      return sendJSON(res, 200, { ok: true, deletedByReceiver: true, alert: null, cleanGeneration: storeMod.cleanGeneration, version: storeVersion });
    }
    const alert = senderAlerts.get(senderName) || null;
    return sendJSON(res, 200, { ok: true, alert, deletedByReceiver: false, cleanGeneration: storeMod.cleanGeneration, version: storeVersion });
  }

  // ── /api/receiver-alert ───────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/receiver-alert') {
    const receiverId = String(parsedUrl.searchParams.get('receiverId') || '').trim();
    const receiverName = normalizeUserName(parsedUrl.searchParams.get('receiverName') || '');
    if (!receiverId) return sendJSON(res, 200, { ok: true, alert: null, deletedByAdmin: false, version: storeVersion });
    if (receiverName && sessionsMod.isDeletedSession(receiverId, receiverName)) {
      return sendJSON(res, 200, { ok: true, alert: null, deletedByAdmin: true, cleanGeneration: storeMod.cleanGeneration, version: storeVersion });
    }
    const alert = receiverAlerts.get(receiverId) || null;
    return sendJSON(res, 200, { ok: true, alert, deletedByAdmin: false, cleanGeneration: storeMod.cleanGeneration, version: storeVersion });
  }

  // ── /api/sender-alert-ack ──────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/sender-alert-ack') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const senderName = normalizeUserName(json.senderName || '');
      const alertId = String(json.alertId || '').trim();
      const existing = senderAlerts.get(senderName);
      if (existing && existing.id === alertId) {
        if (String(existing.message || '').trim().toLowerCase() !== 'wait') {
          senderAlerts.delete(senderName);
          storeMod.setSyncPending(); bumpStoreVersion(); storeMod.setSyncDone(); storeMod.scheduleSave();
        }
      }
      sendJSON(res, 200, { ok: true, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  // ── /api/receiver-alert-ack ────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/receiver-alert-ack') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const receiverId = String(json.receiverId || '').trim();
      const alertId = String(json.alertId || '').trim();
      const existing = receiverAlerts.get(receiverId);
      if (existing && existing.id === alertId) {
        if (String(existing.message || '').trim().toLowerCase() !== 'wait' && existing.type !== 'rename-request') {
          receiverAlerts.delete(receiverId);
          storeMod.setSyncPending(); bumpStoreVersion(); storeMod.setSyncDone(); storeMod.scheduleSave();
        }
      }
      sendJSON(res, 200, { ok: true, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  // ── /api/interfaces ────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/interfaces') {
    const { getAllLocalIPs } = require('./utils');
    const { PORT } = require('./constants');
    return sendJSON(res, 200, {
      ok: true,
      senderUrls: getAllLocalIPs().map((item, index) => ({
        label: `[${index + 1}] ${item.interface}`, interface: item.interface, address: item.address,
        senderUrl: `http://${item.address}:${PORT}/sender`,
        receiverUrl: `http://${item.address}:${PORT}/receiver`,
        dashboardUrl: `http://${item.address}:${PORT}/dashboard`,
      })),
      version: storeVersion,
    });
  }

  // ── /api/sync-status ───────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/sync-status') {
    return sendJSON(res, 200, { ok: true, status: store.meta.lastSyncStatus || 'done',
      lastSyncTime: store.meta.lastSyncTime || '', cleanGeneration: storeMod.cleanGeneration, version: storeVersion });
  }

  // ── /api/review-lock/claim ─────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/review-lock/claim') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const recordId = String(json.recordId || '').trim();
      const receiverId = normalizeReceiverId(json.receiverId, req);
      const receiverName = normalizeUserName(json.receiverName || '');
      if (!recordId || !receiverName) return sendJSON(res, 400, { ok: false, error: 'recordId and receiverName are required' });
      if (sessionsMod.isDeletedSession(receiverId, receiverName)) return sendJSON(res, 403, { ok: false, deletedByAdmin: true, error: 'Receiver deleted by admin' });
      const record = store.records.find(r => r.id === recordId && !r.deleted);
      if (!record) return sendJSON(res, 404, { ok: false, error: 'Record not found' });
      if (recordsMod.isOwnRecordReviewerBlocked(receiverName, record)) return sendJSON(res, 403, { ok: false, error: 'You cannot review your own submitted record' });
      const result = alertsMod.claimReviewLock(recordId, receiverId, receiverName);
      if (!result.ok) return sendJSON(res, 200, { ok: false, lockedBy: result.lock.receiverName, lock: result.lock, version: storeVersion });
      syncAction(() => {
        alertsMod.pushRecordEvent(recordId, 'review-claimed', 'receiver', receiverName, { reviewedBy: receiverName });
      }, { store: true, dashboard: false });
      sendJSON(res, 200, { ok: true, lock: result.lock, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  // ── /api/review-lock/release ────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/review-lock/release') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const recordId = String(json.recordId || '').trim();
      const receiverId = normalizeReceiverId(json.receiverId, req);
      if (!recordId) return sendJSON(res, 400, { ok: false, error: 'recordId is required' });
      const current = alertsMod.getReviewLock(recordId);
      const ok = alertsMod.releaseReviewLock(recordId, receiverId);
      if (ok && current && current.receiverId === receiverId) {
        syncAction(() => {
          alertsMod.pushRecordEvent(recordId, 'review-released', 'receiver', current.receiverName, { reviewedBy: current.receiverName });
        }, { store: true, dashboard: false });
      }
      sendJSON(res, 200, { ok, version: storeVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  // ── /api/review-lock ───────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/review-lock') {
    const recordId = String(parsedUrl.searchParams.get('recordId') || '').trim();
    const lock = alertsMod.getReviewLock(recordId);
    return sendJSON(res, 200, { ok: true, lock, version: storeVersion });
  }

  // ── /api/export-complete-zip ──────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/export-complete-zip') {
    const requesterRole = String(parsedUrl.searchParams.get('requesterRole') || '').trim();
    if (requesterRole !== 'admin') return sendText(res, 403, 'Forbidden');
    exportMod.buildExportWorkbookForRole('admin').then(({ buffer, fileName }) => {
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': buffer.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache', Expires: '0'
      });
      res.end(buffer);
    }).catch(e => sendText(res, 500, e.message));
    return;
  }

  // ── /api/clean-database ─────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/clean-database') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const requesterRole = String(json.requesterRole || '').trim();
      if (requesterRole !== 'admin') return sendJSON(res, 403, { ok: false, error: 'Only admin can clean database' });
      storeMod.cleanDatabaseAndImages().then(() => sendJSON(res, 200, { ok: true, cleanGeneration: storeMod.cleanGeneration, version: storeMod.storeVersion }))
        .catch(e => sendJSON(res, 500, { ok: false, error: e.message }));
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  // ── /api/upload-record ──────────────────────────────────────────
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
      if (clientGeneration !== storeMod.cleanGeneration) {
        return sendJSON(res, 400, { ok: false, deletedByReceiver: true, error: 'Session reset. Please set a name again.', cleanGeneration: storeMod.cleanGeneration });
      }
      if (sessionsMod.isDeletedSession(deviceId, senderName)) {
        return sendJSON(res, 400, { ok: false, deletedByReceiver: true, error: 'This user was deleted by receiver. Please set a name again.', cleanGeneration: storeMod.cleanGeneration });
      }
      if (requireComment && !hasMeaningfulText(comment)) return sendJSON(res, 400, { ok: false, error: 'Comment is required' });
      if (recordType === 'photo') {
        if (images.length < 2 || images.length > 4) return sendJSON(res, 400, { ok: false, error: 'Minimum 2 and maximum 4 images are required per record.' });
      } else {
        if (images.length !== 0) return sendJSON(res, 400, { ok: false, error: 'Scanner records must not include images.' });
        if (!hasMeaningfulText(json.scannerText || '')) return sendJSON(res, 400, { ok: false, error: 'scannerText is required for scanner record.' });
      }
      registerUserMode(req, senderName, deviceId, 'sender', '', fingerprint);
      const id = Date.now().toString() + '_' + Math.floor(Math.random() * 100000);
      const scannerText = normalizeFreeText(json.scannerText || '');
      const savedImages = [];
      for (let i = 0; i < images.length; i++) {
        savedImages.push(await recordsMod.saveBase64ImageToFile(images[i].data, images[i].name || `timestamp_${Date.now()}_${i + 1}.jpg`));
      }
      syncAction(() => {
        const record = {
          id, timestamp: nowIso(), senderName, deviceId, recordType,
          selectedText: recordType === 'scanner' ? scannerText : '',
          selectedSourceText: recordType === 'scanner' ? scannerText : '',
          comment, reviewedBy: '', addedBy: '', exportedName: '', completed: false, deleted: false, isAddNew: false,
          images: savedImages.map((img, i) => ({
            id: `${id}_img_${i + 1}`, name: img.fileName, storedName: img.storedName,
            url: `/image/${encodeURIComponent(img.storedName)}`, createdAt: nowIso(), sortOrder: i + 1
          })), timeline: []
        };
        store.records.push(record);
        alertsMod.pushRecordEvent(id, 'submitted', 'sender', senderName, {
          selectedText: recordType === 'scanner' ? scannerText : '',
          selectedSourceText: recordType === 'scanner' ? scannerText : '',
          comment
        });
      }, { store: true, dashboard: true });
      sendJSON(res, 200, { ok: true, id, version: storeMod.storeVersion, dashboardVersion: storeMod.dashboardVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  // ── /api/delete-record ─────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/delete-record') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const requesterRole = String(json.requesterRole || '').trim();
      const item = store.records.find(r => r.id === json.id);
      if (!item) return sendJSON(res, 404, { ok: false, error: 'Record not found' });
      if (!recordsMod.canDeleteRecord(requesterRole, item)) {
        if (requesterRole !== 'admin') return sendJSON(res, 403, { ok: false, error: 'Only admin can delete records' });
        if (item.completed) return sendJSON(res, 400, { ok: false, error: 'Completed records cannot be deleted' });
        return sendJSON(res, 400, { ok: false, error: 'Delete not allowed' });
      }
      syncAction(() => {
        item.deleted = true;
        alertsMod.reviewLocks.delete(json.id);
        alertsMod.pushRecordEvent(json.id, 'deleted', 'admin', normalizeUserName(json.actorName || ''), {});
      }, { store: true, dashboard: true });
      sendJSON(res, 200, { ok: true, version: storeMod.storeVersion, dashboardVersion: storeMod.dashboardVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  // ── /api/records ────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/records') {
    const result = recordsMod.getRecordsPage({
      page: parsedUrl.searchParams.get('page'), pageSize: parsedUrl.searchParams.get('pageSize'),
      status: parsedUrl.searchParams.get('status'), search: parsedUrl.searchParams.get('search'),
      recordType: parsedUrl.searchParams.get('recordType'), senderName: parsedUrl.searchParams.get('senderName'),
    });
    return sendJSON(res, 200, result);
  }

  // ── /api/record/:id ────────────────────────────────────────────
  if (req.method === 'GET' && pathname.startsWith('/api/record/')) {
    const id = pathname.substring('/api/record/'.length);
    const item = recordsMod.getRecordById(id, true);
    if (!item) return sendJSON(res, 404, { ok: false, error: 'Record not found' });
    const requesterName = normalizeUserName(parsedUrl.searchParams.get('requesterName') || '');
    const recordRaw = store.records.find(r => r.id === id);
    return sendJSON(res, 200, {
      ...item, foundInDashboard: dashboardMod.isRecordFoundInDashboard(id),
      reviewLock: alertsMod.getReviewLock(id),
      ownRecordBlocked: requesterName ? recordsMod.isOwnRecordReviewerBlocked(requesterName, recordRaw) : false,
      version: storeVersion,
    });
  }

  // ── /api/select-ocr ────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/select-ocr') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const item = store.records.find(r => r.id === json.id);
      if (!item) return sendJSON(res, 404, { ok: false, error: 'Record not found' });
      const receiverId = normalizeReceiverId(json.receiverId, req);
      const receiverName = normalizeUserName(json.receiverName || '');
      if (recordsMod.isOwnRecordReviewerBlocked(receiverName, item)) return sendJSON(res, 403, { ok: false, error: 'You cannot review your own submitted record' });
      const lock = alertsMod.getReviewLock(json.id);
      if (lock && lock.receiverId !== receiverId) return sendJSON(res, 409, { ok: false, error: `Locked by ${lock.receiverName}` });
      syncAction(() => {
        item.selectedSourceText = String(json.selectedText || '');
        item.selectedText = String(json.selectedText || '');
        alertsMod.pushRecordEvent(json.id, 'ocr-selected', 'receiver', lock?.receiverName || '', { selectedText: String(json.selectedText || ''), selectedSourceText: String(json.selectedText || '') });
      }, { store: true, dashboard: true });
      sendJSON(res, 200, { ok: true, version: storeMod.storeVersion, dashboardVersion: storeMod.dashboardVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  // ── /api/update-selected-text ─────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/update-selected-text') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const item = store.records.find(r => r.id === json.id);
      if (!item) return sendJSON(res, 404, { ok: false, error: 'Record not found' });
      const receiverId = normalizeReceiverId(json.receiverId, req);
      const reviewerName = normalizeUserName(json.reviewedBy || json.receiverName || '');
      if (recordsMod.isOwnRecordReviewerBlocked(reviewerName, item)) return sendJSON(res, 403, { ok: false, error: 'You cannot review your own submitted record' });
      const lock = alertsMod.getReviewLock(json.id);
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
          alertsMod.pushRecordEvent(json.id, 'completed', 'receiver', nextReviewedBy || lock?.receiverName || '', { selectedText: nextSelectedText, selectedSourceText: item.selectedSourceText || '', comment: nextComment, reviewedBy: nextReviewedBy || lock?.receiverName || '' });
        } else if (beforeCompleted && !newCompleted) {
          alertsMod.pushRecordEvent(json.id, 'reverted', 'receiver', normalizeUserName(json.reviewedBy || '') || lock?.receiverName || '', { selectedText: nextSelectedText, selectedSourceText: item.selectedSourceText || '', comment: nextComment });
        } else {
          alertsMod.pushRecordEvent(json.id, 'edited', 'receiver', nextReviewedBy || lock?.receiverName || '', { selectedText: nextSelectedText, selectedSourceText: item.selectedSourceText || '', comment: nextComment, reviewedBy: nextReviewedBy || '' });
        }
      }, { store: true, dashboard: true });
      if (newCompleted) alertsMod.reviewLocks.delete(json.id);
      sendJSON(res, 200, { ok: true, version: storeMod.storeVersion, dashboardVersion: storeMod.dashboardVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  // ── /api/logs ──────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/logs') {
    const result = recordsMod.getActivityLogsPage({
      page: parsedUrl.searchParams.get('page'), pageSize: parsedUrl.searchParams.get('pageSize'),
      search: parsedUrl.searchParams.get('search'), action: parsedUrl.searchParams.get('action'),
      recordType: parsedUrl.searchParams.get('recordType'),
    });
    return sendJSON(res, 200, result);
  }

  // ── /api/user-logs ────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/user-logs') {
    const requesterRole = String(parsedUrl.searchParams.get('requesterRole') || '').trim();
    if (requesterRole !== 'admin') return sendJSON(res, 403, { ok: false, error: 'Admin only' });
    const result = recordsMod.getUserLogsPage({
      page: parsedUrl.searchParams.get('page'), pageSize: parsedUrl.searchParams.get('pageSize'),
      search: parsedUrl.searchParams.get('search'), type: parsedUrl.searchParams.get('type'), role: parsedUrl.searchParams.get('role'),
    });
    return sendJSON(res, 200, result);
  }

  // ── /api/export-image/:recordId/:imageIndex ────────────────────
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
      alertsMod.pushRecordEvent(recordId, 'exported', 'receiver', item.reviewedBy || '', { selectedText: item.selectedText || '', selectedSourceText: item.selectedSourceText || '', reviewedBy: item.reviewedBy || '', exportedName: fileName });
    }, { store: true, dashboard: true });
    res.writeHead(200, { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="${fileName}"` });
    res.end(buffer);
    return;
  }

  // ── /api/server-owner ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/server-owner') {
    return sendJSON(res, 200, { ok: true, adminReceiverId: ADMIN_RECEIVER_ID, adminReceiverName: storeMod.adminReceiverName,
      adminInitialized: storeMod.adminInitialized, cleanGeneration: storeMod.cleanGeneration, version: storeVersion });
  }

  // ── Dashboard routes ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/dashboard/meta') {
    const summary = dashboardMod.getDashboardSummary();
    return sendJSON(res, 200, { ok: true, accessMode: getDashboardAccessMode(req),
      imports: store.dashboard.imports.slice().sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt))),
      activeImportId: store.dashboard.activeImportId || '', settings: summary.settings, version: storeMod.dashboardVersion });
  }

  if (req.method === 'GET' && pathname === '/api/dashboard/summary') {
    return sendJSON(res, 200, { ...dashboardMod.getDashboardSummary(), accessMode: getDashboardAccessMode(req) });
  }

  if (req.method === 'GET' && pathname === '/api/dashboard/rows') {
    let filters = {};
    const rawFilters = parsedUrl.searchParams.get('filters');
    if (rawFilters) { try { filters = JSON.parse(rawFilters); } catch {} }
    const result = dashboardMod.getDashboardUnifiedRows({
      page: parsedUrl.searchParams.get('page'), pageSize: parsedUrl.searchParams.get('pageSize'),
      search: parsedUrl.searchParams.get('search'), sortBy: parsedUrl.searchParams.get('sortBy'),
      sortDir: parsedUrl.searchParams.get('sortDir'), status: parsedUrl.searchParams.get('status'),
      recordType: parsedUrl.searchParams.get('recordType'), filters,
    });
    return sendJSON(res, 200, { ...result, accessMode: getDashboardAccessMode(req) });
  }

  if (req.method === 'GET' && pathname.startsWith('/api/dashboard/row/')) {
    const id = pathname.substring('/api/dashboard/row/'.length);
    const row = dashboardMod.getDashboardRowFull(id);
    if (!row) return sendJSON(res, 404, { ok: false, error: 'Dashboard row not found' });
    return sendJSON(res, 200, { ok: true, row, version: storeMod.dashboardVersion, accessMode: getDashboardAccessMode(req) });
  }

  if (req.method === 'GET' && pathname === '/api/dashboard/focus-values') {
    const column = String(parsedUrl.searchParams.get('column') || '').trim();
    const keyword = normalizeFreeText(parsedUrl.searchParams.get('keyword') || '').toLowerCase();
    if (!column) return sendJSON(res, 200, { ok: true, items: [], version: storeMod.dashboardVersion });
    const rows = dashboardMod.getImportedRowsForActiveImport();
    const unique = [...new Set(rows.map(r => String((r.sourceData || {})[column] || '').trim()).filter(Boolean))]
      .filter(v => !keyword || v.toLowerCase().includes(keyword)).sort((a, b) => a.localeCompare(b)).slice(0, 5000);
    return sendJSON(res, 200, { ok: true, items: unique, version: storeMod.dashboardVersion });
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
      const focusRules = dashboardMod.normalizeFocusRules(json.focusRules || [], json);
      syncAction(() => {
        store.dashboard.settings = dashboardMod.normalizeDashboardSettings({ visibleColumns, importMatchColumn, inventoryMatchField, matchMode, focusRules });
      }, { store: true, dashboard: true });
      sendJSON(res, 200, { ok: true, settings: store.dashboard.settings, version: storeMod.dashboardVersion });
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
        syncAction(() => { importRow.dashboardComment = dashboardComment; importRow.updatedAt = nowIso(); }, { store: true, dashboard: true });
        return sendJSON(res, 200, { ok: true, version: storeMod.dashboardVersion });
      }
      const inventoryRow = store.dashboard.inventoryRows.find(x => x.id === rowId);
      if (!inventoryRow) return sendJSON(res, 404, { ok: false, error: 'Dashboard row not found' });
      syncAction(() => { inventoryRow.dashboardComment = dashboardComment; inventoryRow.updatedAt = nowIso(); }, { store: true, dashboard: true });
      sendJSON(res, 200, { ok: true, version: storeMod.dashboardVersion });
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
      const { recordToImport } = dashboardMod.computeOneToOneDashboardMatches();
      const hasMatchedImport = recordToImport.has(record.id);
      if (hasMatchedImport) return sendJSON(res, 400, { ok: false, error: 'This inventory record already has import match' });
      const selectedText = normalizeFreeText(json.selectedText || '');
      const comment = normalizeFreeText(json.comment || '');
      if (!hasMeaningfulText(selectedText)) return sendJSON(res, 400, { ok: false, error: 'selectedText is required' });
      if (!hasMeaningfulText(comment)) return sendJSON(res, 400, { ok: false, error: 'comment is required' });
      syncAction(() => {
        record.recordType = record.recordType;
        record.senderName = record.senderName || record.senderName;
        record.selectedText = selectedText;
        record.selectedSourceText = selectedText;
        record.comment = comment;
        record.reviewedBy = record.reviewedBy || record.reviewedBy;
        record.timestamp = record.timestamp || nowIso();
        record.isAddNew = true;
        record.completed = true;
        record.addedBy = normalizeUserName(requesterName || '');
        inventoryRow.updatedAt = nowIso();
        alertsMod.pushRecordEvent(record.id, 'edited', 'admin', requesterName || 'ADMIN', { selectedText, selectedSourceText: selectedText, comment, reviewedBy: record.reviewedBy || '' });
      }, { store: true, dashboard: true });
      sendJSON(res, 200, { ok: true, version: storeMod.dashboardVersion });
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
        const parsed = await dashboardMod.parseDashboardImportPayload(filePart.fileName, filePart.data);
        const importId = `imp_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
        const importedAt = nowIso();
        syncAction(() => {
          store.dashboard.imports = [{ id: importId, fileName: filePart.fileName, importedAt, columns: parsed.columns, rowCount: parsed.rows.length }];
          store.dashboard.importedRows = parsed.rows.map((row, index) => ({ id: `dimp_${Date.now()}_${Math.floor(Math.random() * 100000)}_${index + 1}`, importId, sourceIndex: index + 1, sourceData: row, dashboardComment: '', createdAt: importedAt, updatedAt: importedAt }));
          store.dashboard.activeImportId = importId;
          store.dashboard.settings.visibleColumns = parsed.columns.slice(0, 10);
          store.dashboard.settings.importMatchColumn = parsed.columns.length ? parsed.columns[0] : '';
          store.dashboard.settings.focusRules = [{ column: '', values: [] }];
        }, { store: true, dashboard: true });
        sendJSON(res, 200, { ok: true, importId, columns: parsed.columns, rowCount: parsed.rows.length, version: storeMod.dashboardVersion });
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
      const parsed = await dashboardMod.parseDashboardImportPayload(fileName, Buffer.from(base64Data, 'base64'));
      const importId = `imp_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const importedAt = nowIso();
      syncAction(() => {
        store.dashboard.imports = [{ id: importId, fileName, importedAt, columns: parsed.columns, rowCount: parsed.rows.length }];
        store.dashboard.importedRows = parsed.rows.map((row, index) => ({ id: `dimp_${Date.now()}_${Math.floor(Math.random() * 100000)}_${index + 1}`, importId, sourceIndex: index + 1, sourceData: row, dashboardComment: '', createdAt: importedAt, updatedAt: importedAt }));
        store.dashboard.activeImportId = importId;
        store.dashboard.settings.visibleColumns = parsed.columns.slice(0, 10);
        store.dashboard.settings.importMatchColumn = parsed.columns.length ? parsed.columns[0] : '';
        store.dashboard.settings.focusRules = [{ column: '', values: [] }];
      }, { store: true, dashboard: true });
      sendJSON(res, 200, { ok: true, importId, columns: parsed.columns, rowCount: parsed.rows.length, version: storeMod.dashboardVersion });
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
      sendJSON(res, 200, { ok: true, version: storeMod.dashboardVersion });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/dashboard/export') {
    const mode = String(parsedUrl.searchParams.get('mode') || 'visible').trim().toLowerCase();
    dashboardMod.buildDashboardExportWorkbook(mode === 'full' ? 'full' : 'visible')
      .then(result => {
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${result.fileName}"`,
          'Content-Length': result.buffer.length,
          'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache', Expires: '0'
        });
        res.end(result.buffer);
      }).catch(e => sendJSON(res, 500, { ok: false, error: e.message }));
    return;
  }

  // ── Static pages ──────────────────────────────────────────────
  if (req.method === 'GET' && (pathname === '/' || pathname === '/sender' || pathname === '/receiver' || pathname === '/dashboard')) {
    return serveFile(res, path.join(__dirname, '..', 'index.html'), 'text/html; charset=utf-8');
  }

  // ── /api/records/:id/revert ─────────────────────────────────
  if (req.method === 'POST' && pathname.startsWith('/api/records/') && pathname.endsWith('/revert')) {
    const id = pathname.substring('/api/records/'.length, pathname.length - '/revert'.length - 1);
    const item = store.records.find(r => r.id === id);
    if (!item) return sendJSON(res, 404, { ok: false, error: 'Record not found' });
    if (!item.completed) return sendJSON(res, 400, { ok: false, error: 'Record is not completed' });
    const actorName = normalizeUserName(parsedUrl.searchParams.get('actorName') || 'admin');
    const result = storeMod.revertRecord(id);
    if (!result.ok) return sendJSON(res, 400, { ok: false, error: result.error });
    alertsMod.pushRecordEvent(id, 'reverted', 'admin', actorName, {});
    syncAction(() => {}, { store: true, dashboard: true });
    broadcastEvent('record_updated', { recordId: id });
    return sendJSON(res, 200, { ok: true, version: storeVersion, dashboardVersion: dashboardVersion });
  }

  // ── /api/users/:id/pause ─────────────────────────────────────
  if (req.method === 'POST' && pathname.startsWith('/api/users/') && pathname.endsWith('/pause')) {
    const userId = pathname.substring('/api/users/'.length, pathname.length - '/pause'.length - 1);
    sessionsMod.pauseUser(userId);
    broadcastEvent('user_paused', { userId });
    return sendJSON(res, 200, { ok: true, version: storeVersion });
  }

  // ── /api/users/:id/resume ─────────────────────────────────────
  if (req.method === 'POST' && pathname.startsWith('/api/users/') && pathname.endsWith('/resume')) {
    const userId = pathname.substring('/api/users/'.length, pathname.length - '/resume'.length - 1);
    sessionsMod.resumeUser(userId);
    broadcastEvent('user_resumed', { userId });
    return sendJSON(res, 200, { ok: true, version: storeVersion });
  }

  // ── /api/events (SSE) ─────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    const clientId = Date.now().toString();
    const client = { id: clientId, res };
    if (!global.__sseClients) global.__sseClients = [];
    global.__sseClients.push(client);

    res.write('event: connected\ndata: ' + JSON.stringify({ type: 'connected', clientId }) + '\n\n');

    req.on('close', () => {
      if (global.__sseClients) {
        global.__sseClients = global.__sseClients.filter(c => c.id !== clientId);
      }
    });
    return;
  }

  // ── /api/events/broadcast ────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/events/broadcast') {
    requestBody(req).then(body => {
      const json = JSON.parse(body || '{}');
      const eventType = String(json.type || '').trim();
      const eventData = json.data || {};
      if (!eventType) return sendJSON(res, 400, { ok: false, error: 'event type required' });
      broadcastEvent(eventType, eventData);
      sendJSON(res, 200, { ok: true });
    }).catch(e => sendJSON(res, 400, { ok: false, error: e.message }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

module.exports = { requestHandler };
