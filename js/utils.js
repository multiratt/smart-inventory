// Utility functions
import { getState } from './state.js';

// Escape HTML
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Escape RegExp
export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Normalize strict username (uppercase, trimmed)
export function normalizeStrictUserName(raw) {
  return String(raw || '').trim().toUpperCase();
}

// Check if username has strict format
export function hasStrictUserName(raw) {
  return /^[A-Za-z]+$/.test(String(raw || '').trim());
}

// Normalize free text
export function normalizeFreeText(raw) {
  return String(raw || '').replace(/\r\n/g, '\n').replace(/\u00A0/g, ' ').trim();
}

// Check if text is meaningful
export function hasMeaningfulText(raw) {
  return normalizeFreeText(raw).length > 0;
}

// Normalize search text
export function normalizeSearchText(raw) {
  return String(raw || '').trim().toLowerCase();
}

// Highlight text with keyword
export function highlightText(text, keyword) {
  const safeText = escapeHtml(text);
  const kw = String(keyword || '').trim();
  if (!kw) return safeText;
  const re = new RegExp(`(${escapeRegExp(kw)})`, 'ig');
  return safeText.replace(re, '<mark class="result-highlight">$1</mark>');
}

// Format datetime
export function formatDateTime(iso) {
  try { return new Date(iso).toLocaleString('en-GB'); } catch { return iso || '-'; }
}

// Format datetime for input
export function formatDateTimeInputLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Format timestamp for filename
export function formatTimestampFileName(index) {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_${index}.jpg`;
}

// Format date (short)
export function formatDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-GB'); } catch { return iso || '-'; }
}

// Time ago string
export function timeAgo(iso) {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Role emoji HTML
export function roleEmojiHtml(role) {
  if (role === 'admin') return `<span class="role-emoji" title="Admin">👑</span>`;
  if (role === 'receiver') return `<span class="role-emoji" title="Receiver">📥</span>`;
  if (role === 'all') return `<span class="role-emoji" title="Everyone">🌐</span>`;
  return `<span class="role-emoji" title="Sender">📤</span>`;
}

// Role label
export function roleLabel(role) {
  if (role === 'admin') return 'admin';
  if (role === 'receiver') return 'receiver';
  if (role === 'all') return 'everyone';
  return 'sender';
}

// Get role icon
export function getRoleIcon(role) {
  if (role === 'admin') return '👑';
  if (role === 'receiver') return '📥';
  if (role === 'all') return '🌐';
  return '📤';
}

// Theme icon
export function themeIcon() {
  return document.body.classList.contains('dark') ? '☀️' : '🌙';
}

// Apply theme
export function applyTheme(mode) {
  document.body.classList.toggle('dark', mode === 'dark');
}

// Refresh theme buttons
export function refreshThemeButtons() {
  document.querySelectorAll('[data-theme-btn]').forEach(btn => btn.textContent = themeIcon());
}

// Render theme button HTML
export function renderThemeButton() {
  return `<button data-theme-btn class="icon-btn" title="Toggle theme">${themeIcon()}</button>`;
}

// Bind theme buttons
export function bindThemeButtons() {
  document.querySelectorAll('[data-theme-btn]').forEach(btn => {
    btn.onclick = () => {
      const next = document.body.classList.contains('dark') ? 'light' : 'dark';
      localStorage.setItem('theme_mode_v1', next);
      applyTheme(next);
      refreshThemeButtons();
    };
  });
}

// Refresh modal open state
export function refreshModalOpenState() {
  const anyOpen = !!document.querySelector('.modal.show, .image-preview-modal.show');
  document.body.classList.toggle('modal-open', anyOpen);
}

// Lock background scroll
export function lockBackgroundScroll() {
  document.body.classList.add('modal-open');
}

// Unlock background scroll if needed
export function unlockBackgroundScrollIfNeeded() {
  refreshModalOpenState();
}

// Check if active typing field exists
export function hasActiveTypingField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = String(el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

// Debounce function
export function debounce(fn, delay = 400) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Throttle function
export function throttle(fn, delay = 400) {
  let lastCall = 0;
  return (...args) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn(...args);
    }
  };
}

// Download blob as file
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// Fetch JSON with error handling
export async function fetchJson(url, options) {
  const res = await fetch(url, options);
  let json = null;
  try { json = await res.json(); } catch { throw new Error(`HTTP ${res.status}`); }
  if (!json || !json.ok) throw new Error((json && json.error) || 'Request failed');
  return json;
}

// Show toast notification
export function showToast(message, type = 'warn', title = '') {
  const state = getState();
  if (!state.webPopupHost) return;
  const item = document.createElement('div');
  item.className = `web-popup-item ${type}`;
  item.innerHTML = `
    ${title ? `<div class="web-popup-title">${escapeHtml(title)}</div>` : ''}
    <div class="web-popup-text">${escapeHtml(message)}</div>
  `;
  state.webPopupHost.appendChild(item);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transform = 'translateY(8px)';
    item.style.transition = '.18s ease';
    setTimeout(() => item.remove(), 180);
  }, 2800);
}

// Show error toast
export function showError(message, title = '') {
  showToast(message, 'danger', title);
}

// Show confirm dialog (returns boolean via callback - simplified)
export function showConfirm(message, onConfirm, onCancel) {
  // This is a simplified version - actual implementation uses confirm() or a modal
  if (confirm(message)) {
    if (onConfirm) onConfirm();
  } else {
    if (onCancel) onCancel();
  }
}

// Truncate text
export function truncateText(text, maxLength = 50) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// Render type badge
export function renderTypeBadge(type) {
  const t = String(type || 'photo').toLowerCase() === 'scanner' ? 'scanner' : 'photo';
  return `<span class="pill ${t}">${t === 'scanner' ? 'Scanner' : 'Photo'}</span>`;
}

// Render reviewed badge
export function renderReviewedBadge(item) {
  if (!item.completed) return '';
  return `<span class="pill complete">Reviewed by ${escapeHtml(item.reviewedBy || '-')}</span>`;
}

// Render add new badge
export function renderAddNewBadge(flag) {
  return flag ? `<span class="pill add-new">New</span>` : '';
}

// Render found badge
export function renderFoundBadge(item) {
  return item && item.foundInDashboard ? `<span class="pill found">Found</span>` : '';
}

// Render badge (generic)
export function renderBadge(text, className) {
  return `<span class="pill ${className}">${escapeHtml(text)}</span>`;
}

// Render timeline
export function renderTimeline(items) {
  return items.map(item => `
    <div class="timeline-item">
      <div class="timeline-marker"></div>
      <div class="timeline-content">${item.content || ''}</div>
    </div>
  `).join('');
}

// Render image viewer
export function renderImageViewer(images) {
  return images.map((img, idx) => `
    <div class="image-viewer-item" data-index="${idx}">
      <img src="${img.url || img}" alt="${img.name || 'Image ' + (idx + 1)}">
    </div>
  `).join('');
}

// Open image viewer
export function openImageViewer(images, startIndex = 0) {
  // This would open a modal with the image viewer
  // Implementation depends on specific modal structure
  console.log('Open image viewer:', images, startIndex);
}

// Download file
export function downloadFile(url, fileName) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Open in new tab
export function openInNewTab(url) {
  window.open(url, '_blank');
}

// Parse image name
export function parseImageName(imageName) {
  if (!imageName) return { name: 'Unknown', ext: '' };
  const parts = imageName.split('.');
  const ext = parts.length > 1 ? parts.pop() : '';
  return { name: parts.join('.'), ext };
}

// Build page from data (generic pagination)
export function buildPageFromData(items, page, pageSize) {
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  return items.slice(start, end);
}

// Build pagination
export function buildPagination(currentPage, totalPages, onPageChange) {
  return `
    <div class="pagination-bar">
      <button ${currentPage <= 1 ? 'disabled' : ''} data-page="${currentPage - 1}">Prev</button>
      <span>Page ${currentPage}/${totalPages}</span>
      <button ${currentPage >= totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">Next</button>
    </div>
  `;
}

// Get status filter options
export function getStatusFilter() {
  return [
    { value: '', label: 'All Status' },
    { value: 'found', label: 'Found' },
    { value: 'pending', label: 'Pending' },
    { value: 'new', label: 'New' }
  ];
}

// Get type filter options
export function getTypeFilter() {
  return [
    { value: 'all', label: 'All Types' },
    { value: 'photo', label: 'Photo' },
    { value: 'scanner', label: 'Scanner' }
  ];
}

// Render pagination bar HTML
export function renderPaginationBar(prefix, state) {
  const totalPages = Math.max(1, Number(state.totalPages || 1));
  const page = Math.min(Number(state.page || 1), totalPages);
  return `
    <div class="pagination-bar">
      <div class="pagination-left">
        <button id="${prefix}PrevBtn" ${page <= 1 ? 'disabled' : ''}>Prev</button>
      </div>
      <div class="pagination-center">
        <div class="pagination-meta">Page ${page}/${totalPages}</div>
      </div>
      <div class="pagination-right">
        <button id="${prefix}NextBtn" ${page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
      <div>
        <select id="${prefix}PageSize" class="small-select">
          ${[10, 20, 50, 100].map(size => `<option value="${size}" ${Number(state.pageSize) === size ? 'selected' : ''}>${size}/page</option>`).join('')}
        </select>
      </div>
    </div>
  `;
}

// Bind pagination bar events
export function bindPaginationBar(prefix, state, onChange) {
  const prevBtn = document.getElementById(`${prefix}PrevBtn`);
  const nextBtn = document.getElementById(`${prefix}NextBtn`);
  const pageSizeSel = document.getElementById(`${prefix}PageSize`);
  if (prevBtn) prevBtn.onclick = () => { if (state.page > 1) { state.page -= 1; onChange(); } };
  if (nextBtn) nextBtn.onclick = () => { if (state.page < state.totalPages) { state.page += 1; onChange(); } };
  if (pageSizeSel) pageSizeSel.onchange = () => {
    state.pageSize = Number(pageSizeSel.value);
    state.page = 1;
    onChange();
  };
}
