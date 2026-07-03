// Reusable DOM component builders
import {
  escapeHtml,
  highlightText,
  formatDateTime,
  renderTypeBadge,
  renderReviewedBadge,
  renderAddNewBadge,
  renderFoundBadge,
  roleEmojiHtml
} from './utils.js';

// Build header
export function buildHeader(options = {}) {
  const { title = 'Smart Inventory', showSyncDot = true, syncDotTitle = 'Last sync: -', showBackBtn = false, backBtnAction = '', showProfileBtn = true, showSettingsBtn = false, showReadonlyBadge = false, extraActions = '' } = options;
  return `
    <header>
      <div class="header-inner">
        <div class="header-left">
          <div class="brand">
            Smart Inventory
            ${showSyncDot ? `<span class="brand-status-dot" title="${syncDotTitle}"></span>` : ''}
          </div>
        </div>
        <div class="header-center">
          ${showReadonlyBadge ? '<div class="header-readonly-badge hidden">READ ONLY</div>' : ''}
        </div>
        <div class="header-right">
          ${showBackBtn ? `<button id="goBackBtn" class="icon-btn" title="Back">📥</button>` : ''}
          ${showProfileBtn ? `<button id="userMenuBtn" class="user-menu-btn" title="Profile">👤</button>` : ''}
          ${extraActions}
          <button data-theme-btn class="icon-btn" title="Toggle theme">☀️</button>
        </div>
      </div>
    </header>
  `;
}

// Build navbar (for future use)
export function buildNavbar() {
  return '';
}

// Build status badge
export function buildStatusBadge(status, isAddNew) {
  if (isAddNew || status === 'new') return `<span class="dash-status-badge new">NEW</span>`;
  if (status === 'found') return `<span class="dash-status-badge found">FOUND</span>`;
  return `<span class="dash-status-badge pending">PENDING</span>`;
}

// Build origin badge
export function buildOriginBadge(origin) {
  if (origin === 'import') return `<span class="dash-origin-badge import">IMPORT</span>`;
  if (origin === 'scanner') return `<span class="dash-origin-badge scanner">SCANNER</span>`;
  return `<span class="dash-origin-badge photo">PHOTO</span>`;
}

// Build record card (receiver)
export function buildRecordCard(item, completed = false) {
  const typeBadge = renderTypeBadge(item.recordType);
  const statusBadge = completed ? renderReviewedBadge(item) : '';
  const lockBadge = !completed && item.reviewLock ? `<div class="pill locked">Locked: ${escapeHtml(item.reviewLock.receiverName || 'Unknown')}</div>` : '';
  const ownBadge = item.ownRecordBlocked ? `<div class="pill deleted">Own Record</div>` : '';
  const addNewBadge = renderAddNewBadge(item.isAddNew);
  const foundBadge = renderFoundBadge(item);

  if (item.recordType === 'scanner') {
    return `
      <div class="receiver-card" data-open-id="${item.id}">
        <div class="scanner-icon-box">📝</div>
        <div>
          <div class="big-selected">${item.selectedText ? escapeHtml(item.selectedText) : 'No selected text'}</div>
          <div class="mini">Sender: ${escapeHtml(item.senderName || 'Unknown')}</div>
          <div class="mini">Time: ${escapeHtml(formatDateTime(item.timestamp))}</div>
          ${item.comment ? `<div class="receiver-comment">Comment: ${escapeHtml(item.comment)}</div>` : ''}
          ${item.selectedSourceText && item.selectedText && item.selectedSourceText !== item.selectedText ? `<div class="mini">Override: ${escapeHtml(item.selectedSourceText)} → ${escapeHtml(item.selectedText)}</div>` : ''}
          <div class="row badge-row">${typeBadge}${addNewBadge}${foundBadge}${statusBadge}${lockBadge}${ownBadge}</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="receiver-card" data-open-id="${item.id}">
      <div class="receiver-images">
        ${(item.images || []).slice(0, 4).map((img, idx) => `<div class="receiver-image-box" data-preview-record="${item.id}" data-preview-image="${idx}"><img loading="lazy" src="${img.url}" alt=""></div>`).join('')}
      </div>
      <div>
        <div class="big-selected">${item.selectedText ? escapeHtml(item.selectedText) : 'No selected text'}</div>
        <div class="mini">Sender: ${escapeHtml(item.senderName || 'Unknown')}</div>
        <div class="mini">Time: ${escapeHtml(formatDateTime(item.timestamp))}</div>
        ${item.comment ? `<div class="receiver-comment">Comment: ${escapeHtml(item.comment)}</div>` : ''}
        ${item.selectedSourceText && item.selectedText && item.selectedSourceText !== item.selectedText ? `<div class="mini">Override: ${escapeHtml(item.selectedSourceText)} → ${escapeHtml(item.selectedText)}</div>` : ''}
        <div class="row badge-row">${typeBadge}${addNewBadge}${foundBadge}${statusBadge}${lockBadge}${ownBadge}</div>
      </div>
    </div>
  `;
}

// Build record row (simplified)
export function buildRecordRow(item) {
  return buildRecordCard(item, false);
}

// Build log row (for activity logs)
export function buildLogRow(log) {
  return `
    <tr>
      <td>${escapeHtml(formatDateTime(log.dateTime))}</td>
      <td>${escapeHtml(log.recordId || '-')}</td>
      <td>${escapeHtml(log.type || '-')}</td>
      <td>${escapeHtml((log.actorName || '-') + (log.actorRole ? ' (' + log.actorRole + ')' : ''))}</td>
      <td>${escapeHtml(log.recordType === 'photo' ? 'Photo' : (log.recordType || '-'))}</td>
      <td>${escapeHtml(log.senderName || '-')}</td>
      <td>${escapeHtml(log.selectedText || '-')}</td>
      <td>${log.selectedSourceText && log.selectedText && log.selectedSourceText !== log.selectedText ? escapeHtml(log.selectedSourceText + ' → ' + log.selectedText) : '-'}</td>
      <td>${escapeHtml(log.comment || '-')}</td>
      <td>${escapeHtml(log.reviewedBy || '-')}</td>
      <td>${escapeHtml(log.exportedName || '-')}</td>
    </tr>
  `;
}

// Build user badge
export function buildUserBadge(user) {
  return `
    <button class="team-user-btn" data-user='${encodeURIComponent(JSON.stringify(user))}'>
      <span class="status-dot ${user.online ? 'status-green' : 'status-red'}"></span>
      ${roleEmojiHtml(user.role)}
      <span>${escapeHtml(user.name)}</span>
      ${user.waiting ? '<span class="pill pending wait-small">WAIT</span>' : ''}
    </button>
  `;
}

// Build alert banner
export function buildAlertBanner(alert, onClose) {
  return `
    <div class="alert-banner" data-alert-id="${alert.id}">
      <div class="alert-content">
        <strong>${escapeHtml(alert.fromName || 'System')}</strong>: ${escapeHtml(alert.message)}
      </div>
      <button class="alert-close" data-close-alert="${alert.id}">×</button>
    </div>
  `;
}

// Build name modal
export function buildNameModal(id, title, subtitle, inputPlaceholder, buttonText) {
  return `
    <div id="${id}" class="modal">
      <div class="modal-panel" style="max-width:520px;">
        <div class="section-title" style="margin:0;">${escapeHtml(title)}</div>
        <div class="sub">${escapeHtml(subtitle)}</div>
        <div class="col" style="margin-top:12px;">
          <input type="text" placeholder="${escapeHtml(inputPlaceholder)}" />
          <div class="row">
            <button class="success">${escapeHtml(buttonText)}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Build image picker
export function buildImagePicker(images, selectedIndex, onSelect) {
  return images.map((img, idx) => `
    <div class="pick-card ${idx === selectedIndex ? 'active' : ''}" data-pick-index="${idx}">
      <div class="image-stage">
        <img src="${img.url}" alt="">
        ${idx === selectedIndex ? '<div class="selected-image-check">✓</div>' : ''}
      </div>
      <div class="label">
        <span>${escapeHtml(img.name || 'Image')}</span>
        <span><button type="button" data-large-preview="${idx}">Preview</button></span>
      </div>
    </div>
  `).join('');
}

// Build record detail modal (returns HTML string, actual binding done in page)
export function buildRecordDetailModal() {
  return `
    <div id="detailModal" class="modal">
      <div class="modal-panel">
        <div class="modal-head">
          <div>
            <div class="row" style="align-items:center;">
              <div class="section-title" style="margin:0;">Record Details</div>
              <div id="lockInfo" class="lock-note"></div>
            </div>
            <div id="modalMeta" class="sub"></div>
          </div>
          <div class="row">
            <button id="deleteRecordBtn" class="danger">Delete</button>
            <button id="closeModalBtn" class="danger">Close</button>
          </div>
        </div>
        <div id="photoDetailLayout" class="modal-grid">
          <div>
            <div class="section-title" style="font-size:16px;">Select Image for Scan</div>
            <div id="modalImagePick" class="modal-image-pick"></div>
          </div>
          <div>
            <div class="scan-inline-row">
              <select id="scanModeSelect">
                <option value="all">All</option>
                <option value="ocr">OCR Only</option>
                <option value="code">QR / Barcode Only</option>
              </select>
              <button id="scanBtn" class="warn">Scan</button>
            </div>
            <div class="ocr-box">
              <div class="mini">Scan result list</div>
              <input id="resultSearchInput" type="text" placeholder="Search results..." style="margin-top:10px;" />
              <div class="result-summary">
                <span id="resultCompletedInfo" class="done"></span>
                <span id="resultCountInfo" class="mini"></span>
              </div>
              <div id="modalCandidates" class="candidate-list"></div>
              <div id="modalSelected" class="selected-view">Selected: none</div>
            </div>
            <div id="editBox" class="ocr-box" style="margin-top:12px;display:none;">
              <div class="edit-two-col">
                <div>
                  <div class="mini edit-label">Edit selected text</div>
                  <textarea id="selectedTextEditor" placeholder="Edit selected text here"></textarea>
                </div>
                <div>
                  <div class="mini edit-label">Comment</div>
                  <textarea id="selectedCommentEditor" placeholder="Owner / Location"></textarea>
                </div>
              </div>
              <div class="row" style="margin-top:10px;">
                <button id="saveSelectedTextBtn" class="success">Complete this record</button>
              </div>
              <div id="overrideInfo" class="mini" style="margin-top:10px;"></div>
              <div id="recordReadonlyNote" class="readonly-note"></div>
            </div>
          </div>
        </div>
        <div id="scannerDetailLayout" class="hidden">
          <div class="ocr-box">
            <div class="scanner-result-label">Scanned text</div>
            <div class="selected-view" id="scannerDetailText">Scanned text: none</div>
            <div id="scannerEditBox" style="margin-top:12px;">
              <div class="edit-two-col">
                <div>
                  <div class="mini edit-label">Edit scanned text</div>
                  <textarea id="scannerSelectedTextEditor" placeholder="Edit scanned text here"></textarea>
                </div>
                <div>
                  <div class="mini edit-label">Comment</div>
                  <textarea id="scannerCommentEditor" placeholder="Owner / Location"></textarea>
                </div>
              </div>
              <div class="row" style="margin-top:10px;">
                <button id="scannerSaveSelectedTextBtn" class="success">Complete this record</button>
              </div>
              <div id="scannerReadonlyNote" class="readonly-note"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Build rename modal
export function buildRenameModal(id, title, placeholder, buttonText) {
  return `
    <div id="${id}" class="modal">
      <div class="modal-panel" style="max-width:520px;">
        <div class="modal-head">
          <div><div class="section-title" style="margin:0;">${escapeHtml(title)}</div></div>
          <button class="danger">Close</button>
        </div>
        <div class="col">
          <div class="name-badge"></div>
          <input type="text" placeholder="${escapeHtml(placeholder)}" />
          <div class="row">
            <button class="primary">${escapeHtml(buttonText)}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Build delete confirm modal
export function buildDeleteConfirmModal(id, message) {
  return `
    <div id="${id}" class="modal">
      <div class="modal-panel" style="max-width:460px;">
        <div class="section-title" style="margin:0;">Confirm Delete</div>
        <div class="col" style="margin-top:12px;">
          <div class="meta-line">${escapeHtml(message)}</div>
          <div class="row">
            <button class="danger">Delete</button>
            <button>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Build assign modal
export function buildAssignModal() {
  return `
    <div id="assignModal" class="modal">
      <div class="modal-panel" style="max-width:520px;">
        <div class="section-title" style="margin:0;">Assign Record</div>
        <div class="col" style="margin-top:12px;">
          <select id="assignReceiverSelect"></select>
          <div class="row">
            <button class="primary">Assign</button>
            <button>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Bind record cards (attach event listeners)
export function bindRecordCards(containerEl, sourceItems, openModalFn) {
  containerEl.querySelectorAll('[data-open-id]').forEach(card => {
    card.onclick = (e) => {
      if (e.target.closest('[data-preview-record]')) return;
      const id = card.getAttribute('data-open-id');
      const item = sourceItems.find(x => x.id === id);
      if (item && openModalFn) openModalFn(item);
    };
  });

  containerEl.querySelectorAll('[data-preview-record]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      // Preview handling would go here
    };
  });
}

// Build dashboard table header
export function buildDashboardTableHeader(visibleColumns, sortState, onSort, onColMenu) {
  const sortIcon = (key) => {
    if (sortState.sortBy !== key) return '↕';
    return sortState.sortDir === 'asc' ? '↑' : '↓';
  };

  return `
    <thead>
      <tr>
        <th>
          <div class="dashboard-th-wrap">
            <span>Origin</span>
            <button class="dashboard-sort-btn" data-sort="origin">${sortIcon('origin')}</button>
          </div>
        </th>
        <th class="dashboard-col-index">#</th>
        ${visibleColumns.map(col => `
          <th>
            <div class="dashboard-th-wrap">
              <span>${escapeHtml(col)}</span>
              <button class="dashboard-sort-btn" data-sort="${escapeHtml(col)}">${sortIcon(col)}</button>
              <button class="dashboard-col-menu-btn" data-col-menu="${escapeHtml(col)}">▾</button>
            </div>
          </th>
        `).join('')}
        <th>
          <div class="dashboard-th-wrap">
            <span>Status</span>
            <button class="dashboard-sort-btn" data-sort="status">${sortIcon('status')}</button>
          </div>
        </th>
        <th>
          <div class="dashboard-th-wrap">
            <span>Matched Text</span>
            <button class="dashboard-sort-btn" data-sort="matchedSelectedText">${sortIcon('matchedSelectedText')}</button>
          </div>
        </th>
        <th>Comment</th>
        <th>Action</th>
      </tr>
    </thead>
  `;
}

// Build dashboard table row
export function buildDashboardTableRow(item, visibleColumns, readonly) {
  return `
    <tr>
      <td>${buildOriginBadge(item.origin)}</td>
      <td class="dashboard-col-index">${item.sourceIndex || '-'}</td>
      ${visibleColumns.map(col => `<td>${item.origin === 'import' ? escapeHtml(item.sourceData && item.sourceData[col] || '-') : '-'}</td>`).join('')}
      <td>${buildStatusBadge(item.status, item.isAddNew)}</td>
      <td>${escapeHtml(item.matchedSelectedText || '-')}</td>
      <td>${escapeHtml(item.dashboardComment || '-')}</td>
      <td>
        <div class="row-actions">
          <button data-dashboard-view="${item.id}" class="mini-action primary" title="View">V</button>
          ${readonly ? '' : `
            <button data-dashboard-comment="${item.id}" class="mini-action" title="Comment">C</button>
            ${item.canAddNew ? `<button data-dashboard-addfound="${item.id}" class="mini-action success" title="Add New">A</button>` : ''}
          `}
        </div>
      </td>
    </tr>
  `;
}
