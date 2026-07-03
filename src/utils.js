const os = require('os');

function nowIso() {
  return new Date().toISOString();
}

function ensureDirSync(dir) {
  const fs = require('fs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function fileTimestamp(date = new Date()) {
  const pad = (n, size = 2) => String(n).padStart(size, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
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

module.exports = {
  nowIso,
  ensureDirSync,
  fileTimestamp,
  sanitizeFileName,
  formatDateForFile,
  formatCsvDateTime,
  getAllLocalIPs,
  getClientIP,
  getRequestHostName,
  isLocalDashboardHost,
  getDashboardAccessMode,
  isRawEnglishOnlyName,
  normalizeUserName,
  normalizeFreeText,
  hasMeaningfulText,
  normalizeRecordStatus,
  normalizeRecordTypeFilter,
  normalizePage,
  normalizePageSize,
  buildPaginationMeta,
  paginateArray,
  stringifyCellValue
};
