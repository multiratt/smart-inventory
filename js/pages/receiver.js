    export async function initReceiver() {
      let receiverEventSource = null;

      function connectReceiverSSE() {
        if (receiverEventSource) receiverEventSource.close();
        const token = localStorage.getItem('receiver_token') || '';
        receiverEventSource = new EventSource('/api/events?token=' + encodeURIComponent(token));
        receiverEventSource.onmessage = (e) => {
          try {
            const event = JSON.parse(e.data);
            if (['record_created', 'record_updated', 'record_deleted'].includes(event.type)) {
              if (typeof loadPendingRecords === 'function') loadPendingRecords(true);
              if (typeof loadCompletedRecords === 'function') loadCompletedRecords(true);
            }
          } catch(err) {}
        };
        receiverEventSource.onerror = () => {
          receiverEventSource.close();
          setTimeout(connectReceiverSSE, 5000);
        };
      }

      app.innerHTML = `
        <header>
          <div class="header-inner">
            <div class="header-left">
              <div class="brand">Smart Inventory <span id="receiverBrandSyncDot" class="brand-status-dot" title="Last sync: -"></span></div>
            </div>
            <div class="header-center"></div>
            <div class="header-right">
              <button id="goSenderBtn" class="icon-btn" title="Go sender">📤</button>
              <button id="receiverUserMenuBtn" class="user-menu-btn" title="Profile">👤</button>
              ${isAdminReceiver() ? `<button id="dashboardBtn" class="icon-btn" title="Dashboard Overview">📊</button>` : ''}
              ${isAdminReceiver() ? `<button id="mobileAccessBtn" class="icon-btn" title="QR Codes Access">📱</button>` : ''}
              ${isAdminReceiver() ? `<button id="exportAllBtn" class="icon-btn" title="Export complete records">⬇️</button>` : ''}
              ${renderThemeButton()}
              ${isAdminReceiver() ? `<button id="cleanDbBtn" class="icon-btn" title="Export Complete and Clean">🗑️</button>` : ''}
            </div>
          </div>
        </header>


        <div class="container">
          <div class="receiver-page-head">
            <div class="page-title">Inventory Check - Receiver</div>
          </div>


          <div class="card" style="margin-bottom:16px;">
            <div class="team-title-row">
              <h2 class="section-title" style="margin:0;">Team</h2>
            </div>
            <div id="teamListInline" class="team-list"></div>
          </div>


          <div class="card" style="margin-bottom:16px;">
            <h2 id="incomingRecordsTitle" class="section-title">Pending Review (0)</h2>
            <div class="search-grid" style="margin-bottom:12px;">
              <input id="pendingSearchInput" type="search" placeholder="Search pending records..." />
              <div class="search-right">
                <select id="pendingTypeFilter" class="small-select">
                  <option value="all">All Types</option>
                  <option value="photo">Photo</option>
                  <option value="scanner">Scanner</option>
                </select>
              </div>
            </div>
            <div id="receiverList" class="record-list"></div>
            <div id="pendingPaginationWrap"></div>
          </div>


          <div id="completeRecordsCard" class="card" style="margin-top:16px;">
            <button id="toggleCompleteRecordsBtn" class="collapsible-toggle" type="button">
              <span id="completeRecordsTitle" class="section-title" style="margin:0;">Complete Records (0)</span>
              <span class="collapse-icon">▲</span>
            </button>
            <div class="collapsible-body">
              <div class="search-grid" style="margin-bottom:12px;">
                <input id="completedSearchInput" type="search" placeholder="Search completed records..." />
                <div class="search-right">
                  <select id="completedTypeFilter" class="small-select">
                    <option value="all">All Types</option>
                    <option value="photo">Photo</option>
                    <option value="scanner">Scanner</option>
                  </select>
                </div>
              </div>
              <div id="completeRecordsList" class="record-list"></div>
              <div id="completedPaginationWrap"></div>
            </div>
          </div>


          ${isAdminReceiver() ? `
          <div id="activityLogCard" class="card collapsed" style="margin-top:16px;">
            <button id="toggleActivityLogBtn" class="collapsible-toggle" type="button">
              <span id="activityLogTitle" class="section-title" style="margin:0;">Activity Log</span>
              <span class="collapse-icon">▼</span>
            </button>
            <div class="collapsible-body">
              <div class="search-grid" style="margin-bottom:12px;">
                <input id="activityLogSearchInput" type="search" placeholder="Search activity log..." />
                <div class="search-right">
                  <select id="activityLogActionFilter" class="small-select">
                    <option value="">All Actions</option>
                    <option value="submitted">Submitted</option>
                    <option value="review-claimed">Review Claimed</option>
                    <option value="review-released">Review Released</option>
                    <option value="ocr-selected">OCR Selected</option>
                    <option value="edited">Edited</option>
                    <option value="completed">Completed</option>
                    <option value="reverted">Reverted</option>
                    <option value="exported">Exported</option>
                    <option value="deleted">Deleted</option>
                  </select>
                  <select id="activityLogTypeFilter" class="small-select">
                    <option value="all">All Types</option>
                    <option value="photo">Photo</option>
                    <option value="scanner">Scanner</option>
                  </select>
                </div>
              </div>
              <div id="logWrap"></div>
              <div id="activityLogPaginationWrap"></div>
            </div>
          </div>


          <div id="userLogCard" class="card collapsed" style="margin-top:16px;">
            <button id="toggleUserLogBtn" class="collapsible-toggle" type="button">
              <span id="userLogTitle" class="section-title" style="margin:0;">User Log</span>
              <span class="collapse-icon">▼</span>
            </button>
            <div class="collapsible-body">
              <div class="search-grid" style="margin-bottom:12px;">
                <input id="userLogSearchInput" type="search" placeholder="Search user log..." />
                <div class="search-right">
                  <select id="userLogTypeFilter" class="small-select">
                    <option value="">All Actions</option>
                    <option value="user-login">Login</option>
                    <option value="user-logout">Logout</option>
                    <option value="user-rename">Rename</option>
                    <option value="user-rename-request">Rename Request</option>
                    <option value="user-rename-accepted">Rename Accepted</option>
                    <option value="user-rename-denied">Rename Denied</option>
                    <option value="user-deleted">User Deleted</option>
                    <option value="team-message">Team Message</option>
                    <option value="team-wait">Wait</option>
                    <option value="team-go-ahead">Go Ahead</option>
                  </select>
                  <select id="userLogRoleFilter" class="small-select">
                    <option value="">All Roles</option>
                    <option value="sender">Sender</option>
                    <option value="receiver">Receiver</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              <div id="userLogWrap"></div>
              <div id="userLogPaginationWrap"></div>
            </div>
          </div>
          ` : ''}
        </div>


        <div id="receiverNameRequiredModal" class="modal">
          <div class="modal-panel" style="max-width:520px;">
            <div class="section-title" style="margin:0;">Set ${isAdminReceiver() ? 'Admin' : 'User'} Name</div>
            <div class="sub" id="receiverNameRequiredSub">Please set your username before using this page.</div>
            <div class="col" style="margin-top:12px;">
              <input id="receiverNameRequiredInput" type="text" placeholder="Enter username" />
              <div class="row">
                <button id="saveReceiverRequiredNameBtn" class="success">Continue</button>
              </div>
            </div>
          </div>
        </div>


        <div id="receiverRenameModal" class="modal">
          <div class="modal-panel" style="max-width:520px;">
            <div class="modal-head">
              <div><div class="section-title" style="margin:0;">Profile</div></div>
              <button id="closeReceiverRenameModalBtn" class="danger">Close</button>
            </div>
            <div class="col">
              <div id="receiverRenameCurrentName" class="name-badge"></div>
              <input id="receiverRenameInput" type="text" placeholder="${isAdminReceiver() ? 'Change admin name' : 'Request new name'}" />
              <div class="row"><button id="requestReceiverRenameBtn" class="primary">${isAdminReceiver() ? 'Save Name' : 'Request Rename'}</button></div>
            </div>
          </div>
        </div>


        <div id="receiverRenameWaitingModal" class="modal">
          <div class="modal-panel" style="max-width:520px;">
            <div class="waiting-lock-screen">
              <div class="title">Waiting for Admin Review</div>
              <div class="desc">Your rename request has been sent. Please wait while the admin reviews your request.</div>
            </div>
          </div>
        </div>


        <div id="receiverRenameDecisionModal" class="modal">
          <div class="modal-panel" style="max-width:520px;">
            <div class="section-title" style="margin:0;">Rename Result</div>
            <div id="receiverRenameDecisionText" class="mobile-alert-text"></div>
            <div class="row center">
              <button id="receiverRenameDecisionOkBtn" class="success">OK</button>
            </div>
          </div>
        </div>


        <div id="adminRenamePopupModal" class="modal">
          <div class="modal-panel" style="max-width:560px;">
            <div class="section-title" style="margin:0;">Rename Request</div>
            <div id="adminRenamePopupText" class="mobile-alert-text"></div>
            <div class="row center">
              <button id="adminRenameAcceptBtn" class="success">Accept</button>
              <button id="adminRenameDenyBtn" class="danger">Deny</button>
            </div>
          </div>
        </div>


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


        ${isAdminReceiver() ? `
        <div id="exportConfirmModal" class="modal">
          <div class="modal-panel" style="max-width:480px;">
            <div class="section-title" style="margin:0;">Export Complete Records</div>
            <div class="sub">Export will include summary, activity log, and user log.</div>
            <div class="col" style="margin-top:12px;">
              <div class="meta-line">Export complete records only?</div>
              <div class="row">
                <button id="confirmExportBtn" class="primary">Confirm Export</button>
                <button id="cancelExportBtn">Cancel</button>
              </div>
            </div>
          </div>
        </div>
        ` : ''}


        ${isAdminReceiver() ? `
        <div id="cleanConfirmModal" class="modal">
          <div class="modal-panel" style="max-width:520px;">
            <div class="section-title" style="margin:0;">Export Complete and Clean</div>
            <div class="sub">All data will be exported and then removed.</div>
            <div class="col" style="margin-top:12px;">
              <div class="meta-line">All data will be removed after export.</div>
              <div class="row">
                <button id="exportAndCleanBtn" class="danger">Export Complete and Clean</button>
                <button id="cancelCleanBtn">Cancel</button>
              </div>
            </div>
          </div>
        </div>
        ` : ''}


        <div id="deleteConfirmModal" class="modal">
          <div class="modal-panel" style="max-width:460px;">
            <div class="section-title" style="margin:0;">Confirm Delete</div>
            <div class="col" style="margin-top:12px;">
              <div class="meta-line" id="deleteConfirmText">Are you sure?</div>
              <div class="row">
                <button id="confirmDeleteBtn" class="danger">Delete</button>
                <button id="cancelDeleteBtn">Cancel</button>
              </div>
            </div>
          </div>
        </div>


        <div id="deleteUserConfirmModal" class="modal">
          <div class="modal-panel" style="max-width:460px;">
            <div class="section-title" style="margin:0;">Delete User</div>
            <div class="col" style="margin-top:12px;">
              <div class="meta-line" id="deleteUserConfirmText">Are you sure?</div>
              <div class="row">
                <button id="confirmDeleteUserBtn" class="danger">Delete User</button>
                <button id="cancelDeleteUserBtn">Cancel</button>
              </div>
            </div>
          </div>
        </div>


        <div id="revertConfirmModal" class="modal">
          <div class="modal-panel" style="max-width:460px;">
            <div class="section-title" style="margin:0;">Confirm Revert</div>
            <div class="col" style="margin-top:12px;">
              <div class="meta-line">Are you sure you want to revert this record?</div>
              <div class="row">
                <button id="confirmRevertBtn" class="warn">Revert</button>
                <button id="cancelRevertBtn">Cancel</button>
              </div>
            </div>
          </div>
        </div>


        ${isAdminReceiver() ? `
        <div id="mobileQrModal" class="modal">
          <div class="modal-panel" style="max-width:1200px;width:100%;">
            <div class="modal-head">
              <div>
                <div class="section-title" style="margin:0;">QR Codes Access</div>
                <div class="sub">Receiver / Sender / Dashboard Read Only QR and URL by network interface.</div>
              </div>
              <button id="closeMobileQrModalBtn" class="danger">Close</button>
            </div>
            <div id="mobileQrList" class="card" style="box-shadow:none;"></div>
          </div>
        </div>
        ` : ''}


        <div id="teamMessageModal" class="modal">
          <div class="modal-panel" style="max-width:560px;">
            <div class="modal-head">
              <div>
                <div class="section-title" style="margin:0;">Send Message</div>
                <div id="teamTargetText" class="sub"></div>
              </div>
              <div class="row">
                <button id="deleteTargetUserBtn" class="danger hidden">Delete User</button>
                <button id="closeTeamMessageModalBtn" class="danger">Close</button>
              </div>
            </div>
            <div id="teamQuickButtonsWrap" class="col"></div>
            <div class="col" style="margin-top:10px;">
              <textarea id="freeTeamMessage" placeholder="Type message"></textarea>
              <button id="sendFreeTeamMessageBtn" class="primary">Send Message</button>
            </div>
          </div>
        </div>


        <div id="receiverAlertModal" class="modal">
          <div class="modal-panel" style="max-width:520px;">
            <div class="section-title" style="margin:0;">Message</div>
            <div id="receiverAlertFrom" class="mobile-alert-from"></div>
            <div id="receiverAlertText" class="mobile-alert-text"></div>
            <div class="row center">
              <button id="receiverAlertReplyBtn" class="primary">Reply</button>
              <button id="receiverAlertOkBtn" class="success">OK</button>
            </div>
          </div>
        </div>


        <div id="imagePreviewModal" class="image-preview-modal">
          <div class="image-preview-panel">
            <div class="modal-head">
              <div class="section-title" style="margin:0;">Large Image Preview</div>
              <button id="closeImagePreviewBtn" class="danger">Close</button>
            </div>
            <img id="largePreviewImage" src="" alt="">
          </div>
        </div>
      `;


      bindThemeButtons();


      const receiverBrandSyncDot = document.getElementById('receiverBrandSyncDot');
      const goSenderBtn = document.getElementById('goSenderBtn');
      const receiverUserMenuBtn = document.getElementById('receiverUserMenuBtn');
      const dashboardBtn = document.getElementById('dashboardBtn');
      const mobileAccessBtn = document.getElementById('mobileAccessBtn');
      const exportAllBtn = document.getElementById('exportAllBtn');
      const cleanDbBtn = document.getElementById('cleanDbBtn');
      const teamListInline = document.getElementById('teamListInline');


      const incomingRecordsTitle = document.getElementById('incomingRecordsTitle');
      const completeRecordsTitle = document.getElementById('completeRecordsTitle');
      const activityLogTitle = document.getElementById('activityLogTitle');
      const userLogTitle = document.getElementById('userLogTitle');


      const receiverList = document.getElementById('receiverList');
      const completeRecordsList = document.getElementById('completeRecordsList');
      const pendingPaginationWrap = document.getElementById('pendingPaginationWrap');
      const completedPaginationWrap = document.getElementById('completedPaginationWrap');


      const pendingSearchInput = document.getElementById('pendingSearchInput');
      const pendingTypeFilter = document.getElementById('pendingTypeFilter');
      const completedSearchInput = document.getElementById('completedSearchInput');
      const completedTypeFilter = document.getElementById('completedTypeFilter');


      const toggleCompleteRecordsBtn = document.getElementById('toggleCompleteRecordsBtn');
      const toggleActivityLogBtn = document.getElementById('toggleActivityLogBtn');
      const toggleUserLogBtn = document.getElementById('toggleUserLogBtn');
      const completeRecordsCard = document.getElementById('completeRecordsCard');
      const activityLogCard = document.getElementById('activityLogCard');
      const userLogCard = document.getElementById('userLogCard');


      const logWrap = document.getElementById('logWrap');
      const userLogWrap = document.getElementById('userLogWrap');
      const activityLogPaginationWrap = document.getElementById('activityLogPaginationWrap');
      const userLogPaginationWrap = document.getElementById('userLogPaginationWrap');
      const activityLogSearchInput = document.getElementById('activityLogSearchInput');
      const activityLogActionFilter = document.getElementById('activityLogActionFilter');
      const activityLogTypeFilter = document.getElementById('activityLogTypeFilter');
      const userLogSearchInput = document.getElementById('userLogSearchInput');
      const userLogTypeFilter = document.getElementById('userLogTypeFilter');
      const userLogRoleFilter = document.getElementById('userLogRoleFilter');


      const receiverNameRequiredModal = document.getElementById('receiverNameRequiredModal');
      const receiverNameRequiredInput = document.getElementById('receiverNameRequiredInput');
      const receiverNameRequiredSub = document.getElementById('receiverNameRequiredSub');
      const saveReceiverRequiredNameBtn = document.getElementById('saveReceiverRequiredNameBtn');


      const receiverRenameModal = document.getElementById('receiverRenameModal');
      const receiverRenameCurrentName = document.getElementById('receiverRenameCurrentName');
      const receiverRenameInput = document.getElementById('receiverRenameInput');
      const requestReceiverRenameBtn = document.getElementById('requestReceiverRenameBtn');
      const closeReceiverRenameModalBtn = document.getElementById('closeReceiverRenameModalBtn');


      const receiverRenameWaitingModal = document.getElementById('receiverRenameWaitingModal');
      const receiverRenameDecisionModal = document.getElementById('receiverRenameDecisionModal');
      const receiverRenameDecisionText = document.getElementById('receiverRenameDecisionText');
      const receiverRenameDecisionOkBtn = document.getElementById('receiverRenameDecisionOkBtn');


      const adminRenamePopupModal = document.getElementById('adminRenamePopupModal');
      const adminRenamePopupText = document.getElementById('adminRenamePopupText');
      const adminRenameAcceptBtn = document.getElementById('adminRenameAcceptBtn');
      const adminRenameDenyBtn = document.getElementById('adminRenameDenyBtn');


      const detailModal = document.getElementById('detailModal');
      const closeModalBtn = document.getElementById('closeModalBtn');
      const deleteRecordBtn = document.getElementById('deleteRecordBtn');
      const modalMeta = document.getElementById('modalMeta');
      const modalImagePick = document.getElementById('modalImagePick');
      const scanModeSelect = document.getElementById('scanModeSelect');
      const scanBtn = document.getElementById('scanBtn');
      const modalCandidates = document.getElementById('modalCandidates');
      const modalSelected = document.getElementById('modalSelected');
      const selectedTextEditor = document.getElementById('selectedTextEditor');
      const selectedCommentEditor = document.getElementById('selectedCommentEditor');
      const saveSelectedTextBtn = document.getElementById('saveSelectedTextBtn');
      const editBox = document.getElementById('editBox');
      const overrideInfo = document.getElementById('overrideInfo');
      const resultSearchInput = document.getElementById('resultSearchInput');
      const resultCountInfo = document.getElementById('resultCountInfo');
      const resultCompletedInfo = document.getElementById('resultCompletedInfo');
      const photoDetailLayout = document.getElementById('photoDetailLayout');
      const scannerDetailLayout = document.getElementById('scannerDetailLayout');
      const scannerDetailText = document.getElementById('scannerDetailText');
      const scannerSelectedTextEditor = document.getElementById('scannerSelectedTextEditor');
      const scannerCommentEditor = document.getElementById('scannerCommentEditor');
      const scannerSaveSelectedTextBtn = document.getElementById('scannerSaveSelectedTextBtn');
      const lockInfo = document.getElementById('lockInfo');
      const recordReadonlyNote = document.getElementById('recordReadonlyNote');
      const scannerReadonlyNote = document.getElementById('scannerReadonlyNote');


      const deleteConfirmModal = document.getElementById('deleteConfirmModal');
      const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
      const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
      const deleteConfirmText = document.getElementById('deleteConfirmText');


      const deleteUserConfirmModal = document.getElementById('deleteUserConfirmModal');
      const confirmDeleteUserBtn = document.getElementById('confirmDeleteUserBtn');
      const cancelDeleteUserBtn = document.getElementById('cancelDeleteUserBtn');
      const deleteUserConfirmText = document.getElementById('deleteUserConfirmText');


      const revertConfirmModal = document.getElementById('revertConfirmModal');
      const confirmRevertBtn = document.getElementById('confirmRevertBtn');
      const cancelRevertBtn = document.getElementById('cancelRevertBtn');


      const mobileQrModal = document.getElementById('mobileQrModal');
      const closeMobileQrModalBtn = document.getElementById('closeMobileQrModalBtn');
      const mobileQrList = document.getElementById('mobileQrList');


      const exportConfirmModal = document.getElementById('exportConfirmModal');
      const confirmExportBtn = document.getElementById('confirmExportBtn');
      const cancelExportBtn = document.getElementById('cancelExportBtn');


      const cleanConfirmModal = document.getElementById('cleanConfirmModal');
      const exportAndCleanBtn = document.getElementById('exportAndCleanBtn');
      const cancelCleanBtn = document.getElementById('cancelCleanBtn');


      const teamMessageModal = document.getElementById('teamMessageModal');
      const teamTargetText = document.getElementById('teamTargetText');
      const closeTeamMessageModalBtn = document.getElementById('closeTeamMessageModalBtn');
      const deleteTargetUserBtn = document.getElementById('deleteTargetUserBtn');
      const freeTeamMessage = document.getElementById('freeTeamMessage');
      const sendFreeTeamMessageBtn = document.getElementById('sendFreeTeamMessageBtn');
      const teamQuickButtonsWrap = document.getElementById('teamQuickButtonsWrap');


      const receiverAlertModal = document.getElementById('receiverAlertModal');
      const receiverAlertFrom = document.getElementById('receiverAlertFrom');
      const receiverAlertText = document.getElementById('receiverAlertText');
      const receiverAlertReplyBtn = document.getElementById('receiverAlertReplyBtn');
      const receiverAlertOkBtn = document.getElementById('receiverAlertOkBtn');


      const imagePreviewModal = document.getElementById('imagePreviewModal');
      const closeImagePreviewBtn = document.getElementById('closeImagePreviewBtn');
      const largePreviewImage = document.getElementById('largePreviewImage');


      let activeTeamTarget = null;
      let lastReceiverAlertId = '';
      let lastReceiverAlertObj = null;
      let activeAdminRenameRequest = null;
      let receiverRenamePending = false;
      let receiverRenameDecisionShownId = '';
      let currentModalRecord = null;
      let currentSelectedImageIndex = 0;
      let selectedImageIndexForCurrentResult = null;
      let imageResultsByIndex = [];
      let scannedZeroResultImages = new Set();
      let pendingDataVersion = 0;
      let completedDataVersion = 0;
      let teamDataVersion = 0;
      let receiverSyncVersion = 0;
      let activityLogVersion = 0;
      let userLogVersion = 0;
      let receiverAlertLocked = false;
      let pendingLastQueryKey = '';
      let completedLastQueryKey = '';
      let activityLastQueryKey = '';
      let userLastQueryKey = '';
      let teamLastKey = '';


      const pendingState = { page:1, pageSize:20, total:0, totalPages:1, search:'', recordType:'all' };
      const completedState = { page:1, pageSize:20, total:0, totalPages:1, search:'', recordType:'all' };
      const activityLogState = { page:1, pageSize:50, total:0, totalPages:1, search:'', action:'', recordType:'all' };
      const userLogState = { page:1, pageSize:50, total:0, totalPages:1, search:'', type:'', role:'' };


      function preserveInputFocus(el) {
        if (document.activeElement !== el) return null;
        return { start: el.selectionStart || 0, end: el.selectionEnd || 0 };
      }
      function restoreInputFocus(el, state) {
        if (!el || !state) return;
        el.focus();
        try { el.setSelectionRange(state.start, state.end); } catch {}
      }


      async function updateReceiverSyncDot() {
        try {
          const json = await fetchJson('/api/sync-status');
          if (json.version !== receiverSyncVersion || !receiverBrandSyncDot.title) {
            receiverSyncVersion = json.version;
            receiverBrandSyncDot.style.background = json.status === 'done' ? 'var(--success)' : 'var(--danger)';
            receiverBrandSyncDot.title = json.lastSyncTime ? `Last sync: ${formatDateTime(json.lastSyncTime)}` : 'Last sync: -';
          }
        } catch {}
      }


      async function validateUniqueReceiverName(rawName) {
        const raw = String(rawName || '').trim();
        if (!raw || !hasStrictUserName(raw)) {
          showToast('Username must contain English letters only.', 'warn');
          return null;
        }
        const normalized = normalizeStrictUserName(raw);
        const json = await fetchJson('/api/check-receiver-name?name=' + encodeURIComponent(normalized) + '&receiverId=' + encodeURIComponent(getReceiverId()) + '&deviceId=' + encodeURIComponent(getUnifiedClientId()) + '&mode=' + encodeURIComponent(isAdminReceiver() ? 'admin' : 'receiver'));


        if (!json.valid) {
          showToast('Username must contain English letters only.', 'warn');
          return null;
        }
        if (json.duplicate) {
          showToast(`The receiver name "${normalized}" is already used in the system.`, 'warn');
          return null;
        }
        return json.normalized || normalized;
      }


      async function saveReceiverNameDirect(rawName, modeOverride = '') {
        const resolvedName = await validateUniqueReceiverName(rawName);
        if (!resolvedName) return false;


        const json = await fetchJson('/api/set-receiver-name', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            receiverId:getReceiverId(),
            deviceId:getUnifiedClientId(),
            receiverName:resolvedName,
            isAdmin:isAdminReceiver(),
            mode: modeOverride || (isAdminReceiver() ? 'admin' : 'receiver'),
            fingerprint:getFingerprint()
          })
        });


        setGlobalUserName(json.normalized || resolvedName);
        refreshReceiverProfileBadge();
        return true;
      }


      function refreshReceiverProfileBadge() {
        receiverRenameCurrentName.innerHTML = `<span>${escapeHtml(getGlobalUserName() || '-')}</span>`;
      }


      async function receiverHeartbeat() {
        const receiverName = getGlobalUserName();
        try {
          const res = await fetch('/api/receiver-heartbeat', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              receiverId:getReceiverId(),
              deviceId:getUnifiedClientId(),
              receiverName,
              isAdmin:isAdminReceiver(),
              mode:isAdminReceiver() ? 'admin' : 'receiver',
              cleanGeneration:getCleanGeneration(),
              fingerprint:getFingerprint()
            })
          });
          const json = await res.json();


          if (typeof json.cleanGeneration !== 'undefined' && Number(json.cleanGeneration) !== getCleanGeneration()) {
            setCleanGeneration(json.cleanGeneration);
            resetAllLocalSessions();
            window.location.reload();
            return;
          }


          if (!receiverName && json.rememberedName) {
            setGlobalUserName(json.rememberedName);
            refreshReceiverProfileBadge();
            pendingDataVersion = 0;
            completedDataVersion = 0;
            await loadPendingRecords(true);
            await loadCompletedRecords(true);
          }


          if (json.deletedByAdmin) {
            clearGlobalUserName();
            receiverNameRequiredSub.textContent = 'This user was deleted by admin or the database was cleaned. Please set a name again.';
            receiverNameRequiredModal.classList.add('show');
            refreshModalOpenState();
          }
        } catch {}
      }


      function setCollapseState(cardEl, collapsed) {
        if (!cardEl) return;
        cardEl.classList.toggle('collapsed', collapsed);
        const icon = cardEl.querySelector('.collapse-icon');
        if (icon) icon.textContent = collapsed ? '▼' : '▲';
      }
      setCollapseState(completeRecordsCard, false);
      setCollapseState(activityLogCard, true);
      setCollapseState(userLogCard, true);


      if (toggleCompleteRecordsBtn) toggleCompleteRecordsBtn.onclick = () => setCollapseState(completeRecordsCard, !completeRecordsCard.classList.contains('collapsed'));
      if (toggleActivityLogBtn) toggleActivityLogBtn.onclick = () => setCollapseState(activityLogCard, !activityLogCard.classList.contains('collapsed'));
      if (toggleUserLogBtn) toggleUserLogBtn.onclick = () => setCollapseState(userLogCard, !userLogCard.classList.contains('collapsed'));


      async function loadTeamUsers(force = false) {
        try {
          const data = await fetchJson('/api/active-senders');
          const users = Array.isArray(data.senders) ? data.senders : [];
          const renderKey = JSON.stringify(users.map(s => ({
            id:s.id, receiverId:s.receiverId, name:s.name, role:s.role, online:s.online, waiting:s.waiting
          })));


          if (!force && data.version === teamDataVersion && teamLastKey === renderKey) return users;
          teamDataVersion = data.version || 0;
          teamLastKey = renderKey;


          if (!users.length) {
            teamListInline.innerHTML = `<div class="empty">No active users.</div>`;
            return users;
          }


          const selfName = getGlobalUserName();
          const selfRole = isAdminReceiver() ? 'admin' : 'receiver';


          teamListInline.innerHTML = users.map(s => {
            const isSelf = normalizeStrictUserName(s.name || '') === selfName && s.role === selfRole;
            const pauseResumeBtn = isAdminReceiver() && !isSelf && s.role !== 'admin' ? (
              s.paused
                ? `<button class="resume-btn" data-resume-user="${s.id}" title="Resume user">Resume</button>`
                : `<button class="pause-btn" data-pause-user="${s.id}" title="Pause user">Pause</button>`
            ) : '';
            return `
              <button class="team-user-btn" data-user='${encodeURIComponent(JSON.stringify(s))}'>
                <span class="status-dot ${s.online ? 'status-green' : 'status-red'}"></span>
                ${roleEmojiHtml(s.role)}
                <span>${escapeHtml(s.name)}${isSelf ? ' (you)' : ''}</span>
                ${s.waiting ? '<span class="pill pending wait-small">WAIT</span>' : ''}
                ${s.paused ? '<span class="pill deleted" style="font-size:10px;padding:2px 6px;">PAUSED</span>' : ''}
                ${pauseResumeBtn}
              </button>
            `;
          }).join('');


          teamListInline.querySelectorAll('[data-user]').forEach(btn => {
            btn.onclick = () => {
              const raw = decodeURIComponent(btn.getAttribute('data-user') || '');
              const parsed = JSON.parse(raw);


              if (!isAdminReceiver() && parsed.role === 'receiver' && parsed.name === getGlobalUserName()) {
                showToast('You are receiver', 'warn');
                return;
              }


              if (parsed.role === 'admin') {
                activeTeamTarget = { id:'all', receiverId:'', name:'Everyone', role:'all' };
                teamTargetText.textContent = 'Send message to everyone';
                renderTeamQuickButtons();
                renderDeleteUserButton();
                freeTeamMessage.value = '';
                teamMessageModal.classList.add('show');
                refreshModalOpenState();
                return;
              }


              activeTeamTarget = parsed;
              const selfNameNow = getGlobalUserName();
              const selfRoleNow = isAdminReceiver() ? 'admin' : 'receiver';
              if (activeTeamTarget.name === selfNameNow && activeTeamTarget.role === selfRoleNow) {
                if (!isAdminReceiver()) {
                  showToast('You are receiver', 'warn');
                }
                return;
              }


              teamTargetText.textContent = `Send message to ${activeTeamTarget.name}`;
              renderTeamQuickButtons();
              renderDeleteUserButton();
              freeTeamMessage.value = '';
              teamMessageModal.classList.add('show');
              refreshModalOpenState();
            };
          });


          teamListInline.querySelectorAll('[data-pause-user]').forEach(btn => {
            btn.onclick = async (e) => {
              e.stopPropagation();
              const userId = btn.getAttribute('data-pause-user');
              if (!confirm('Pause this user? They will see a waiting screen.')) return;
              try {
                await fetchJson('/api/users/' + encodeURIComponent(userId) + '/pause', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({})
                });
                showToast('User paused', 'success');
                await loadTeamUsers(true);
              } catch (err) {
                showToast('Pause failed: ' + err.message, 'danger');
              }
            };
          });

          teamListInline.querySelectorAll('[data-resume-user]').forEach(btn => {
            btn.onclick = async (e) => {
              e.stopPropagation();
              const userId = btn.getAttribute('data-resume-user');
              try {
                await fetchJson('/api/users/' + encodeURIComponent(userId) + '/resume', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({})
                });
                showToast('User resumed', 'success');
                await loadTeamUsers(true);
              } catch (err) {
                showToast('Resume failed: ' + err.message, 'danger');
              }
            };
          });


          return users;
        } catch (e) {
          teamListInline.innerHTML = `<div class="empty">Failed to load team: ${escapeHtml(e.message)}</div>`;
          return [];
        }
      }


      function renderDeleteUserButton() {
        if (!deleteTargetUserBtn) return;
        const canShow = !!(
          isAdminReceiver() &&
          activeTeamTarget &&
          activeTeamTarget.role !== 'all' &&
          activeTeamTarget.role !== 'all-receivers' &&
          !(activeTeamTarget.role === 'admin' && (activeTeamTarget.receiverId || activeTeamTarget.id) === ADMIN_RECEIVER_ID)
        );
        deleteTargetUserBtn.classList.toggle('hidden', !canShow);
      }


      function renderTeamQuickButtons() {
        if (!teamQuickButtonsWrap) return;
        teamQuickButtonsWrap.innerHTML = '';


        const selfRole = isAdminReceiver() ? 'admin' : 'receiver';
        if (!activeTeamTarget) return;


        const targetIsAll = activeTeamTarget.role === 'all';
        const canUseWait = (
          !targetIsAll &&
          (
            (selfRole === 'admin' && (activeTeamTarget.role === 'sender' || activeTeamTarget.role === 'receiver' || activeTeamTarget.role === 'admin')) ||
            (selfRole === 'receiver' && activeTeamTarget.role === 'sender')
          )
        );


        if (canUseWait) {
          const isWaiting = !!activeTeamTarget.waiting;
          teamQuickButtonsWrap.innerHTML = `
            <button id="teamWaitBtn" class="${isWaiting ? 'success' : 'primary'}" type="button">
              ${isWaiting ? 'Go Ahead' : 'Wait'}
            </button>
          `;
          const teamWaitBtn = document.getElementById('teamWaitBtn');
          if (teamWaitBtn) teamWaitBtn.onclick = () => sendTeamMessage(isWaiting ? 'go ahead' : 'wait');
        }
      }


      async function checkAdminRenamePopup() {
        if (!isAdminReceiver()) return;
        if (adminRenamePopupModal.classList.contains('show')) return;


        try {
          const json = await fetchJson('/api/admin-rename-requests?requesterRole=admin&requesterId=' + encodeURIComponent(getReceiverId()));
          const items = Array.isArray(json.items) ? json.items : [];
          if (!items.length) return;


          activeAdminRenameRequest = items[0];
          adminRenamePopupText.textContent = `${activeAdminRenameRequest.currentName} requests rename to ${activeAdminRenameRequest.requestedName}`;
          adminRenamePopupModal.classList.add('show');
          refreshModalOpenState();
        } catch {}
      }


      async function handleAdminRenameDecision(decision) {
        if (!activeAdminRenameRequest) return;
        try {
          await fetchJson('/api/admin-rename-decision', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              requesterRole:'admin',
              requesterId:getReceiverId(),
              adminName:getGlobalUserName(),
              requestId:activeAdminRenameRequest.id,
              decision
            })
          });


          activeAdminRenameRequest = null;
          adminRenamePopupModal.classList.remove('show');
          refreshModalOpenState();
          teamDataVersion = 0;
          userLogVersion = 0;
          await loadTeamUsers(true);
          await loadUserLogs(true);
        } catch (e) {
          showToast('Rename decision failed: ' + e.message, 'danger');
        }
      }


      async function checkReceiverRenameStatus() {
        const receiverName = getGlobalUserName();
        if (!receiverName || isAdminReceiver()) return;
        try {
          const json = await fetchJson('/api/rename-request-status?requesterRole=receiver&requesterId=' + encodeURIComponent(getUnifiedClientId()));


          if (json.pending) {
            receiverRenamePending = true;
            receiverRenameWaitingModal.classList.add('show');
            refreshModalOpenState();
            return;
          }


          receiverRenamePending = false;
          receiverRenameWaitingModal.classList.remove('show');


          if (json.decision && receiverRenameDecisionShownId !== json.decision.requestId) {
            receiverRenameDecisionShownId = json.decision.requestId;
            if (json.decision.decision === 'accept' && json.decision.newName) setGlobalUserName(json.decision.newName);
            refreshReceiverProfileBadge();
            receiverRenameDecisionText.textContent = json.decision.message || 'Rename result.';
            receiverRenameDecisionModal.classList.add('show');
            refreshModalOpenState();
          }
        } catch {}
      }


      async function checkReceiverAlert() {
        try {
          const receiverName = getGlobalUserName();
          if (!receiverName) return;
          const json = await fetchJson('/api/receiver-alert?receiverId=' + encodeURIComponent(getReceiverId()) + '&receiverName=' + encodeURIComponent(receiverName));


          if (json.deletedByAdmin) {
            clearGlobalUserName();
            receiverNameRequiredSub.textContent = 'This user was deleted by admin or the database was cleaned. Please set a name again.';
            receiverNameRequiredModal.classList.add('show');
            refreshModalOpenState();
            return;
          }


          if (!json.alert || !json.alert.id) return;
          if (json.alert.id === lastReceiverAlertId) return;


          lastReceiverAlertId = json.alert.id;
          lastReceiverAlertObj = json.alert;


          if (json.alert.type === 'rename-request') {
            if (isAdminReceiver()) await checkAdminRenamePopup();
            return;
          }


          receiverAlertFrom.textContent = `From: ${json.alert.fromName || 'Unknown'} (${roleLabel(json.alert.fromRole || '-')})`;
          receiverAlertText.textContent = json.alert.message || '';


          const normalized = String(json.alert.message || '').trim().toLowerCase();
          const isBroadcast = !!json.alert.broadcast;


          if (normalized === 'wait') {
            receiverAlertLocked = true;
            receiverAlertReplyBtn.style.display = 'none';
            receiverAlertOkBtn.style.display = 'none';
          } else if (normalized === 'go ahead') {
            receiverAlertLocked = false;
            receiverAlertReplyBtn.style.display = 'none';
            receiverAlertOkBtn.style.display = 'inline-flex';
          } else if (isBroadcast) {
            receiverAlertLocked = false;
            receiverAlertReplyBtn.style.display = 'none';
            receiverAlertOkBtn.style.display = 'inline-flex';
          } else {
            receiverAlertLocked = false;
            receiverAlertReplyBtn.style.display = 'inline-flex';
            receiverAlertOkBtn.style.display = 'inline-flex';
          }


          receiverAlertModal.classList.add('show');
          refreshModalOpenState();
        } catch {}
      }


      receiverRenameDecisionOkBtn.onclick = async () => {
        receiverRenameDecisionModal.classList.remove('show');
        try {
          await fetchJson('/api/rename-decision-ack', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ requesterRole:'receiver', requesterId:getUnifiedClientId() })
          });
        } catch {}
        refreshModalOpenState();
      };


      adminRenameAcceptBtn.onclick = () => handleAdminRenameDecision('accept');
      adminRenameDenyBtn.onclick = () => handleAdminRenameDecision('deny');


      receiverAlertOkBtn.onclick = async () => {
        if (receiverAlertLocked) return;
        try {
          await fetchJson('/api/receiver-alert-ack', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ receiverId:getReceiverId(), alertId:lastReceiverAlertId })
          });
        } catch {}
        receiverAlertModal.classList.remove('show');
        refreshModalOpenState();
      };


      receiverAlertReplyBtn.onclick = () => {
        if (!lastReceiverAlertObj || receiverAlertLocked || lastReceiverAlertObj.broadcast) return;
        activeTeamTarget = {
          id:lastReceiverAlertObj.fromId,
          receiverId:lastReceiverAlertObj.fromId,
          name:lastReceiverAlertObj.fromName,
          role:lastReceiverAlertObj.fromRole
        };
        receiverAlertModal.classList.remove('show');
        teamTargetText.textContent = `Reply to ${activeTeamTarget.name}`;
        renderTeamQuickButtons();
        renderDeleteUserButton();
        teamMessageModal.classList.add('show');
        refreshModalOpenState();
      };


      async function sendTeamMessage(message) {
        if (!activeTeamTarget || !hasMeaningfulText(message)) return;
        try {
          await fetchJson('/api/team-message', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              fromRole:isAdminReceiver() ? 'admin' : 'receiver',
              fromId:getReceiverId(),
              fromName:getGlobalUserName(),
              targetRole:activeTeamTarget.role,
              targetId:activeTeamTarget.receiverId || activeTeamTarget.id,
              targetName:activeTeamTarget.name,
              message:normalizeFreeText(message)
            })
          });
          teamMessageModal.classList.remove('show');
          refreshModalOpenState();
          freeTeamMessage.value = '';
          teamDataVersion = 0;
          if (isAdminReceiver()) userLogVersion = 0;
          await loadTeamUsers(true);
          if (isAdminReceiver()) await loadUserLogs(true);
        } catch (e) {
          showToast('Send message failed: ' + e.message, 'danger');
        }
      }


      async function deleteSelectedUserByAdmin() {
        if (!isAdminReceiver() || !activeTeamTarget) return;
        try {
          await fetchJson('/api/delete-user', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              requesterRole:'admin',
              adminName:getGlobalUserName(),
              targetRole:activeTeamTarget.role,
              targetId:activeTeamTarget.receiverId || activeTeamTarget.id,
              targetName:activeTeamTarget.name
            })
          });
          deleteUserConfirmModal.classList.remove('show');
          teamMessageModal.classList.remove('show');
          refreshModalOpenState();
          teamDataVersion = 0;
          userLogVersion = 0;
          await loadTeamUsers(true);
          await loadUserLogs(true);
          showToast(`Deleted user ${activeTeamTarget.name}`, 'success');
          activeTeamTarget = null;
        } catch (e) {
          showToast('Delete user failed: ' + e.message, 'danger');
        }
      }


      sendFreeTeamMessageBtn.onclick = () => {
        const msg = normalizeFreeText(freeTeamMessage.value);
        if (!hasMeaningfulText(msg)) {
          showToast('Please type a message.', 'warn');
          return;
        }
        sendTeamMessage(msg);
      };


      if (closeTeamMessageModalBtn) {
        closeTeamMessageModalBtn.onclick = () => {
          teamMessageModal.classList.remove('show');
          refreshModalOpenState();
        };
      }


      if (deleteTargetUserBtn) {
        deleteTargetUserBtn.onclick = () => {
          if (!activeTeamTarget) return;
          deleteUserConfirmText.textContent = `Delete user "${activeTeamTarget.name}" ? This user will be forced to set a new name before using the system again.`;
          deleteUserConfirmModal.classList.add('show');
          refreshModalOpenState();
        };
      }
      if (cancelDeleteUserBtn) {
        cancelDeleteUserBtn.onclick = () => {
          deleteUserConfirmModal.classList.remove('show');
          refreshModalOpenState();
        };
      }
      if (confirmDeleteUserBtn) {
        confirmDeleteUserBtn.onclick = deleteSelectedUserByAdmin;
      }


      receiverUserMenuBtn.onclick = () => {
        receiverRenameInput.value = '';
        refreshReceiverProfileBadge();
        receiverRenameModal.classList.add('show');
        refreshModalOpenState();
      };
      closeReceiverRenameModalBtn.onclick = () => {
        if (receiverRenamePending && !isAdminReceiver()) return;
        receiverRenameModal.classList.remove('show');
        refreshModalOpenState();
      };


      requestReceiverRenameBtn.onclick = async () => {
        const currentName = getGlobalUserName();


        if (isAdminReceiver()) {
          try {
            const ok = await saveReceiverNameDirect(receiverRenameInput.value, 'admin');
            if (!ok) return;
            receiverRenameModal.classList.remove('show');
            refreshModalOpenState();
          } catch (e) {
            showToast(e.message, 'danger');
          }
          return;
        }


        const newName = await validateUniqueReceiverName(receiverRenameInput.value);
        if (!newName) return;
        if (newName === currentName) {
          showToast('New name must be different from current name.', 'warn');
          return;
        }


        try {
          await fetchJson('/api/rename-request', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              requesterRole:'receiver',
              requesterId:getUnifiedClientId(),
              currentName,
              requestedName:newName
            })
          });
          receiverRenamePending = true;
          receiverRenameWaitingModal.classList.add('show');
          receiverRenameModal.classList.remove('show');
          refreshModalOpenState();
        } catch (e) {
          showToast('Rename request failed: ' + e.message, 'danger');
        }
      };


      saveReceiverRequiredNameBtn.onclick = async () => {
        try {
          const ok = await saveReceiverNameDirect(receiverNameRequiredInput.value, isAdminReceiver() ? 'admin' : 'receiver');
          if (!ok) return;
          receiverNameRequiredModal.classList.remove('show');
          refreshModalOpenState();
          await receiverHeartbeat();
        } catch (e) {
          showToast(e.message, 'danger');
        }
      };


      function closeExportConfirmModal() {
        if (!exportConfirmModal) return;
        exportConfirmModal.classList.remove('show');
        refreshModalOpenState();
      }
      function triggerConfirmedExport() {
        window.location.href = `/api/export-complete-zip?requesterRole=admin`;
      }


      if (exportAllBtn) exportAllBtn.onclick = () => {
        exportConfirmModal.classList.add('show');
        refreshModalOpenState();
      };
      if (cancelExportBtn) cancelExportBtn.onclick = closeExportConfirmModal;
      if (confirmExportBtn) confirmExportBtn.onclick = () => {
        closeExportConfirmModal();
        triggerConfirmedExport();
      };


      if (dashboardBtn) dashboardBtn.onclick = () => { window.location.href = '/dashboard'; };
      goSenderBtn.onclick = () => { window.location.href = '/sender'; };


      if (cleanDbBtn) {
        cleanDbBtn.onclick = () => {
          cleanConfirmModal.classList.add('show');
          refreshModalOpenState();
        };
      }
      if (cancelCleanBtn) cancelCleanBtn.onclick = () => {
        cleanConfirmModal.classList.remove('show');
        refreshModalOpenState();
      };
      if (exportAndCleanBtn) {
        exportAndCleanBtn.onclick = async () => {
          triggerConfirmedExport();
          await new Promise(r => setTimeout(r, 600));
          try {
            const json = await fetchJson('/api/clean-database', {
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ requesterRole:'admin' })
            });
            setCleanGeneration(json.cleanGeneration);
            resetAllLocalSessions();
            window.location.reload();
          } catch (e) {
            showToast('Clean failed: ' + e.message, 'danger');
          }
        };
      }


      async function openMobileQrModal(forceOpen = true) {
        if (!isAdminReceiver() || !mobileQrModal || !mobileQrList) return false;
        try {
          const data = await fetchJson('/api/interfaces');
          const urls = Array.isArray(data.senderUrls) ? data.senderUrls : [];
          if (!urls.length) {
            mobileQrList.innerHTML = `<div class="empty">No interface detected.</div>`;
            if (forceOpen) {
              mobileQrModal.classList.add('show');
              refreshModalOpenState();
            }
            return false;
          }


          const cards = [];
          for (const item of urls) {
            cards.push({ title:`${item.label} - Sender`, url:item.senderUrl });
            cards.push({ title:`${item.label} - Receiver`, url:item.receiverUrl });
            cards.push({ title:`${item.label} - Dashboard (Read Only)`, url:item.dashboardUrl });
          }


          const cols = 3;
          mobileQrList.innerHTML = `<div id="qrGridWrap" style="display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:12px;"></div>`;
          const wrap = document.getElementById('qrGridWrap');


          for (const item of cards) {
            const box = document.createElement('div');
            box.className = 'card';
            box.style.boxShadow = 'none';
            box.style.display = 'flex';
            box.style.flexDirection = 'column';
            box.style.alignItems = 'center';
            box.style.justifyContent = 'flex-start';
            box.style.textAlign = 'center';
            box.innerHTML = `<div><strong>${escapeHtml(item.title)}</strong></div><div class="mini" style="margin-top:6px;">${escapeHtml(item.url)}</div>`;
            const canvas = document.createElement('canvas');
            canvas.style.display = 'block';
            canvas.style.margin = '12px auto 0';
            canvas.style.width = '180px';
            canvas.style.maxWidth = '100%';
            canvas.style.height = 'auto';


            const qrWrap = document.createElement('div');
            qrWrap.style.display = 'flex';
            qrWrap.style.justifyContent = 'center';
            qrWrap.style.alignItems = 'center';
            qrWrap.style.width = '100%';
            qrWrap.style.marginTop = '10px';
            qrWrap.appendChild(canvas);


            box.appendChild(qrWrap);
            wrap.appendChild(box);
            try { await QRCode.toCanvas(canvas, item.url, { width: 180, margin: 1 }); } catch {}
          }


          if (forceOpen) {
            mobileQrModal.classList.add('show');
            refreshModalOpenState();
          }
          return true;
        } catch (e) {
          mobileQrList.innerHTML = `<div class="empty">Failed to load URLs: ${escapeHtml(e.message)}</div>`;
          if (forceOpen) {
            mobileQrModal.classList.add('show');
            refreshModalOpenState();
          }
          return false;
        }
      }


      if (mobileAccessBtn) mobileAccessBtn.onclick = async () => { await openMobileQrModal(true); };
      if (closeMobileQrModalBtn) closeMobileQrModalBtn.onclick = () => {
        mobileQrModal.classList.remove('show');
        refreshModalOpenState();
      };


      function bindRecordCards(containerEl, sourceItems) {
        containerEl.querySelectorAll('[data-open-id]').forEach(card => {
          card.onclick = (e) => {
            if (e.target.closest('[data-preview-record]')) return;
            if (e.target.closest('[data-revert-id]')) return;
            const id = card.getAttribute('data-open-id');
            const item = sourceItems.find(x => x.id === id);
            if (item) openModal(item);
          };
        });

        containerEl.querySelectorAll('[data-preview-record]').forEach(btn => {
          btn.onclick = async (e) => {
            e.stopPropagation();
            const recordId = btn.getAttribute('data-preview-record');
            const idx = Number(btn.getAttribute('data-preview-image') || '0');
            const item = sourceItems.find(x => x.id === recordId);
            if (!item || !item.images || !item.images[idx]) return;
            largePreviewImage.src = item.images[idx].url;
            imagePreviewModal.classList.add('show');
            refreshModalOpenState();
          };
        });

        containerEl.querySelectorAll('[data-revert-id]').forEach(btn => {
          btn.onclick = async (e) => {
            e.stopPropagation();
            const recordId = btn.getAttribute('data-revert-id');
            if (!confirm('Revert this record to pending/review?')) return;
            try {
              await fetchJson('/api/records/' + encodeURIComponent(recordId) + '/revert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
              });
              await loadPendingRecords(true);
              await loadCompletedRecords(true);
            } catch (err) {
              showToast('Revert failed: ' + err.message, 'danger');
            }
          };
        });
      }
        const typeBadge = renderTypeBadge(item.recordType);
        const statusBadge = completed ? renderReviewedBadge(item) : '';
        const lockBadge = !completed && item.reviewLock ? `<div class="pill locked">Locked: ${escapeHtml(item.reviewLock.receiverName || 'Unknown')}</div>` : '';
        const ownBadge = item.ownRecordBlocked ? `<div class="pill deleted">Own Record</div>` : '';
        const addNewBadge = renderAddNewBadge(item.isAddNew);
        const foundBadge = renderFoundBadge(item);
        const revertBadge = completed && isAdminReceiver() ? `<button class="revert-btn warn" data-revert-id="${item.id}" title="Revert to Review">↩️ Revert</button>` : '';


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
                <div class="row badge-row">${typeBadge}${addNewBadge}${foundBadge}${statusBadge}${lockBadge}${ownBadge}${revertBadge}</div>
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
              <div class="row badge-row">${typeBadge}${addNewBadge}${foundBadge}${statusBadge}${lockBadge}${ownBadge}${revertBadge}</div>
            </div>
          </div>
        `;
      }


      async function loadPendingRecords(force = false) {
        try {
          const params = new URLSearchParams({
            page:String(pendingState.page),
            pageSize:String(pendingState.pageSize),
            status:'pending',
            search:pendingState.search,
            recordType:pendingState.recordType
          });
          const focusState = preserveInputFocus(pendingSearchInput);
          const data = await fetchJson('/api/records?' + params.toString());
          const queryKey = params.toString();


          if (!force && data.version === pendingDataVersion && pendingLastQueryKey === queryKey) return;


          pendingDataVersion = data.version || 0;
          pendingLastQueryKey = queryKey;
          pendingState.page = data.page || 1;
          pendingState.pageSize = data.pageSize || pendingState.pageSize;
          pendingState.total = data.total || 0;
          pendingState.totalPages = data.totalPages || 1;


          const items = Array.isArray(data.items) ? data.items : [];
          items.forEach(item => item.ownRecordBlocked = normalizeStrictUserName(item.senderName || '') === getGlobalUserName());


          incomingRecordsTitle.textContent = `Pending Review (${pendingState.total})`;
          receiverList.innerHTML = items.length ? items.map(item => renderReceiverCard(item, false)).join('') : `<div class="empty">No pending review records.</div>`;
          bindRecordCards(receiverList, items);


          pendingPaginationWrap.innerHTML = renderPaginationBar('pending', pendingState);
          bindPaginationBar('pending', pendingState, () => loadPendingRecords(true));
          restoreInputFocus(pendingSearchInput, focusState);
        } catch (e) {
          receiverList.innerHTML = `<div class="empty">Failed to load receiver list: ${escapeHtml(e.message)}</div>`;
        }
      }


      async function loadCompletedRecords(force = false) {
        try {
          const params = new URLSearchParams({
            page:String(completedState.page),
            pageSize:String(completedState.pageSize),
            status:'completed',
            search:completedState.search,
            recordType:completedState.recordType
          });
          const focusState = preserveInputFocus(completedSearchInput);
          const data = await fetchJson('/api/records?' + params.toString());
          const queryKey = params.toString();


          if (!force && data.version === completedDataVersion && completedLastQueryKey === queryKey) return;


          completedDataVersion = data.version || 0;
          completedLastQueryKey = queryKey;
          completedState.page = data.page || 1;
          completedState.pageSize = data.pageSize || completedState.pageSize;
          completedState.total = data.total || 0;
          completedState.totalPages = data.totalPages || 1;


          const items = Array.isArray(data.items) ? data.items : [];
          items.forEach(item => item.ownRecordBlocked = normalizeStrictUserName(item.senderName || '') === getGlobalUserName());


          completeRecordsTitle.textContent = `Complete Records (${completedState.total})`;
          completeRecordsList.innerHTML = items.length ? items.map(item => renderReceiverCard(item, true)).join('') : `<div class="empty">No completed records yet.</div>`;
          bindRecordCards(completeRecordsList, items);


          completedPaginationWrap.innerHTML = renderPaginationBar('completed', completedState);
          bindPaginationBar('completed', completedState, () => loadCompletedRecords(true));
          restoreInputFocus(completedSearchInput, focusState);
        } catch (e) {
          completeRecordsList.innerHTML = `<div class="empty">Failed to load completed records: ${escapeHtml(e.message)}</div>`;
        }
      }


      async function loadLogs(force = false) {
        if (!isAdminReceiver()) return;
        try {
          const params = new URLSearchParams({
            page:String(activityLogState.page),
            pageSize:String(activityLogState.pageSize),
            search:activityLogState.search,
            action:activityLogState.action,
            recordType:activityLogState.recordType
          });
          const focusState = preserveInputFocus(activityLogSearchInput);
          const data = await fetchJson('/api/logs?' + params.toString());
          const queryKey = params.toString();
          if (!force && data.version === activityLogVersion && activityLastQueryKey === queryKey) return;
          activityLogVersion = data.version || 0;
          activityLastQueryKey = queryKey;


          activityLogState.page = data.page || 1;
          activityLogState.pageSize = data.pageSize || activityLogState.pageSize;
          activityLogState.total = data.total || 0;
          activityLogState.totalPages = data.totalPages || 1;
          activityLogTitle.textContent = `Activity Log (${activityLogState.total})`;


          const logs = Array.isArray(data.items) ? data.items : [];
          if (!logs.length) {
            logWrap.innerHTML = `<div class="empty">No logs yet.</div>`;
          } else {
            logWrap.innerHTML = `
              <div style="overflow:auto;max-height:520px;">
                <table class="log-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Record ID</th>
                      <th>Action</th>
                      <th>Actor</th>
                      <th>Record Type</th>
                      <th>Sender</th>
                      <th>Selected Text</th>
                      <th>Override</th>
                      <th>Comment</th>
                      <th>Reviewed By</th>
                      <th>Exported File</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${logs.map(log => `
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
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `;
          }
          activityLogPaginationWrap.innerHTML = renderPaginationBar('activityLog', activityLogState);
          bindPaginationBar('activityLog', activityLogState, () => loadLogs(true));
          restoreInputFocus(activityLogSearchInput, focusState);
        } catch (e) {
          logWrap.innerHTML = `<div class="empty">Failed to load logs: ${escapeHtml(e.message)}</div>`;
        }
      }


      async function loadUserLogs(force = false) {
        if (!isAdminReceiver()) return;
        try {
          const params = new URLSearchParams({
            requesterRole:'admin',
            page:String(userLogState.page),
            pageSize:String(userLogState.pageSize),
            search:userLogState.search,
            type:userLogState.type,
            role:userLogState.role
          });
          const focusState = preserveInputFocus(userLogSearchInput);
          const data = await fetchJson('/api/user-logs?' + params.toString());
          const queryKey = params.toString();
          if (!force && data.version === userLogVersion && userLastQueryKey === queryKey) return;
          userLogVersion = data.version || 0;
          userLastQueryKey = queryKey;


          userLogState.page = data.page || 1;
          userLogState.pageSize = data.pageSize || userLogState.pageSize;
          userLogState.total = data.total || 0;
          userLogState.totalPages = data.totalPages || 1;
          userLogTitle.textContent = `User Log (${userLogState.total})`;


          const logs = Array.isArray(data.items) ? data.items : [];
          if (!logs.length) {
            userLogWrap.innerHTML = `<div class="empty">No user logs yet.</div>`;
          } else {
            userLogWrap.innerHTML = `
              <div style="overflow:auto;max-height:520px;">
                <table class="log-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Action</th>
                      <th>Role</th>
                      <th>User ID</th>
                      <th>User Name</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Target Role</th>
                      <th>Deleted By</th>
                      <th>IP</th>
                      <th>Requested Old Name</th>
                      <th>Requested New Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${logs.map(log => `
                      <tr>
                        <td>${escapeHtml(formatDateTime(log.time))}</td>
                        <td>${escapeHtml(log.type || '-')}</td>
                        <td>${escapeHtml(log.role || '-')}</td>
                        <td>${escapeHtml(log.userId || '-')}</td>
                        <td>${escapeHtml(log.userName || '-')}</td>
                        <td>${escapeHtml(log.fromName || '-')}</td>
                        <td>${escapeHtml(log.toName || '-')}</td>
                        <td>${escapeHtml(log.targetRole || '-')}</td>
                        <td>${escapeHtml(log.deletedBy || '-')}</td>
                        <td>${escapeHtml(log.ip || '-')}</td>
                        <td>${escapeHtml(log.requestOldName || '-')}</td>
                        <td>${escapeHtml(log.requestNewName || '-')}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `;
          }
          userLogPaginationWrap.innerHTML = renderPaginationBar('userLog', userLogState);
          bindPaginationBar('userLog', userLogState, () => loadUserLogs(true));
          restoreInputFocus(userLogSearchInput, focusState);
        } catch (e) {
          userLogWrap.innerHTML = `<div class="empty">Failed to load user logs: ${escapeHtml(e.message)}</div>`;
        }
      }


      function resetScanStateForModal() {
        imageResultsByIndex = [];
        scannedZeroResultImages = new Set();
        selectedImageIndexForCurrentResult = null;
      }
      function hasSelectedResultForCurrentImage() {
        return selectedImageIndexForCurrentResult === currentSelectedImageIndex && hasMeaningfulText(selectedTextEditor.value);
      }
      function wasCurrentImageScannedWithZeroResult() { return scannedZeroResultImages.has(currentSelectedImageIndex); }
      function isOwnRecordBlocked() { return !!(currentModalRecord && currentModalRecord.ownRecordBlocked); }
      function canEditCurrentPhotoRecord() {
        if (!currentModalRecord) return false;
        if (currentModalRecord.completed) return false;
        if (isOwnRecordBlocked()) return false;
        if (hasSelectedResultForCurrentImage()) return true;
        if (wasCurrentImageScannedWithZeroResult()) return true;
        return false;
      }


      function refreshPhotoEditState() {
        if (!currentModalRecord) return;


        const editable = canEditCurrentPhotoRecord();
        selectedTextEditor.disabled = !editable;
        selectedCommentEditor.disabled = !editable;


        if (currentModalRecord.completed) {
          scanBtn.disabled = true;
          scanModeSelect.disabled = true;
          resultSearchInput.disabled = true;
          recordReadonlyNote.textContent = 'This completed record is read-only. You can only revert it.';
          saveSelectedTextBtn.textContent = 'Revert this record';
          saveSelectedTextBtn.className = 'warn';
        } else if (isOwnRecordBlocked()) {
          scanBtn.disabled = true;
          scanModeSelect.disabled = true;
          resultSearchInput.disabled = true;
          selectedTextEditor.disabled = true;
          selectedCommentEditor.disabled = true;
          recordReadonlyNote.textContent = 'You cannot review your own submitted record.';
          saveSelectedTextBtn.textContent = 'Complete this record';
          saveSelectedTextBtn.className = 'success';
          saveSelectedTextBtn.disabled = true;
        } else {
          scanBtn.disabled = false;
          scanModeSelect.disabled = false;
          resultSearchInput.disabled = false;
          saveSelectedTextBtn.disabled = false;
          saveSelectedTextBtn.textContent = 'Complete this record';
          saveSelectedTextBtn.className = 'success';


          if (hasSelectedResultForCurrentImage()) {
            recordReadonlyNote.textContent = 'Selected result ready. Edit text and comment.';
          } else if (wasCurrentImageScannedWithZeroResult()) {
            recordReadonlyNote.textContent = 'No result found. Manual typing allowed.';
          } else {
            recordReadonlyNote.textContent = 'Scan first. Auto-select if found, otherwise type manually.';
          }
        }
      }


      function refreshScannerEditState() {
        if (!currentModalRecord) return;
        if (currentModalRecord.completed) {
          scannerSelectedTextEditor.disabled = true;
          scannerCommentEditor.disabled = true;
          scannerSaveSelectedTextBtn.disabled = false;
          scannerSaveSelectedTextBtn.textContent = 'Revert this record';
          scannerSaveSelectedTextBtn.className = 'warn';
          scannerReadonlyNote.textContent = 'This completed record is read-only. You can only revert it.';
        } else if (isOwnRecordBlocked()) {
          scannerSelectedTextEditor.disabled = true;
          scannerCommentEditor.disabled = true;
          scannerSaveSelectedTextBtn.disabled = true;
          scannerSaveSelectedTextBtn.textContent = 'Complete this record';
          scannerSaveSelectedTextBtn.className = 'success';
          scannerReadonlyNote.textContent = 'You cannot review your own submitted record.';
        } else {
          scannerSelectedTextEditor.disabled = false;
          scannerCommentEditor.disabled = false;
          scannerSaveSelectedTextBtn.disabled = false;
          scannerSaveSelectedTextBtn.textContent = 'Complete this record';
          scannerSaveSelectedTextBtn.className = 'success';
          scannerReadonlyNote.textContent = 'Edit selected text and comment before completing.';
        }
      }


      function refreshImagePickSelection() {
        if (!currentModalRecord || currentModalRecord.recordType !== 'photo') return;
        const images = Array.isArray(currentModalRecord.images) ? currentModalRecord.images : [];


        modalImagePick.innerHTML = images.map((img, idx) => {
          const active = idx === currentSelectedImageIndex;
          const selectedFromThisImage = selectedImageIndexForCurrentResult === idx;
          return `
            <div class="pick-card ${active ? 'active' : ''} ${selectedFromThisImage ? 'scanned-selected' : ''}" data-pick-index="${idx}">
              <div class="image-stage">
                <img src="${img.url}" alt="">
                ${selectedFromThisImage ? '<div class="selected-image-check">✓</div>' : ''}
              </div>
              <div class="label">
                <span>${escapeHtml(img.name || 'Image')}</span>
                <span><button type="button" data-large-preview="${idx}">Preview</button></span>
              </div>
            </div>
          `;
        }).join('');


        modalImagePick.querySelectorAll('[data-pick-index]').forEach(el => {
          el.onclick = (e) => {
            if (e.target.closest('[data-large-preview]')) return;
            currentSelectedImageIndex = Number(el.getAttribute('data-pick-index'));
            refreshImagePickSelection();
            renderCandidateResults(imageResultsByIndex[currentSelectedImageIndex] || [], selectedImageIndexForCurrentResult === currentSelectedImageIndex ? normalizeFreeText(selectedTextEditor.value) : '');
            modalSelected.textContent = `Selected: ${selectedImageIndexForCurrentResult === currentSelectedImageIndex ? (selectedTextEditor.value || 'none') : 'none'}`;
            if (!currentModalRecord.completed && !isOwnRecordBlocked()) {
              if (selectedImageIndexForCurrentResult !== currentSelectedImageIndex && !wasCurrentImageScannedWithZeroResult()) selectedTextEditor.value = '';
            }
            refreshPhotoEditState();
          };
        });


        modalImagePick.querySelectorAll('[data-large-preview]').forEach(el => {
          el.onclick = (e) => {
            e.stopPropagation();
            const idx = Number(el.getAttribute('data-large-preview'));
            const img = images[idx];
            if (!img) return;
            largePreviewImage.src = img.url;
            imagePreviewModal.classList.add('show');
            refreshModalOpenState();
          };
        });
      }


      async function openModal(item) {
        try {
          const full = await fetchJson('/api/record/' + encodeURIComponent(item.id) + '?requesterName=' + encodeURIComponent(getGlobalUserName()));
          currentModalRecord = { ...full, ownRecordBlocked: !!full.ownRecordBlocked };
          currentSelectedImageIndex = 0;
          resetScanStateForModal();


          modalMeta.textContent = `${full.senderName || '-'} • ${formatDateTime(full.timestamp)} • ${full.recordType}`;
          deleteRecordBtn.style.display = (isAdminReceiver() && !full.completed) ? 'inline-flex' : 'none';


          if (full.recordType === 'scanner') {
            photoDetailLayout.classList.add('hidden');
            scannerDetailLayout.classList.remove('hidden');
            scannerDetailText.textContent = full.selectedText || full.selectedSourceText || 'Scanned text: none';
            scannerSelectedTextEditor.value = full.selectedText || '';
            scannerCommentEditor.value = full.comment || '';
            lockInfo.textContent = full.reviewLock ? `Locked by ${full.reviewLock.receiverName}` : '';
            refreshScannerEditState();
            editBox.style.display = 'none';
          } else {
            scannerDetailLayout.classList.add('hidden');
            photoDetailLayout.classList.remove('hidden');


            selectedTextEditor.value = full.completed ? (full.selectedText || '') : '';
            selectedCommentEditor.value = full.comment || '';
            overrideInfo.textContent = full.selectedSourceText && full.selectedText && full.selectedSourceText !== full.selectedText
              ? `Override: ${full.selectedSourceText} → ${full.selectedText}`
              : '';


            resultSearchInput.value = '';
            resultCountInfo.textContent = '';
            resultCompletedInfo.textContent = full.completed ? 'Completed' : '';
            modalCandidates.innerHTML = `<div class="empty">Scan this image to see results.</div>`;
            modalSelected.textContent = `Selected: none`;
            editBox.style.display = 'block';
            lockInfo.textContent = full.reviewLock ? `Locked by ${full.reviewLock.receiverName}` : '';
            refreshImagePickSelection();
            refreshPhotoEditState();
          }


          detailModal.classList.add('show');
          refreshModalOpenState();
        } catch (e) {
          showToast('Open record failed: ' + e.message, 'danger');
        }
      }


      function closeRecordModal() {
        detailModal.classList.remove('show');
        currentModalRecord = null;
        resetScanStateForModal();
        refreshModalOpenState();
      }


      closeModalBtn.onclick = closeRecordModal;
      closeImagePreviewBtn.onclick = () => {
        imagePreviewModal.classList.remove('show');
        refreshModalOpenState();
      };


      deleteRecordBtn.onclick = () => {
        if (!currentModalRecord || currentModalRecord.completed || !isAdminReceiver()) return;
        deleteConfirmText.textContent = `Delete pending record "${currentModalRecord.id}" ?`;
        deleteConfirmModal.classList.add('show');
        refreshModalOpenState();
      };
      cancelDeleteBtn.onclick = () => {
        deleteConfirmModal.classList.remove('show');
        refreshModalOpenState();
      };
      confirmDeleteBtn.onclick = async () => {
        if (!currentModalRecord) return;
        try {
          await fetchJson('/api/delete-record', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ id: currentModalRecord.id, actorName:getGlobalUserName(), requesterRole:'admin' })
          });
          deleteConfirmModal.classList.remove('show');
          detailModal.classList.remove('show');
          refreshModalOpenState();
          pendingDataVersion = 0;
          completedDataVersion = 0;
          await loadPendingRecords(true);
          await loadCompletedRecords(true);
          if (isAdminReceiver()) {
            activityLogVersion = 0;
            await loadLogs(true);
          }
        } catch (e) {
          showToast('Delete failed: ' + e.message, 'danger');
        }
      };


      scannerSaveSelectedTextBtn.onclick = async () => {
        if (!currentModalRecord || isOwnRecordBlocked()) return;


        if (currentModalRecord.completed) {
          revertConfirmModal.classList.add('show');
          refreshModalOpenState();
          confirmRevertBtn.onclick = async () => {
            try {
              await fetchJson('/api/update-selected-text', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body: JSON.stringify({
                  id: currentModalRecord.id,
                  receiverId:getReceiverId(),
                  reviewedBy:getGlobalUserName(),
                  receiverName:getGlobalUserName(),
                  selectedText: currentModalRecord.selectedText || '',
                  comment: currentModalRecord.comment || '',
                  completed:false
                })
              });
              revertConfirmModal.classList.remove('show');
              closeRecordModal();
              pendingDataVersion = 0;
              completedDataVersion = 0;
              await loadPendingRecords(true);
              await loadCompletedRecords(true);
              if (isAdminReceiver()) {
                activityLogVersion = 0;
                await loadLogs(true);
              }
            } catch (e) {
              showToast('Revert failed: ' + e.message, 'danger');
            }
          };
          return;
        }


        const textValue = normalizeFreeText(scannerSelectedTextEditor.value);
        const commentValue = normalizeFreeText(scannerCommentEditor.value);
        if (!hasMeaningfulText(textValue) || !hasMeaningfulText(commentValue)) {
          showToast('Edit selected text and comment are required before completing.', 'warn');
          return;
        }


        try {
          await fetchJson('/api/update-selected-text', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              id: currentModalRecord.id,
              receiverId:getReceiverId(),
              reviewedBy:getGlobalUserName(),
              receiverName:getGlobalUserName(),
              selectedText: textValue,
              comment: commentValue,
              completed:true
            })
          });
          closeRecordModal();
          pendingDataVersion = 0;
          completedDataVersion = 0;
          await loadPendingRecords(true);
          await loadCompletedRecords(true);
          if (isAdminReceiver()) {
            activityLogVersion = 0;
            await loadLogs(true);
          }
        } catch (e) {
          showToast('Save failed: ' + e.message, 'danger');
        }
      };


      saveSelectedTextBtn.onclick = async () => {
        if (!currentModalRecord || isOwnRecordBlocked()) return;


        if (currentModalRecord.completed) {
          revertConfirmModal.classList.add('show');
          refreshModalOpenState();
          confirmRevertBtn.onclick = async () => {
            try {
              await fetchJson('/api/update-selected-text', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body: JSON.stringify({
                  id: currentModalRecord.id,
                  receiverId:getReceiverId(),
                  reviewedBy:getGlobalUserName(),
                  receiverName:getGlobalUserName(),
                  selectedText: currentModalRecord.selectedText || '',
                  comment: currentModalRecord.comment || '',
                  completed:false
                })
              });
              revertConfirmModal.classList.remove('show');
              closeRecordModal();
              pendingDataVersion = 0;
              completedDataVersion = 0;
              await loadPendingRecords(true);
              await loadCompletedRecords(true);
              if (isAdminReceiver()) {
                activityLogVersion = 0;
                await loadLogs(true);
              }
            } catch (e) {
              showToast('Revert failed: ' + e.message, 'danger');
            }
          };
          return;
        }


        const textValue = normalizeFreeText(selectedTextEditor.value);
        const commentValue = normalizeFreeText(selectedCommentEditor.value);


        if (!canEditCurrentPhotoRecord()) {
          showToast('Please scan first.', 'warn');
          return;
        }
        if (!hasMeaningfulText(textValue) || !hasMeaningfulText(commentValue)) {
          showToast('Edit selected text and comment are required before completing.', 'warn');
          return;
        }


        try {
          await fetchJson('/api/update-selected-text', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              id: currentModalRecord.id,
              receiverId:getReceiverId(),
              reviewedBy:getGlobalUserName(),
              receiverName:getGlobalUserName(),
              selectedText: textValue,
              comment: commentValue,
              completed:true
            })
          });
          closeRecordModal();
          pendingDataVersion = 0;
          completedDataVersion = 0;
          await loadPendingRecords(true);
          await loadCompletedRecords(true);
          if (isAdminReceiver()) {
            activityLogVersion = 0;
            await loadLogs(true);
          }
        } catch (e) {
          showToast('Save failed: ' + e.message, 'danger');
        }
      };


      scanBtn.onclick = async () => {
        if (!currentModalRecord || currentModalRecord.recordType !== 'photo' || currentModalRecord.completed || isOwnRecordBlocked()) return;
        const img = (currentModalRecord.images || [])[currentSelectedImageIndex];
        if (!img) return;


        resultCompletedInfo.textContent = 'Scanning...';
        modalCandidates.innerHTML = '';
        resultCountInfo.textContent = '';
        selectedImageIndexForCurrentResult = null;
        scannedZeroResultImages.delete(currentSelectedImageIndex);
        modalSelected.textContent = 'Selected: none';
        selectedTextEditor.value = '';
        refreshImagePickSelection();
        refreshPhotoEditState();


        try {
          const image = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = reject;
            i.src = img.url;
          });


          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(image, 0, 0);


          const results = [];
          const mode = scanModeSelect.value;


          if (mode === 'all' || mode === 'code') {
            try {
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const qr = jsQR(imageData.data, imageData.width, imageData.height);
              if (qr && qr.data) results.push(qr.data);
            } catch {}


            try {
              const codeReader = new ZXing.BrowserMultiFormatReader();
              const decoded = await codeReader.decodeFromImageElement(image);
              if (decoded && decoded.text) results.push(decoded.text);
            } catch {}
          }


          if (!results.length && (mode === 'all' || mode === 'ocr')) {
            try {
              const ocr = await Tesseract.recognize(canvas, 'eng');
              const text = normalizeFreeText((ocr && ocr.data && ocr.data.text) || '');
              if (text) text.split('\n').map(x => normalizeFreeText(x)).filter(Boolean).forEach(x => results.push(x));
            } catch {}
          }


          const unique = [...new Set(results.map(x => normalizeFreeText(x)).filter(Boolean))];
          imageResultsByIndex[currentSelectedImageIndex] = unique;


          if (!unique.length) {
            scannedZeroResultImages.add(currentSelectedImageIndex);
            modalCandidates.innerHTML = `<div class="empty">No results.</div>`;
            modalSelected.textContent = 'Selected: none';
            resultCompletedInfo.textContent = 'No results';
            resultCountInfo.textContent = '0 result(s)';
            refreshPhotoEditState();
            refreshImagePickSelection();
            return;
          }


          const autoSelected = unique[0];
          selectedImageIndexForCurrentResult = currentSelectedImageIndex;
          selectedTextEditor.value = autoSelected;
          modalSelected.textContent = `Selected: ${autoSelected}`;
          renderCandidateResults(unique, autoSelected);
          resultCompletedInfo.textContent = 'Completed';
          resultCountInfo.textContent = `${unique.length} result(s)`;
          refreshPhotoEditState();
          refreshImagePickSelection();
        } catch (e) {
          resultCompletedInfo.textContent = 'Scan failed';
          resultCountInfo.textContent = e.message || '';
        }
      };


      function renderCandidateResults(items, selectedValue = '') {
        const keyword = normalizeSearchText(resultSearchInput.value);
        const filtered = (items || []).filter(x => !keyword || normalizeSearchText(x).includes(keyword));
        if (!filtered.length) {
          modalCandidates.innerHTML = `<div class="empty">No results.</div>`;
          return;
        }
        modalCandidates.innerHTML = filtered.map(text => `
          <div class="candidate ${text === selectedValue ? 'selected' : ''}" data-candidate-text="${encodeURIComponent(text)}">
            <div>${highlightText(text, keyword)}</div>
          </div>
        `).join('');


        modalCandidates.querySelectorAll('[data-candidate-text]').forEach(el => {
          el.onclick = () => {
            if (currentModalRecord && (currentModalRecord.completed || isOwnRecordBlocked())) return;
            const text = decodeURIComponent(el.getAttribute('data-candidate-text') || '');
            selectedImageIndexForCurrentResult = currentSelectedImageIndex;
            scannedZeroResultImages.delete(currentSelectedImageIndex);
            selectedTextEditor.value = text;
            modalSelected.textContent = `Selected: ${text}`;
            [...modalCandidates.querySelectorAll('.candidate')].forEach(x => x.classList.remove('selected'));
            el.classList.add('selected');
            refreshPhotoEditState();
            refreshImagePickSelection();
          };
        });
      }


      resultSearchInput.oninput = () => {
        const selectedValue = selectedImageIndexForCurrentResult === currentSelectedImageIndex ? normalizeFreeText(selectedTextEditor.value) : '';
        renderCandidateResults(imageResultsByIndex[currentSelectedImageIndex] || [], selectedValue);
      };


      cancelRevertBtn.onclick = () => {
        revertConfirmModal.classList.remove('show');
        refreshModalOpenState();
      };


      const debouncedPendingSearch = debounce(() => {
        pendingState.search = normalizeFreeText(pendingSearchInput.value);
        pendingState.page = 1;
        pendingDataVersion = 0;
        loadPendingRecords(true);
      }, 400);
      const debouncedCompletedSearch = debounce(() => {
        completedState.search = normalizeFreeText(completedSearchInput.value);
        completedState.page = 1;
        completedDataVersion = 0;
        loadCompletedRecords(true);
      }, 400);
      pendingSearchInput.oninput = debouncedPendingSearch;
      completedSearchInput.oninput = debouncedCompletedSearch;
      pendingTypeFilter.onchange = () => {
        pendingState.recordType = pendingTypeFilter.value;
        pendingState.page = 1;
        pendingDataVersion = 0;
        loadPendingRecords(true);
      };
      completedTypeFilter.onchange = () => {
        completedState.recordType = completedTypeFilter.value;
        completedState.page = 1;
        completedDataVersion = 0;
        loadCompletedRecords(true);
      };


      if (activityLogSearchInput) activityLogSearchInput.oninput = debounce(() => {
        activityLogState.search = normalizeFreeText(activityLogSearchInput.value);
        activityLogState.page = 1;
        activityLogVersion = 0;
        loadLogs(true);
      }, 400);
      if (activityLogActionFilter) activityLogActionFilter.onchange = () => {
        activityLogState.action = activityLogActionFilter.value;
        activityLogState.page = 1;
        activityLogVersion = 0;
        loadLogs(true);
      };
      if (activityLogTypeFilter) activityLogTypeFilter.onchange = () => {
        activityLogState.recordType = activityLogTypeFilter.value;
        activityLogState.page = 1;
        activityLogVersion = 0;
        loadLogs(true);
      };
      if (userLogSearchInput) userLogSearchInput.oninput = debounce(() => {
        userLogState.search = normalizeFreeText(userLogSearchInput.value);
        userLogState.page = 1;
        userLogVersion = 0;
        loadUserLogs(true);
      }, 400);
      if (userLogTypeFilter) userLogTypeFilter.onchange = () => {
        userLogState.type = userLogTypeFilter.value;
        userLogState.page = 1;
        userLogVersion = 0;
        loadUserLogs(true);
      };
      if (userLogRoleFilter) userLogRoleFilter.onchange = () => {
        userLogState.role = userLogRoleFilter.value;
        userLogState.page = 1;
        userLogVersion = 0;
        loadUserLogs(true);
      };


      (async () => {
        refreshReceiverProfileBadge();


        const existingName = getGlobalUserName();
        if (!existingName) {
          receiverNameRequiredInput.value = '';
          receiverNameRequiredModal.classList.add('show');
          refreshModalOpenState();
        } else {
          try { await saveReceiverNameDirect(existingName, isAdminReceiver() ? 'admin' : 'receiver'); } catch {}
        }


        await loadTeamUsers(true);
        await loadPendingRecords(true);
        await loadCompletedRecords(true);
        if (isAdminReceiver()) {
          await loadLogs(true);
          await loadUserLogs(true);
          await checkAdminRenamePopup();
        }
        updateReceiverSyncDot();
        checkReceiverAlert();
        checkReceiverRenameStatus();
        receiverHeartbeat();


        window.addEventListener('beforeunload', () => {
          if (receiverEventSource) { receiverEventSource.close(); receiverEventSource = null; }
        });

        connectReceiverSSE();

        setInterval(async () => {
          const typing = hasActiveTypingField();
          await loadTeamUsers(false);
          if (!typing) {
            await loadPendingRecords(false);
            await loadCompletedRecords(false);
            if (isAdminReceiver()) {
              await loadLogs(false);
              await loadUserLogs(false);
            }
          }
          if (isAdminReceiver()) {
            await checkAdminRenamePopup();
          }
          updateReceiverSyncDot();
          checkReceiverAlert();
          checkReceiverRenameStatus();
          receiverHeartbeat();
        }, 2500);
      })();
    }

