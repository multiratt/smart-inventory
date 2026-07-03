// Sender page
import {
  bindThemeButtons,
  escapeHtml,
  normalizeStrictUserName,
  hasStrictUserName,
  normalizeFreeText,
  hasMeaningfulText,
  formatDateTime,
  fetchJson,
  showToast,
  debounce,
  renderTypeBadge,
  renderReviewedBadge,
  renderAddNewBadge,
  renderFoundBadge,
  renderPaginationBar,
  bindPaginationBar,
  refreshModalOpenState,
  downloadBlob
} from './utils.js';

const SENDER_COMMENT_MODE_KEY = 'sender_comment_mode_v1';

let app;
let senderBrandSyncDot;
let senderHistoryState = { page: 1, pageSize: 10, total: 0, totalPages: 1, search: '', recordType: 'all' };

// Local state
let pendingImages = [null, null, null, null];
let lastAlertId = '';
let waitLocked = false;
let currentSenderMode = 'photo';
let pendingSenderCommentResolve = null;
let renamePending = false;
let renameDecisionShownId = '';
let scannerSubmitTimer = null;
let scannerSubmitting = false;
let senderHistoryVersion = 0;
let senderSyncVersion = 0;
let senderHistoryLastQueryKey = '';
let senderHistoryFocusState = { id: null, start: 0, end: 0 };
let scannerBufferMeta = {
  firstTs: 0,
  lastTs: 0,
  keyTimes: [],
  repeatedRun: 1,
  lastChar: '',
  manualInvalid: false
};

export async function initSender() {
  app = document.getElementById('app');

  app.innerHTML = `
    <header>
      <div class="header-inner">
        <div class="header-left">
          <div class="brand">Smart Inventory <span id="senderBrandSyncDot" class="brand-status-dot" title="Last sync: -"></span></div>
        </div>
        <div class="header-center"></div>
        <div class="header-right">
          <button id="goReceiverFromSenderBtn" class="icon-btn" title="Open receiver">📥</button>
          <button id="senderUserMenuBtn" class="user-menu-btn" title="Profile">👤</button>
          <button data-theme-btn class="icon-btn" title="Toggle theme">☀️</button>
          <button id="openSenderProfileBtn" class="icon-btn" title="Messages">💬</button>
        </div>
      </div>
    </header>

    <div class="container">
      <div class="sender-page-head">
        <div class="page-title">Inventory Check - Sender</div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="section-title" style="margin-bottom:8px;">Select Input</div>
          <div class="row" style="margin-bottom:12px;">
            <button id="photoModeBtn" class="primary">Photo</button>
            <button id="scannerModeBtn">Scanner</button>
            <button id="senderCommentToggleBtn" class="comment-toggle on" type="button">Comment ON</button>
          </div>

          <div id="photoModePanel" class="mode-panel active">
            <h2 class="section-title">Photo Record</h2>
            <div class="row">
              <label class="file-label primary" for="fileInput1">Select Image 1</label>
              <input id="fileInput1" type="file" accept="image/*" capture="environment" />
              <label class="file-label primary" for="fileInput2">Select Image 2</label>
              <input id="fileInput2" type="file" accept="image/*" capture="environment" />
            </div>
            <div id="previewRow12" class="sender-preview-row"></div>
            <div id="extraImageActionWrap" class="row hidden" style="margin-top:12px;">
              <button id="addMoreImagesBtn" type="button">＋</button>
            </div>
            <div id="extraImageRow" class="hidden" style="margin-top:12px;">
              <div class="row">
                <label class="file-label primary" for="fileInput3">Select Image 3</label>
                <input id="fileInput3" type="file" accept="image/*" capture="environment" />
                <label class="file-label primary" for="fileInput4">Select Image 4</label>
                <input id="fileInput4" type="file" accept="image/*" capture="environment" />
              </div>
              <div id="previewRow34" class="sender-preview-row"></div>
            </div>
            <div id="uploadRecordWrap" class="hidden" style="margin-top:12px;">
              <button id="submitRecordBtn" class="primary">Upload Record</button>
            </div>
          </div>

          <div id="scannerModePanel" class="mode-panel">
            <h2 class="section-title">Scanner Record</h2>
            <div class="mini" style="margin-bottom:10px;">Click input and scan with hardware barcode scanner.</div>
            <input id="scannerInput" class="scanner-input" type="text" inputmode="none" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="Click here and scan..." />
          </div>

          <div id="sendingStatus" class="sending-status"></div>
          <div id="waitStatus" class="sending-status" style="display:none;">Please wait until you receive another instruction.</div>
        </div>

        <div class="card">
          <h2 id="sendHistoryTitle" class="section-title">Send History (0)</h2>
          <div class="search-grid" style="margin-bottom:12px;">
            <input id="senderHistorySearchInput" type="search" placeholder="Search history..." />
            <div class="search-right">
              <select id="senderHistoryTypeFilter" class="small-select">
                <option value="all">All Types</option>
                <option value="photo">Photo</option>
                <option value="scanner">Scanner</option>
              </select>
            </div>
          </div>
          <div id="senderHistory" class="history-list"></div>
          <div id="senderHistoryPaginationWrap"></div>
        </div>
      </div>
    </div>

    <div id="senderNameRequiredModal" class="modal">
      <div class="modal-panel" style="max-width:520px;">
        <div class="section-title" style="margin:0;">Set Your Name</div>
        <div class="sub" id="senderNameRequiredSub">Please set your username before using this page.</div>
        <div class="col" style="margin-top:12px;">
          <input id="senderNameRequiredInput" type="text" placeholder="Enter username" />
          <div class="row">
            <button id="saveRequiredNameBtn" class="success">Continue</button>
          </div>
        </div>
      </div>
    </div>

    <div id="senderRenameModal" class="modal">
      <div class="modal-panel" style="max-width:520px;">
        <div class="modal-head">
          <div><div class="section-title" style="margin:0;">Profile</div></div>
          <button id="closeSenderRenameModalBtn" class="danger">Close</button>
        </div>
        <div class="col">
          <div id="senderRenameCurrentName" class="name-badge"></div>
          <input id="senderRenameInput" type="text" placeholder="Request new name" />
          <div class="row">
            <button id="requestSenderRenameBtn" class="primary">Request Rename</button>
          </div>
        </div>
      </div>
    </div>

    <div id="senderRenameWaitingModal" class="modal">
      <div class="modal-panel" style="max-width:520px;">
        <div class="waiting-lock-screen">
          <div class="title">Waiting for Admin Review</div>
          <div class="desc">Your rename request has been sent. Please wait while the admin reviews your request.</div>
        </div>
      </div>
    </div>

    <div id="senderRenameDecisionModal" class="modal">
      <div class="modal-panel" style="max-width:520px;">
        <div class="section-title" style="margin:0;">Rename Result</div>
        <div id="senderRenameDecisionText" class="mobile-alert-text"></div>
        <div class="row center">
          <button id="senderRenameDecisionOkBtn" class="success">OK</button>
        </div>
      </div>
    </div>

    <div id="mobileAlertModal" class="modal">
      <div class="modal-panel" style="max-width:520px;">
        <div class="section-title" style="margin:0;">Message</div>
        <div id="mobileAlertFrom" class="mobile-alert-from"></div>
        <div id="mobileAlertText" class="mobile-alert-text"></div>
        <div id="mobileAlertOkWrap" class="row center">
          <button id="mobileAlertOkBtn" class="success">OK</button>
        </div>
      </div>
    </div>

    <div id="senderCommentModal" class="modal">
      <div class="modal-panel" style="max-width:520px;">
        <div class="section-title" style="margin:0;">Add Comment</div>
        <div class="col">
          <textarea id="senderCommentInput" placeholder="Owner / Location"></textarea>
          <div class="row">
            <button id="confirmSenderCommentBtn" class="primary" type="button">Submit</button>
            <button id="cancelSenderCommentBtn" type="button">Cancel</button>
          </div>
        </div>
      </div>
    </div>

    <div id="senderReplyModal" class="modal">
      <div class="modal-panel" style="max-width:520px;">
        <div class="modal-head">
          <div>
            <div class="section-title" style="margin:0;">Send Message</div>
            <div id="senderReplyTargetText" class="sub"></div>
          </div>
          <button id="closeSenderReplyModalBtn" class="danger">Close</button>
        </div>
        <div class="col">
          <textarea id="senderReplyText" placeholder="Type message"></textarea>
          <div class="row">
            <button id="sendReplyBtn" class="primary">Send Message</button>
          </div>
        </div>
      </div>
    </div>
  `;

  bindThemeButtons();
  bindSenderEvents();
  refreshSenderProfileBadge();
  renderPreviewRows();
  refreshSenderCommentToggle();
  switchSenderMode('photo');
  loadSenderHistory(true);
  updateSenderSyncDot();
  senderHeartbeat();
  checkMobileAlert();
  checkSenderRenameStatus();

  setInterval(() => {
    if (hasActiveTypingField()) return;
    loadSenderHistory(false);
  }, 2500);
  setInterval(updateSenderSyncDot, 3000);
  setInterval(senderHeartbeat, 3500);
  setInterval(checkMobileAlert, 1800);
  setInterval(checkSenderRenameStatus, 1800);

  if (!getGlobalUserName()) {
    document.getElementById('senderNameRequiredModal').classList.add('show');
    refreshModalOpenState();
  }
}

function getGlobalUserName() {
  return normalizeStrictUserName(localStorage.getItem('smart_inventory_user_name_v4') || '');
}

function setGlobalUserName(name) {
  localStorage.setItem('smart_inventory_user_name_v4', normalizeStrictUserName(name || ''));
}

function getUnifiedClientId() {
  return localStorage.getItem('smart_inventory_device_id_v4') || '';
}

function getCleanGeneration() {
  return Number(localStorage.getItem('clean_generation_v1') || '0');
}

function setCleanGeneration(value) {
  localStorage.setItem('clean_generation_v1', String(Number(value || 0)));
}

function resetAllLocalSessions() {
  localStorage.removeItem('smart_inventory_user_name_v4');
}

function getFingerprint() {
  return {
    userAgent: navigator.userAgent || '',
    platform: navigator.platform || '',
    language: navigator.language || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    screen: `${window.screen && window.screen.width || 0}x${window.screen && window.screen.height || 0}`
  };
}

function hasActiveTypingField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = String(el.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function bindSenderEvents() {
  const goReceiverFromSenderBtn = document.getElementById('goReceiverFromSenderBtn');
  const senderUserMenuBtn = document.getElementById('senderUserMenuBtn');
  const senderCommentToggleBtn = document.getElementById('senderCommentToggleBtn');
  const senderCommentModal = document.getElementById('senderCommentModal');
  const senderCommentInput = document.getElementById('senderCommentInput');
  const confirmSenderCommentBtn = document.getElementById('confirmSenderCommentBtn');
  const cancelSenderCommentBtn = document.getElementById('cancelSenderCommentBtn');
  const openSenderProfileBtn = document.getElementById('openSenderProfileBtn');
  const senderRenameModal = document.getElementById('senderRenameModal');
  const senderRenameCurrentName = document.getElementById('senderRenameCurrentName');
  const senderRenameInput = document.getElementById('senderRenameInput');
  const requestSenderRenameBtn = document.getElementById('requestSenderRenameBtn');
  const closeSenderRenameModalBtn = document.getElementById('closeSenderRenameModalBtn');
  const senderRenameWaitingModal = document.getElementById('senderRenameWaitingModal');
  const senderRenameDecisionModal = document.getElementById('senderRenameDecisionModal');
  const senderRenameDecisionText = document.getElementById('senderRenameDecisionText');
  const senderRenameDecisionOkBtn = document.getElementById('senderRenameDecisionOkBtn');
  const fileInput1 = document.getElementById('fileInput1');
  const fileInput2 = document.getElementById('fileInput2');
  const fileInput3 = document.getElementById('fileInput3');
  const fileInput4 = document.getElementById('fileInput4');
  const previewRow12 = document.getElementById('previewRow12');
  const previewRow34 = document.getElementById('previewRow34');
  const extraImageActionWrap = document.getElementById('extraImageActionWrap');
  const addMoreImagesBtn = document.getElementById('addMoreImagesBtn');
  const extraImageRow = document.getElementById('extraImageRow');
  const submitRecordBtn = document.getElementById('submitRecordBtn');
  const senderHistory = document.getElementById('senderHistory');
  const senderHistoryPaginationWrap = document.getElementById('senderHistoryPaginationWrap');
  const senderHistorySearchInput = document.getElementById('senderHistorySearchInput');
  const senderHistoryTypeFilter = document.getElementById('senderHistoryTypeFilter');
  const sendHistoryTitle = document.getElementById('sendHistoryTitle');
  const sendingStatus = document.getElementById('sendingStatus');
  const waitStatus = document.getElementById('waitStatus');
  const uploadRecordWrap = document.getElementById('uploadRecordWrap');
  const photoModeBtn = document.getElementById('photoModeBtn');
  const scannerModeBtn = document.getElementById('scannerModeBtn');
  const photoModePanel = document.getElementById('photoModePanel');
  const scannerModePanel = document.getElementById('scannerModePanel');
  const scannerInput = document.getElementById('scannerInput');
  const senderNameRequiredModal = document.getElementById('senderNameRequiredModal');
  const senderNameRequiredInput = document.getElementById('senderNameRequiredInput');
  const senderNameRequiredSub = document.getElementById('senderNameRequiredSub');
  const saveRequiredNameBtn = document.getElementById('saveRequiredNameBtn');
  const mobileAlertModal = document.getElementById('mobileAlertModal');
  const mobileAlertText = document.getElementById('mobileAlertText');
  const mobileAlertFrom = document.getElementById('mobileAlertFrom');
  const mobileAlertOkBtn = document.getElementById('mobileAlertOkBtn');
  const mobileAlertOkWrap = document.getElementById('mobileAlertOkWrap');
  const senderReplyModal = document.getElementById('senderReplyModal');
  const closeSenderReplyModalBtn = document.getElementById('closeSenderReplyModalBtn');
  const senderReplyText = document.getElementById('senderReplyText');
  const sendReplyBtn = document.getElementById('sendReplyBtn');
  const senderReplyTargetText = document.getElementById('senderReplyTargetText');
  const senderRenameDecisionOkBtn = document.getElementById('senderRenameDecisionOkBtn');

  goReceiverFromSenderBtn.onclick = () => { window.location.href = '/receiver'; };
  photoModeBtn.onclick = () => switchSenderMode('photo');
  scannerModeBtn.onclick = () => {
    switchSenderMode('scanner');
    setTimeout(() => scannerInput.focus(), 80);
  };

  senderCommentToggleBtn.onclick = () => {
    localStorage.setItem(SENDER_COMMENT_MODE_KEY, isSenderCommentModeOn() ? 'off' : 'on');
    refreshSenderCommentToggle();
  };

  confirmSenderCommentBtn.onclick = () => {
    const value = normalizeFreeText(senderCommentInput.value);
    if (!hasMeaningfulText(value)) {
      showToast('Please enter a comment.', 'warn');
      return;
    }
    closeSenderCommentModal(value);
  };
  cancelSenderCommentBtn.onclick = () => closeSenderCommentModal(null);

  senderUserMenuBtn.onclick = () => {
    senderRenameInput.value = '';
    refreshSenderProfileBadge();
    senderRenameModal.classList.add('show');
    refreshModalOpenState();
  };
  closeSenderRenameModalBtn.onclick = () => {
    if (renamePending) return;
    senderRenameModal.classList.remove('show');
    refreshModalOpenState();
  };

  requestSenderRenameBtn.onclick = async () => {
    const currentName = getGlobalUserName();
    const newName = await validateUniqueName(senderRenameInput.value, getUnifiedClientId());
    if (!newName) return;
    if (newName === currentName) {
      showToast('New name must be different from current name.', 'warn');
      return;
    }
    try {
      await fetchJson('/api/rename-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requesterRole: 'sender',
          requesterId: getUnifiedClientId(),
          currentName,
          requestedName: newName
        })
      });
      renamePending = true;
      senderRenameWaitingModal.classList.add('show');
      senderRenameModal.classList.remove('show');
      refreshModalOpenState();
    } catch (e) {
      showToast('Rename request failed: ' + e.message, 'danger');
    }
  };

  openSenderProfileBtn.onclick = () => {
    if (waitLocked) return;
    senderReplyText.value = '';
    senderReplyTargetText.textContent = 'Send message to all receivers';
    senderReplyModal.classList.add('show');
    refreshModalOpenState();
  };
  closeSenderReplyModalBtn.onclick = () => {
    senderReplyModal.classList.remove('show');
    refreshModalOpenState();
  };
  sendReplyBtn.onclick = async () => {
    const text = normalizeFreeText(senderReplyText.value);
    if (!hasMeaningfulText(text)) {
      showToast('Please type a message.', 'warn');
      return;
    }
    try {
      await fetchJson('/api/team-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromRole: 'sender',
          fromId: getUnifiedClientId(),
          fromName: getGlobalUserName(),
          targetRole: 'all-receivers',
          targetId: '',
          targetName: '',
          message: text
        })
      });
      senderReplyModal.classList.remove('show');
      refreshModalOpenState();
    } catch (e) {
      showToast('Send failed: ' + e.message, 'danger');
    }
  };

  saveRequiredNameBtn.onclick = async () => {
    try {
      const ok = await saveInitialGlobalName(senderNameRequiredInput.value);
      if (!ok) return;
      senderNameRequiredModal.classList.remove('show');
      refreshModalOpenState();
      loadSenderHistory(true);
    } catch (e) {
      showToast('Save name failed: ' + e.message, 'danger');
    }
  };

  addMoreImagesBtn.onclick = () => {
    extraImageRow.classList.remove('hidden');
    extraImageActionWrap.classList.add('hidden');
  };

  fileInput1.onchange = async (ev) => { await handleFileSelect(ev.target.files && ev.target.files[0], 0); };
  fileInput2.onchange = async (ev) => { await handleFileSelect(ev.target.files && ev.target.files[0], 1); };
  fileInput3.onchange = async (ev) => { await handleFileSelect(ev.target.files && ev.target.files[0], 2); };
  fileInput4.onchange = async (ev) => { await handleFileSelect(ev.target.files && ev.target.files[0], 3); };

  submitRecordBtn.onclick = async () => {
    const senderName = getGlobalUserName();
    if (!senderName) {
      senderNameRequiredModal.classList.add('show');
      refreshModalOpenState();
      return;
    }
    const imagesToSend = pendingImages.filter(Boolean);
    if (imagesToSend.length < 2 || imagesToSend.length > 4) {
      showToast('Please select a minimum of 2 and a maximum of 4 images.', 'warn');
      return;
    }
    const comment = await requestSenderComment();
    if (comment === null) return;
    sendingStatus.textContent = 'Sending...';
    submitRecordBtn.disabled = true;
    try {
      await fetchJson('/api/upload-record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderName,
          deviceId: getUnifiedClientId(),
          recordType: 'photo',
          comment,
          requireComment: isSenderCommentModeOn(),
          cleanGeneration: getCleanGeneration(),
          fingerprint: getFingerprint(),
          images: imagesToSend
        })
      });
      pendingImages = [null, null, null, null];
      fileInput1.value = '';
      fileInput2.value = '';
      fileInput3.value = '';
      fileInput4.value = '';
      extraImageRow.classList.add('hidden');
      renderPreviewRows();
      sendingStatus.textContent = 'Sent successfully.';
      senderHistoryState.page = 1;
      senderHistoryVersion = 0;
      await loadSenderHistory(true);
    } catch (e) {
      sendingStatus.textContent = 'Sending failed: ' + e.message;
    }
    submitRecordBtn.disabled = false;
  };

  scannerInput.addEventListener('keydown', async (e) => {
    if (currentSenderMode !== 'scanner') return;
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(scannerSubmitTimer);
      if (scannerLooksValid()) {
        await submitScannerRecord(scannerInput.value);
      } else {
        scannerInput.value = '';
        resetScannerMeta();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && ['v', 'c', 'x', 'a'].includes(String(e.key || '').toLowerCase())) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      scannerInput.value = '';
      resetScannerMeta();
      e.preventDefault();
      return;
    }
    if (e.key && e.key.length === 1) {
      const now = performance.now();
      const ch = e.key;
      if (!scannerBufferMeta.firstTs) scannerBufferMeta.firstTs = now;
      scannerBufferMeta.lastTs = now;
      scannerBufferMeta.keyTimes.push(now);
      if (scannerBufferMeta.lastChar === ch) scannerBufferMeta.repeatedRun += 1;
      else scannerBufferMeta.repeatedRun = 1;
      scannerBufferMeta.lastChar = ch;
    }
  });

  scannerInput.addEventListener('input', () => {
    if (currentSenderMode !== 'scanner') return;
    const value = scannerInput.value || '';
    if (!value) {
      resetScannerMeta();
      return;
    }
    if (/(.)\1\1\1/.test(value)) {
      scannerInput.value = '';
      resetScannerMeta();
      return;
    }
    queueScannerValidateAndSubmit();
  });

  scannerInput.addEventListener('paste', e => {
    e.preventDefault();
    scannerInput.value = '';
    resetScannerMeta();
  });
  scannerInput.addEventListener('drop', e => {
    e.preventDefault();
    scannerInput.value = '';
    resetScannerMeta();
  });

  const debouncedSenderHistorySearch = debounce(() => {
    senderHistoryState.search = normalizeFreeText(senderHistorySearchInput.value);
    senderHistoryState.page = 1;
    senderHistoryVersion = 0;
    loadSenderHistory(true);
  }, 400);
  senderHistorySearchInput.oninput = debouncedSenderHistorySearch;
  senderHistoryTypeFilter.onchange = () => {
    senderHistoryState.recordType = senderHistoryTypeFilter.value;
    senderHistoryState.page = 1;
    senderHistoryVersion = 0;
    loadSenderHistory(true);
  };

  senderRenameDecisionOkBtn.onclick = async () => {
    senderRenameDecisionModal.classList.remove('show');
    try {
      await fetchJson('/api/rename-decision-ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requesterRole: 'sender', requesterId: getUnifiedClientId() })
      });
    } catch {}
    refreshModalOpenState();
    senderHistoryVersion = 0;
    await loadSenderHistory(true);
  };

  mobileAlertOkBtn.onclick = async () => {
    if (waitLocked) return;
    try {
      await fetchJson('/api/sender-alert-ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderName: getGlobalUserName(), alertId: lastAlertId })
      });
    } catch {}
    mobileAlertModal.classList.remove('show');
    refreshModalOpenState();
  };
}

async function updateSenderSyncDot() {
  try {
    const json = await fetchJson('/api/sync-status');
    const senderBrandSyncDot = document.getElementById('senderBrandSyncDot');
    if (!senderBrandSyncDot) return;
    if (json.version !== senderSyncVersion || !senderBrandSyncDot.title) {
      senderSyncVersion = json.version;
      senderBrandSyncDot.style.background = json.status === 'done' ? 'var(--success)' : 'var(--danger)';
      senderBrandSyncDot.title = json.lastSyncTime ? `Last sync: ${formatDateTime(json.lastSyncTime)}` : 'Last sync: -';
    }
  } catch {}
}

async function senderHeartbeat() {
  try {
    const senderName = getGlobalUserName();
    const deviceId = getUnifiedClientId();
    const res = await fetch('/api/sender-heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderName,
        deviceId,
        cleanGeneration: getCleanGeneration(),
        fingerprint: getFingerprint()
      })
    });
    const json = await res.json();

    if (typeof json.cleanGeneration !== 'undefined' && Number(json.cleanGeneration) !== getCleanGeneration()) {
      setCleanGeneration(json.cleanGeneration);
      resetAllLocalSessions();
      window.location.reload();
      return;
    }

    if (!senderName && json.rememberedName) {
      setGlobalUserName(json.rememberedName);
      refreshSenderProfileBadge();
      await loadSenderHistory(true);
    }

    if (json.deletedByReceiver) {
      clearGlobalUserName();
      const senderNameRequiredSub = document.getElementById('senderNameRequiredSub');
      const senderNameRequiredInput = document.getElementById('senderNameRequiredInput');
      const senderNameRequiredModal = document.getElementById('senderNameRequiredModal');
      if (senderNameRequiredSub) senderNameRequiredSub.textContent = 'This user was deleted or the system was reset. Please set a name again.';
      if (senderNameRequiredInput) senderNameRequiredInput.value = '';
      if (senderNameRequiredModal) {
        senderNameRequiredModal.classList.add('show');
        refreshModalOpenState();
      }
    }
  } catch {}
}

async function checkSenderRenameStatus() {
  const senderName = getGlobalUserName();
  if (!senderName) return;
  try {
    const json = await fetchJson('/api/rename-request-status?requesterRole=sender&requesterId=' + encodeURIComponent(getUnifiedClientId()));
    const senderRenameWaitingModal = document.getElementById('senderRenameWaitingModal');
    const senderRenameModal = document.getElementById('senderRenameModal');
    if (json.pending) {
      renamePending = true;
      if (senderRenameWaitingModal) senderRenameWaitingModal.classList.add('show');
      refreshModalOpenState();
      return;
    }
    renamePending = false;
    if (senderRenameWaitingModal) senderRenameWaitingModal.classList.remove('show');

    if (json.decision && renameDecisionShownId !== json.decision.requestId) {
      renameDecisionShownId = json.decision.requestId;
      if (json.decision.decision === 'accept' && json.decision.newName) setGlobalUserName(json.decision.newName);
      refreshSenderProfileBadge();
      const senderRenameDecisionText = document.getElementById('senderRenameDecisionText');
      const senderRenameDecisionModal = document.getElementById('senderRenameDecisionModal');
      if (senderRenameDecisionText) senderRenameDecisionText.textContent = json.decision.message || 'Rename result.';
      if (senderRenameDecisionModal) {
        senderRenameDecisionModal.classList.add('show');
        refreshModalOpenState();
      }
    }
  } catch {}
}

async function checkMobileAlert() {
  try {
    const senderName = getGlobalUserName();
    const json = await fetchJson('/api/sender-alert?senderName=' + encodeURIComponent(senderName) + '&deviceId=' + encodeURIComponent(getUnifiedClientId()));

    if (!senderName && json.rememberedName) {
      setGlobalUserName(json.rememberedName);
      refreshSenderProfileBadge();
    }

    if (json.deletedByReceiver) {
      clearGlobalUserName();
      const senderNameRequiredSub = document.getElementById('senderNameRequiredSub');
      const senderNameRequiredInput = document.getElementById('senderNameRequiredInput');
      const senderNameRequiredModal = document.getElementById('senderNameRequiredModal');
      if (senderNameRequiredSub) senderNameRequiredSub.textContent = 'This user was deleted or the system was reset. Please set a name again.';
      if (senderNameRequiredInput) senderNameRequiredInput.value = '';
      if (senderNameRequiredModal) {
        senderNameRequiredModal.classList.add('show');
        refreshModalOpenState();
      }
      return;
    }

    if (!json.alert || !json.alert.id) return;
    if (json.alert.id === lastAlertId) return;

    lastAlertId = json.alert.id;
    const mobileAlertFrom = document.getElementById('mobileAlertFrom');
    const mobileAlertText = document.getElementById('mobileAlertText');
    const mobileAlertOkWrap = document.getElementById('mobileAlertOkWrap');
    const mobileAlertModal = document.getElementById('mobileAlertModal');
    const waitStatus = document.getElementById('waitStatus');

    if (mobileAlertFrom) mobileAlertFrom.textContent = json.alert.fromName ? `From: ${json.alert.fromName} (${roleLabel(json.alert.fromRole)})` : '';

    const normalizedMessage = String(json.alert.message || '').trim().toLowerCase();
    const isBroadcast = !!json.alert.broadcast;

    if (normalizedMessage === 'wait') {
      if (mobileAlertText) mobileAlertText.textContent = 'Please wait until you receive another instruction.';
      waitLocked = true;
      if (waitStatus) waitStatus.style.display = 'block';
      if (mobileAlertOkWrap) mobileAlertOkWrap.style.display = 'none';
    } else if (normalizedMessage === 'go ahead') {
      if (mobileAlertText) mobileAlertText.textContent = 'Go ahead';
      waitLocked = false;
      if (waitStatus) waitStatus.style.display = 'none';
      if (mobileAlertOkWrap) mobileAlertOkWrap.style.display = 'flex';
    } else if (isBroadcast) {
      if (mobileAlertText) mobileAlertText.textContent = json.alert.message || '';
      waitLocked = false;
      if (waitStatus) waitStatus.style.display = 'none';
      if (mobileAlertOkWrap) mobileAlertOkWrap.style.display = 'flex';
    } else {
      if (mobileAlertText) mobileAlertText.textContent = json.alert.message || '';
      waitLocked = false;
      if (waitStatus) waitStatus.style.display = 'none';
      if (mobileAlertOkWrap) mobileAlertOkWrap.style.display = 'flex';
    }

    if (mobileAlertModal) {
      mobileAlertModal.classList.add('show');
      refreshModalOpenState();
    }
  } catch {}
}

function refreshSenderProfileBadge() {
  const el = document.getElementById('senderRenameCurrentName');
  if (el) el.innerHTML = `<span>${escapeHtml(getGlobalUserName() || '-')}</span>`;
}

function countSelectedImages() { return pendingImages.filter(Boolean).length; }
function updateUploadButtonVisibility() {
  const uploadRecordWrap = document.getElementById('uploadRecordWrap');
  if (uploadRecordWrap) uploadRecordWrap.classList.toggle('hidden', countSelectedImages() < 2 || currentSenderMode !== 'photo');
}
function updateExtraImageControls() {
  const firstTwoReady = !!pendingImages[0] && !!pendingImages[1];
  const extraImageActionWrap = document.getElementById('extraImageActionWrap');
  const extraImageRow = document.getElementById('extraImageRow');
  if (extraImageActionWrap) extraImageActionWrap.classList.toggle('hidden', !firstTwoReady || !extraImageRow.classList.contains('hidden') || currentSenderMode !== 'photo');
}

function renderSenderPreviewGrid(rowEl, items) {
  const count = items.length;
  rowEl.className = 'sender-preview-row ' + (count <= 2 ? 'two' : 'four');
  rowEl.innerHTML = items.map(item => `
    <div class="sender-preview-block">
      <img class="thumb" src="${item.data}" alt="">
      <div class="mini">${escapeHtml(item.name)}</div>
    </div>
  `).join('');
}

function renderPreviewRows() {
  const first = [0, 1].filter(i => pendingImages[i]).map(i => pendingImages[i]);
  const second = [2, 3].filter(i => pendingImages[i]).map(i => pendingImages[i]);
  const previewRow12 = document.getElementById('previewRow12');
  const previewRow34 = document.getElementById('previewRow34');

  if (previewRow12) previewRow12.innerHTML = '';
  if (previewRow34) previewRow34.innerHTML = '';
  if (first.length && previewRow12) renderSenderPreviewGrid(previewRow12, first);
  if (second.length && previewRow34) renderSenderPreviewGrid(previewRow34, second);
  updateExtraImageControls();
  updateUploadButtonVisibility();
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFileSelect(file, slotIndex) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Please choose an image file only.', 'warn');
    return;
  }
  const raw = await readFile(file);
  const optimized = await optimizeImageDataURL(raw);
  pendingImages[slotIndex] = { name: formatTimestampFileName(slotIndex + 1), data: optimized };
  renderPreviewRows();
}

async function optimizeImageDataURL(dataURL, maxSide = 1400, quality = 0.78) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataURL;
  });
  let w = img.width;
  let h = img.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  w = Math.round(w * scale);
  h = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

function switchSenderMode(mode) {
  currentSenderMode = mode;
  const photoModeBtn = document.getElementById('photoModeBtn');
  const scannerModeBtn = document.getElementById('scannerModeBtn');
  const photoModePanel = document.getElementById('photoModePanel');
  const scannerModePanel = document.getElementById('scannerModePanel');
  const scannerInput = document.getElementById('scannerInput');

  if (photoModeBtn) photoModeBtn.className = mode === 'photo' ? 'primary' : '';
  if (scannerModeBtn) scannerModeBtn.className = mode === 'scanner' ? 'primary' : '';
  if (photoModePanel) photoModePanel.classList.toggle('active', mode === 'photo');
  if (scannerModePanel) scannerModePanel.classList.toggle('active', mode === 'scanner');
  updateExtraImageControls();
  updateUploadButtonVisibility();
  if (mode === 'scanner' && scannerInput) setTimeout(() => scannerInput.focus(), 50);
}

function isSenderCommentModeOn() { return localStorage.getItem(SENDER_COMMENT_MODE_KEY) !== 'off'; }
function refreshSenderCommentToggle() {
  const senderCommentToggleBtn = document.getElementById('senderCommentToggleBtn');
  if (!senderCommentToggleBtn) return;
  const on = isSenderCommentModeOn();
  senderCommentToggleBtn.textContent = `Comment ${on ? 'ON' : 'OFF'}`;
  senderCommentToggleBtn.classList.toggle('on', on);
  senderCommentToggleBtn.classList.toggle('off', !on);
}

function requestSenderComment() {
  if (!isSenderCommentModeOn()) return Promise.resolve('');
  return new Promise(resolve => {
    pendingSenderCommentResolve = resolve;
    const senderCommentInput = document.getElementById('senderCommentInput');
    const senderCommentModal = document.getElementById('senderCommentModal');
    if (senderCommentInput) senderCommentInput.value = '';
    if (senderCommentModal) {
      senderCommentModal.classList.add('show');
      refreshModalOpenState();
    }
    if (senderCommentInput) setTimeout(() => senderCommentInput.focus(), 50);
  });
}

function closeSenderCommentModal(value) {
  const senderCommentModal = document.getElementById('senderCommentModal');
  if (senderCommentModal) senderCommentModal.classList.remove('show');
  const resolve = pendingSenderCommentResolve;
  pendingSenderCommentResolve = null;
  if (resolve) resolve(value);
  refreshModalOpenState();
}

async function validateUniqueName(rawName, deviceId) {
  const raw = String(rawName || '').trim();
  if (!raw || !hasStrictUserName(raw)) {
    showToast('Username must contain English letters only.', 'warn');
    return null;
  }
  const normalized = normalizeStrictUserName(raw);
  const json = await fetchJson('/api/check-sender-name?name=' + encodeURIComponent(normalized) + '&deviceId=' + encodeURIComponent(deviceId));
  if (!json.valid) {
    showToast('Username must contain English letters only.', 'warn');
    return null;
  }
  if (json.duplicate) {
    showToast(`The name "${normalized}" is already used in the system.`, 'warn');
    return null;
  }
  return json.normalized || normalized;
}

async function saveInitialGlobalName(rawName) {
  const resolvedName = await validateUniqueName(rawName, getUnifiedClientId());
  if (!resolvedName) return false;
  setGlobalUserName(resolvedName);
  refreshSenderProfileBadge();
  await senderHeartbeat();
  return true;
}

function senderHistoryThumbClass(images) {
  const count = Math.min((images || []).length, 4);
  return count <= 2 ? 'sender-history-thumbs two' : 'sender-history-thumbs four';
}

function buildSenderHistoryMarkup(mine) {
  return mine.map(item => `
    <div class="history-item">
      ${item.recordType === 'photo'
        ? `<div class="${senderHistoryThumbClass(item.images)}">
            ${(item.images || []).slice(0, 4).map(img => `<img class="thumb" loading="lazy" src="${img.url}" alt="">`).join('')}
          </div>`
        : `<div class="scanner-icon-box">📝</div>`
      }
      <div class="meta">
        <div class="big-selected">${item.selectedText ? escapeHtml(item.selectedText) : 'No selected text'}</div>
        <div class="mini">Sender: ${escapeHtml(item.senderName)}</div>
        <div class="meta-line"><strong>Sent:</strong> ${formatDateTime(item.timestamp)}</div>
        ${item.comment ? `<div class="meta-line"><strong>Comment:</strong> ${escapeHtml(item.comment)}</div>` : ''}
        ${item.selectedSourceText && item.selectedText && item.selectedSourceText !== item.selectedText ? `<div class="meta-line"><strong>Override:</strong> ${escapeHtml(item.selectedSourceText)} → ${escapeHtml(item.selectedText)}</div>` : ''}
        <div class="row badge-row">
          ${renderTypeBadge(item.recordType)}
          ${renderAddNewBadge(item.isAddNew)}
          ${renderFoundBadge(item)}
          ${item.deleted ? `<div class="pill deleted">Deleted</div>` : item.completed ? renderReviewedBadge(item) : `<div class="pill pending">Pending Review</div>`}
        </div>
      </div>
    </div>
  `).join('');
}

function preserveSenderHistorySearchSelection() {
  const el = document.getElementById('senderHistorySearchInput');
  if (!el) return;
  if (document.activeElement === el) {
    senderHistoryFocusState = {
      id: 'senderHistorySearchInput',
      start: el.selectionStart || 0,
      end: el.selectionEnd || 0
    };
  } else {
    senderHistoryFocusState = { id: null, start: 0, end: 0 };
  }
}
function restoreSenderHistorySearchSelection() {
  if (!senderHistoryFocusState.id) return;
  const el = document.getElementById(senderHistoryFocusState.id);
  if (!el) return;
  el.focus();
  try { el.setSelectionRange(senderHistoryFocusState.start, senderHistoryFocusState.end); } catch {}
}

async function loadSenderHistory(force = false) {
  try {
    const senderName = getGlobalUserName();
    const senderHistory = document.getElementById('senderHistory');
    const senderHistoryPaginationWrap = document.getElementById('senderHistoryPaginationWrap');
    const sendHistoryTitle = document.getElementById('sendHistoryTitle');

    if (!senderName) {
      if (senderHistory) senderHistory.innerHTML = `<div class="empty">Please set sender name first.</div>`;
      if (senderHistoryPaginationWrap) senderHistoryPaginationWrap.innerHTML = '';
      if (sendHistoryTitle) sendHistoryTitle.textContent = 'Send History (0)';
      return;
    }

    const params = new URLSearchParams({
      page: String(senderHistoryState.page),
      pageSize: String(senderHistoryState.pageSize),
      senderName,
      search: senderHistoryState.search,
      recordType: senderHistoryState.recordType
    });

    const data = await fetchJson('/api/records?' + params.toString());
    const queryKey = params.toString();

    if (!force && data.version === senderHistoryVersion && senderHistoryLastQueryKey === queryKey) return;

    preserveSenderHistorySearchSelection();
    senderHistoryVersion = data.version || 0;
    senderHistoryLastQueryKey = queryKey;
    senderHistoryState.page = data.page || 1;
    senderHistoryState.pageSize = data.pageSize || senderHistoryState.pageSize;
    senderHistoryState.total = data.total || 0;
    senderHistoryState.totalPages = data.totalPages || 1;
    if (sendHistoryTitle) sendHistoryTitle.textContent = `Send History (${senderHistoryState.total})`;

    const mine = Array.isArray(data.items) ? data.items : [];
    if (senderHistory) senderHistory.innerHTML = mine.length ? buildSenderHistoryMarkup(mine) : `<div class="empty">No records yet.</div>`;

    if (senderHistoryPaginationWrap) {
      senderHistoryPaginationWrap.innerHTML = renderPaginationBar('senderHistory', senderHistoryState);
      bindPaginationBar('senderHistory', senderHistoryState, () => loadSenderHistory(true));
    }
    restoreSenderHistorySearchSelection();
  } catch (e) {
    const senderHistory = document.getElementById('senderHistory');
    const senderHistoryPaginationWrap = document.getElementById('senderHistoryPaginationWrap');
    if (senderHistory) senderHistory.innerHTML = `<div class="empty">Failed to load history: ${escapeHtml(e.message)}</div>`;
    if (senderHistoryPaginationWrap) senderHistoryPaginationWrap.innerHTML = '';
  }
}

async function submitScannerRecord(forceValue = '') {
  if (scannerSubmitting) return;
  const senderName = getGlobalUserName();
  if (!senderName) {
    const senderNameRequiredModal = document.getElementById('senderNameRequiredModal');
    if (senderNameRequiredModal) {
      senderNameRequiredModal.classList.add('show');
      refreshModalOpenState();
    }
    return;
  }

  const value = normalizeFreeText(forceValue || (document.getElementById('scannerInput')?.value || ''));
  if (!hasMeaningfulText(value)) return;

  scannerSubmitting = true;
  const comment = await requestSenderComment();
  if (comment === null) {
    scannerSubmitting = false;
    const scannerInput = document.getElementById('scannerInput');
    if (scannerInput) scannerInput.focus();
    return;
  }

  const sendingStatus = document.getElementById('sendingStatus');
  const scannerInput = document.getElementById('scannerInput');

  if (sendingStatus) sendingStatus.textContent = 'Sending...';
  if (scannerInput) scannerInput.disabled = true;

  try {
    await fetchJson('/api/upload-record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderName,
        deviceId: getUnifiedClientId(),
        recordType: 'scanner',
        scannerText: value,
        comment,
        requireComment: isSenderCommentModeOn(),
        cleanGeneration: getCleanGeneration(),
        fingerprint: getFingerprint(),
        images: []
      })
    });
    if (scannerInput) scannerInput.value = '';
    if (sendingStatus) sendingStatus.textContent = 'Sent successfully.';
    senderHistoryState.page = 1;
    senderHistoryVersion = 0;
    await loadSenderHistory(true);
  } catch (e) {
    if (sendingStatus) sendingStatus.textContent = 'Sending failed: ' + e.message;
  }
  if (scannerInput) scannerInput.disabled = false;
  scannerSubmitting = false;
  resetScannerMeta();
  if (scannerInput) scannerInput.focus();
}

function resetScannerMeta() {
  scannerBufferMeta = {
    firstTs: 0,
    lastTs: 0,
    keyTimes: [],
    repeatedRun: 1,
    lastChar: '',
    manualInvalid: false
  };
}

function scannerLooksValid() {
  const scannerInput = document.getElementById('scannerInput');
  const value = scannerInput?.value || '';
  if (value.length < 4) return false;

  const times = scannerBufferMeta.keyTimes || [];
  if (times.length < 4) return false;

  let totalGap = 0;
  let gapCount = 0;
  for (let i = 1; i < times.length; i++) {
    totalGap += (times[i] - times[i - 1]);
    gapCount += 1;
  }
  const avgGap = gapCount ? totalGap / gapCount : 999;
  const totalDuration = times[times.length - 1] - times[0];

  if (scannerBufferMeta.repeatedRun >= 4) return false;
  if (scannerBufferMeta.manualInvalid) return false;
  if (avgGap > 55) return false;
  if (totalDuration > 500) return false;

  return true;
}

function queueScannerValidateAndSubmit() {
  const scannerInput = document.getElementById('scannerInput');
  clearTimeout(scannerSubmitTimer);
  scannerSubmitTimer = setTimeout(async () => {
    if (!scannerInput?.value) {
      resetScannerMeta();
      return;
    }
    if (!scannerLooksValid()) {
      if (scannerInput) scannerInput.value = '';
      resetScannerMeta();
      return;
    }
    await submitScannerRecord(scannerInput.value);
  }, 90);
}

function formatTimestampFileName(index) {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_${index}.jpg`;
}

function roleLabel(role) {
  if (role === 'admin') return 'admin';
  if (role === 'receiver') return 'receiver';
  if (role === 'all') return 'everyone';
  return 'sender';
}
