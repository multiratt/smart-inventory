const path = require('path');
const fsp = require('fs').promises;
const { getStore, getStoreVersion } = require('./store');
const { IMAGE_DIR } = require('./constants');
const { normalizeFreeText, normalizeUserName, normalizeRecordStatus, normalizeRecordTypeFilter, normalizePage, normalizePageSize, paginateArray, buildPaginationMeta } = require('./utils');
const { isRecordFoundInDashboard, getReviewLock } = require('./dashboard');

function getRecordById(recordId, includeImages = true) {
  const store = getStore();
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
  const store = getStore();
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
  const store = getStore();
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
    version: getStoreVersion()
  };
}

function getActivityLogsPage(query = {}) {
  const store = getStore();
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
  return { ok: true, items: result.rows, page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages, version: getStoreVersion() };
}

function getUserLogsPage(query = {}) {
  const store = getStore();
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
  return { ok: true, items: result.rows, page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages, version: getStoreVersion() };
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

module.exports = {
  getRecordById,
  getFilteredRecords,
  getRecordsPage,
  buildRecordSummaryItems,
  recordMatchesSearch,
  canDeleteRecord,
  isOwnRecordReviewerBlocked,
  getActivityLogsPage,
  getUserLogsPage,
  saveBase64ImageToFile
};
