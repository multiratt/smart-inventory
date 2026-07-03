// API functions
import { getFingerprint, ADMIN_RECEIVER_ID } from './config.js';
import { getState } from './state.js';
import { fetchJson as utilsFetchJson, downloadBlob } from './utils.js';

// Re-export utils fetchJson for use by other modules
export { fetchJson } from './utils.js';

export async function apiGet(url, options) {
  return fetchJson(url, options);
}

export async function apiPost(url, body, options = {}) {
  return fetchJson(url, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export async function uploadImages(images) {
  // Images are embedded in the record upload, not separate
  return images;
}

export async function uploadRecord(payload) {
  return fetchJson('/api/upload-record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function checkName(name) {
  return fetchJson('/api/check-sender-name?name=' + encodeURIComponent(name));
}

export async function getServerOwner() {
  try {
    const res = await fetch('/api/server-owner');
    return await res.json();
  } catch {
    return { ok: false };
  }
}

export async function getInterfaces() {
  return fetchJson('/api/interfaces');
}

export async function checkDashboardAccess() {
  try {
    return await fetchJson('/api/dashboard-access');
  } catch {
    return { allowDashboard: true, accessMode: 'readonly' };
  }
}

export async function getActiveSenders() {
  return fetchJson('/api/active-senders');
}

export async function getReceiverAlert(receiverId, receiverName) {
  return fetchJson('/api/receiver-alert?receiverId=' + encodeURIComponent(receiverId) + '&receiverName=' + encodeURIComponent(receiverName));
}

export async function getSenderAlert(senderName, deviceId) {
  return fetchJson('/api/sender-alert?senderName=' + encodeURIComponent(senderName) + '&deviceId=' + encodeURIComponent(deviceId));
}

export async function ackReceiverAlert(receiverId, alertId) {
  return fetchJson('/api/receiver-alert-ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiverId, alertId })
  });
}

export async function ackSenderAlert(senderName, alertId) {
  return fetchJson('/api/sender-alert-ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderName, alertId })
  });
}

export async function claimReviewLock(recordId, receiverId, receiverName) {
  return fetchJson('/api/review-lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordId, receiverId, receiverName })
  });
}

export async function releaseReviewLock(recordId, receiverId) {
  return fetchJson('/api/review-lock', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordId, receiverId })
  });
}

export async function getRecords(params) {
  return fetchJson('/api/records?' + new URLSearchParams(params).toString());
}

export async function getRecord(recordId, requesterName) {
  return fetchJson('/api/record/' + encodeURIComponent(recordId) + '?requesterName=' + encodeURIComponent(requesterName));
}

export async function selectOcr(recordId, imageIndex, selectedText) {
  return fetchJson('/api/select-ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recordId, imageIndex, selectedText })
  });
}

export async function updateSelectedText(payload) {
  return fetchJson('/api/update-selected-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function deleteRecord(recordId, actorName, requesterRole) {
  return fetchJson('/api/delete-record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: recordId, actorName, requesterRole })
  });
}

export async function getActivityLogs(params) {
  return fetchJson('/api/logs?' + new URLSearchParams(params).toString());
}

export async function getUserLogs(params) {
  return fetchJson('/api/user-logs?' + new URLSearchParams(params).toString());
}

export async function getPingStatus() {
  return fetchJson('/api/ping-status');
}

export async function getSyncStatus() {
  return fetchJson('/api/sync-status');
}

export async function deleteUser(requesterRole, adminName, targetRole, targetId, targetName) {
  return fetchJson('/api/delete-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requesterRole, adminName, targetRole, targetId, targetName })
  });
}

export async function teamMessage(fromRole, fromId, fromName, targetRole, targetId, targetName, message) {
  return fetchJson('/api/team-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromRole, fromId, fromName, targetRole, targetId, targetName, message })
  });
}

export async function setReceiverName(receiverId, deviceId, receiverName, isAdmin, mode, fingerprint) {
  return fetchJson('/api/set-receiver-name', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiverId, deviceId, receiverName, isAdmin, mode, fingerprint })
  });
}

export async function receiverHeartbeat(receiverId, deviceId, receiverName, isAdmin, mode, cleanGeneration, fingerprint) {
  const res = await fetch('/api/receiver-heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ receiverId, deviceId, receiverName, isAdmin, mode, cleanGeneration, fingerprint })
  });
  return res.json();
}

export async function senderHeartbeat(senderName, deviceId, cleanGeneration, fingerprint) {
  const res = await fetch('/api/sender-heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senderName, deviceId, cleanGeneration, fingerprint })
  });
  return res.json();
}

export async function checkSenderName(name, deviceId) {
  return fetchJson('/api/check-sender-name?name=' + encodeURIComponent(name) + '&deviceId=' + encodeURIComponent(deviceId));
}

export async function checkReceiverName(name, receiverId, deviceId, mode) {
  return fetchJson('/api/check-receiver-name?name=' + encodeURIComponent(name) + '&receiverId=' + encodeURIComponent(receiverId) + '&deviceId=' + encodeURIComponent(deviceId) + '&mode=' + encodeURIComponent(mode));
}

export async function getDeviceIdentity(deviceId, receiverId, mode) {
  return fetchJson('/api/device-identity?deviceId=' + encodeURIComponent(deviceId) + '&receiverId=' + encodeURIComponent(receiverId) + '&mode=' + encodeURIComponent(mode));
}

export async function setRememberedIdentity(deviceId, receiverId, mode, rememberedName) {
  return fetchJson('/api/device-identity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, receiverId, mode, rememberedName })
  });
}

export async function getRenameRequestStatus(requesterRole, requesterId) {
  return fetchJson('/api/rename-request-status?requesterRole=' + encodeURIComponent(requesterRole) + '&requesterId=' + encodeURIComponent(requesterId));
}

export async function pollRenameDecision(requesterRole, requesterId) {
  return fetchJson('/api/rename-decision?requesterRole=' + encodeURIComponent(requesterRole) + '&requesterId=' + encodeURIComponent(requesterId));
}

export async function renameRequest(requesterRole, requesterId, currentName, requestedName) {
  return fetchJson('/api/rename-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requesterRole, requesterId, currentName, requestedName })
  });
}

export async function acknowledgeRenameDecision(requesterRole, requesterId) {
  return fetchJson('/api/rename-decision-ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requesterRole, requesterId })
  });
}

export async function getAdminRenameRequests(requesterRole, requesterId) {
  return fetchJson('/api/admin-rename-requests?requesterRole=' + encodeURIComponent(requesterRole) + '&requesterId=' + encodeURIComponent(requesterId));
}

export async function adminRenameDecision(requesterRole, requesterId, adminName, requestId, decision) {
  return fetchJson('/api/admin-rename-decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requesterRole, requesterId, adminName, requestId, decision })
  });
}

export async function uploadRecordWithFiles(images) {
  return fetchJson('/api/upload-record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(images)
  });
}

export async function getDashboardMeta() {
  return fetchJson('/api/dashboard/meta');
}

export async function getDashboardSummary() {
  return fetchJson('/api/dashboard/summary');
}

export async function getDashboardRows(params) {
  return fetchJson('/api/dashboard/rows?' + new URLSearchParams(params).toString());
}

export async function getDashboardRow(rowId) {
  return fetchJson('/api/dashboard/row/' + encodeURIComponent(rowId));
}

export async function getFocusValues(column, keyword) {
  return fetchJson('/api/dashboard/focus-values?column=' + encodeURIComponent(column) + '&keyword=' + encodeURIComponent(keyword));
}

export async function updateDashboardSettings(payload) {
  return fetchJson('/api/dashboard/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function updateDashboardComment(rowId, dashboardComment) {
  return fetchJson('/api/dashboard/comment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowId, dashboardComment })
  });
}

export async function addFoundRecord(payload) {
  return fetchJson('/api/dashboard/add-found', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function clearImports() {
  return fetchJson('/api/dashboard/clear-imports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requesterRole: 'admin' })
  });
}

export async function importDashboardFile(file) {
  const form = new FormData();
  form.append('requesterRole', 'admin');
  form.append('file', file);
  return fetchJson('/api/dashboard/import', { method: 'POST', body: form });
}

export async function exportDashboard(mode) {
  const res = await fetch('/api/dashboard/export?mode=' + encodeURIComponent(mode));
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="([^"]+)"/i.exec(disposition);
  downloadBlob(blob, match ? match[1] : 'dashboard_export.xlsx');
  return true;
}

export async function cleanDatabase() {
  return fetchJson('/api/clean-database', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requesterRole: 'admin' })
  });
}

export async function exportCompleteZip() {
  window.location.href = '/api/export-complete-zip?requesterRole=admin';
}
