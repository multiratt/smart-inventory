const path = require('path');
const { exec } = require('child_process');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const { stringifyCellValue, formatDateForFile, formatCsvDateTime, nowIso, ensureDirSync, sanitizeFileName } = require('./utils');
const { getStore, getStoreVersion, getDashboardVersion } = require('./store');
const { getActivityLogsPage, getUserLogsPage } = require('./records');
const { isRecordFoundInDashboard } = require('./dashboard');

function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  if (platform === 'win32') cmd = `start "" "${url}"`;
  else if (platform === 'darwin') cmd = `open "${url}"`;
  else cmd = `xdg-open "${url}"`;
  exec(cmd, () => {});
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
  const store = getStore();
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

async function buildDashboardExportWorkbook(mode = 'visible') {
  const { getDashboardActiveImport, getDashboardSummary, getDashboardUnifiedRowsAll, getInventoryMatchableFields } = require('./dashboard');
  const { formatCsvDateTime } = require('./utils');

  const activeImport = getDashboardActiveImport();
  const store = getStore();
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

module.exports = {
  parseCsvText,
  parseWorksheetToObjects,
  parseWorkbookWithExcelJS,
  parseWorkbookWithXLSX,
  parseDashboardImportPayload,
  buildWorkbookBuffer,
  buildExportWorkbookForRole,
  buildDashboardExportWorkbook,
  openBrowser
};
