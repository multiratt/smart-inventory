const { getStore, getDashboardVersion, normalizeFocusRules, normalizeDashboardSettings, createEmptyDashboardState, normalizeCompareValue } = require('./store');
const { normalizeFreeText, normalizeRecordTypeFilter, normalizePage, normalizePageSize, paginateArray } = require('./utils');

let _dashboardVersion = 1;
let _storeVersion = 1;

function setVersions(storeVer, dashboardVer) {
  _storeVersion = storeVer;
  _dashboardVersion = dashboardVer;
}

function rebuildDashboardInventoryRows() {
  const store = getStore();
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

function nowIso() {
  return new Date().toISOString();
}

function getDashboardActiveImport() {
  const store = getStore();
  if (!store.dashboard.activeImportId) return null;
  return store.dashboard.imports.find(x => x.id === store.dashboard.activeImportId) || null;
}

function getImportedRowsForActiveImport() {
  const activeImport = getDashboardActiveImport();
  if (!activeImport) return [];
  const store = getStore();
  return store.dashboard.importedRows.filter(x => x.importId === activeImport.id).sort((a, b) => a.sourceIndex - b.sourceIndex);
}

function rowPassesFocus(row) {
  const store = getStore();
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

function normalizeFocusValues(values, fallbackSingle = '') {
  let list = [];
  if (Array.isArray(values)) list = values;
  else if (typeof values === 'string' && values.trim()) list = values.split(/\r?\n|,/g);
  else if (fallbackSingle) list = [fallbackSingle];
  return [...new Set(list.map(x => normalizeCompareValue(x)).filter(Boolean))].slice(0, 5000);
}

function exactMatchSingle(left, right) {
  if (!left || !right) return false;
  return left === right;
}

function partialMatchSingle(left, right) {
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
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
  const store = getStore();
  return store.records.filter(r => !r.deleted && !!r.completed);
}

function matchImportRowToRecord(importRow, record) {
  const store = getStore();
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
  const store = getStore();
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
  const store = getStore();
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

  const store = getStore();
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
    version: _dashboardVersion
  };
}

function valueMatchesMultiFilter(value, filterValues) {
  if (!Array.isArray(filterValues) || !filterValues.length) return true;
  const current = String(value || '').toLowerCase();
  return filterValues.some(v => current === String(v || '').toLowerCase());
}

function buildDashboardUnifiedRowsRaw(query = {}) {
  const store = getStore();
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
    version: _dashboardVersion
  };
}

function getDashboardUnifiedRowsAll(query = {}) {
  return buildDashboardUnifiedRowsRaw(query);
}

function getDashboardRowFull(rowId) {
  const store = getStore();
  rebuildDashboardInventoryRows();

  const importRow = store.dashboard.importedRows.find(x => x.id === rowId);
  if (importRow) {
    const { importToRecord } = computeOneToOneDashboardMatches();
    const recordId = importToRecord.get(importRow.id) || '';
    const match = recordId ? store.records.find(r => r.id === recordId && !r.deleted && r.completed) : null;
    const activeImport = store.dashboard.imports.find(x => x.id === importRow.importId) || null;
    const { getRecordById } = require('./records');
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
    const { getRecordById } = require('./records');

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

function getDashboardFocusValues(column, keyword) {
  const rows = getImportedRowsForActiveImport();
  const unique = [...new Set(
    rows.map(r => String((r.sourceData || {})[column] || '').trim()).filter(Boolean)
  )]
    .filter(v => !keyword || v.toLowerCase().includes(keyword))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 5000);

  return unique;
}

module.exports = {
  setVersions,
  rebuildDashboardInventoryRows,
  getDashboardActiveImport,
  getImportedRowsForActiveImport,
  rowPassesFocus,
  exactMatchSingle,
  partialMatchSingle,
  matchImportRowToRecord,
  getDashboardMatchedTextForRecord,
  computeOneToOneDashboardMatches,
  isRecordFoundInDashboard,
  getDashboardImportRowsWithMatches,
  getDashboardSummary,
  getInventoryMatchableFields,
  getInventoryFieldValue,
  getDashboardEligibleRecords,
  buildDashboardUnifiedRowsRaw,
  getDashboardUnifiedRows,
  getDashboardUnifiedRowsAll,
  getDashboardRowFull,
  getDashboardFocusValues,
  valueMatchesMultiFilter,
  normalizeFocusValues
};
