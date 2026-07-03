    let eventSource = null;

    function connectSSE() {
      if (eventSource) eventSource.close();
      const token = localStorage.getItem('dashboard_token') || '';
      eventSource = new EventSource('/api/events?token=' + encodeURIComponent(token));
      eventSource.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          handleServerEvent(event);
        } catch(err) {}
      };
      eventSource.onerror = () => {
        eventSource.close();
        setTimeout(connectSSE, 5000);
      };
    }

    function handleServerEvent(event) {
      switch(event.type) {
        case 'record_created':
        case 'record_updated':
        case 'record_deleted':
          refreshDashboard(true, true);
          break;
        case 'sender_alert':
          break;
      }
    }

    export async function initDashboard() {
      app.innerHTML = `
        <header>
          <div class="header-inner">
            <div class="header-left">
              <div class="brand">Smart Inventory <span id="dashboardBrandSyncDot" class="brand-status-dot" title="Last sync: -"></span></div>
            </div>
            <div class="header-center">
              <div id="dashboardReadonlyBadge" class="header-readonly-badge hidden">READ ONLY</div>
            </div>
            <div class="header-right" id="dashboardHeaderActions">
              <button id="dashboardBackBtn" class="icon-btn" title="Back to inventory">📥</button>
              <button id="dashboardProfileBtn" class="user-menu-btn" title="Profile">👤</button>
              ${renderThemeButton()}
            </div>
          </div>
        </header>


        <div class="container">
          <div id="dashboardRoot" class="dashboard-shell"></div>
        </div>


        <div id="dashboardNameRequiredModal" class="modal">
          <div class="modal-panel" style="max-width:520px;">
            <div class="section-title" style="margin:0;">Set Admin Name</div>
            <div class="sub" id="dashboardNameRequiredSub">Please set admin name before using this page.</div>
            <div class="col" style="margin-top:12px;">
              <input id="dashboardNameRequiredInput" type="text" placeholder="Enter username" />
              <div class="row">
                <button id="dashboardSaveNameBtn" class="success">Continue</button>
              </div>
            </div>
          </div>
        </div>


        <div id="dashboardProfileModal" class="modal">
          <div class="modal-panel" style="max-width:520px;">
            <div class="modal-head">
              <div><div class="section-title" style="margin:0;">Profile</div></div>
              <button id="closeDashboardProfileModalBtn" class="danger">Close</button>
            </div>
            <div class="col">
              <div id="dashboardProfileCurrentName" class="name-badge"></div>
              <input id="dashboardProfileInput" type="text" placeholder="Change admin name" />
              <div class="row">
                <button id="dashboardProfileSaveBtn" class="primary">Save Name</button>
              </div>
            </div>
          </div>
        </div>


        <div id="dashboardSettingsModal" class="modal">
          <div class="modal-panel" style="max-width:920px;">
            <div class="modal-head">
              <div>
                <div class="section-title" style="margin:0;">Dashboard Settings</div>
                <div class="sub">Imported source, match setting, and focus setting.</div>
              </div>
              <div class="row">
                <button id="dashboardSettingsSaveTopBtn" class="success">Save Settings</button>
                <button id="closeDashboardSettingsModalBtn" class="danger">Close</button>
              </div>
            </div>
            <div id="dashboardSettingsBody" class="dashboard-settings-grid"></div>
          </div>
        </div>


        <div id="dashboardImportWizardModal" class="modal">
          <div class="modal-panel" style="max-width:860px;">
            <div class="modal-head">
              <div>
                <div class="section-title" style="margin:0;">Dashboard Setup</div>
                <div class="sub">Import first, then configure match setting.</div>
              </div>
            </div>
            <div id="dashboardImportWizardBody" class="dashboard-setup-steps"></div>
          </div>
        </div>


        <div id="dashboardImportModal" class="modal">
          <div class="modal-panel" style="max-width:660px;">
            <div class="modal-head">
              <div>
                <div class="section-title" style="margin:0;">Import Dashboard Data</div>
                <div class="sub">Import CSV or XLSX into the same JSON database.</div>
              </div>
              <button id="closeDashboardImportModalBtn" class="danger">Close</button>
            </div>
            <div class="col">
              <div class="mini">When you import a new file, the previous imported source will be replaced automatically.</div>
              <label class="file-label primary" for="dashboardImportFile">Choose CSV / XLSX</label>
              <input id="dashboardImportFile" type="file" accept=".csv,.xlsx,.xls,.xlsm" />
              <div id="dashboardImportFileName" class="mini">No file selected.</div>
              <div class="row">
                <button id="dashboardImportSubmitBtn" class="primary">Import</button>
              </div>
            </div>
          </div>
        </div>


        <div id="dashboardExportModal" class="modal">
          <div class="modal-panel" style="max-width:560px;">
            <div class="modal-head">
              <div>
                <div class="section-title" style="margin:0;">Export Dashboard XLSX</div>
                <div class="sub">Choose export mode.</div>
              </div>
              <button id="closeDashboardExportModalBtn" class="danger">Close</button>
            </div>
            <div class="col">
              <button id="dashboardExportFullBtn" class="primary">Export Full All Columns</button>
              <button id="dashboardExportVisibleBtn" class="success">Export Visible Columns Only</button>
            </div>
          </div>
        </div>


        <div id="dashboardRowDetailModal" class="modal">
          <div class="modal-panel" style="width:min(1180px,100%);">
            <div class="modal-head">
              <div>
                <div class="section-title" style="margin:0;">Dashboard Row Detail</div>
                <div id="dashboardRowDetailSub" class="sub"></div>
              </div>
              <button id="closeDashboardRowDetailModalBtn" class="danger">Close</button>
            </div>
            <div id="dashboardRowDetailBody"></div>
          </div>
        </div>


        <div id="dashboardCommentModal" class="modal">
          <div class="modal-panel" style="max-width:560px;">
            <div class="modal-head">
              <div>
                <div class="section-title" style="margin:0;">Edit Comment</div>
                <div id="dashboardCommentTarget" class="sub"></div>
              </div>
              <button id="closeDashboardCommentModalBtn" class="danger">Close</button>
            </div>
            <div class="col">
              <textarea id="dashboardCommentInput" placeholder="Comment"></textarea>
              <div class="row">
                <button id="dashboardCommentSaveBtn" class="success">Save Comment</button>
              </div>
            </div>
          </div>
        </div>


        <div id="dashboardAddFoundModal" class="modal">
          <div class="modal-panel" style="max-width:760px;">
            <div class="modal-head">
              <div>
                <div class="section-title" style="margin:0;">Add New Found</div>
                <div id="dashboardAddFoundTarget" class="sub"></div>
              </div>
              <button id="closeDashboardAddFoundModalBtn" class="danger">Close</button>
            </div>
            <div class="dashboard-top-cards" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
              <div class="col">
                <select id="dashboardAddFoundRecordType">
                  <option value="photo">Photo</option>
                  <option value="scanner">Scanner</option>
                </select>
                <input id="dashboardAddFoundSenderName" type="text" placeholder="Sender name" />
                <input id="dashboardAddFoundReviewedBy" type="text" placeholder="Reviewed by" />
                <input id="dashboardAddFoundAddedBy" type="text" placeholder="Add by" disabled />
                <input id="dashboardAddFoundTimestamp" type="datetime-local" />
              </div>
              <div class="col">
                <textarea id="dashboardAddFoundSelectedText" placeholder="Selected text"></textarea>
                <textarea id="dashboardAddFoundComment" placeholder="Comment"></textarea>
              </div>
            </div>
            <div class="row" style="margin-top:12px;">
              <button id="dashboardAddFoundSaveBtn" class="success">Save New Found</button>
            </div>
          </div>
        </div>


        <div id="dashboardImagePreviewModal" class="image-preview-modal">
          <div class="image-preview-panel">
            <div class="modal-head">
              <div class="section-title" style="margin:0;">Large Image Preview</div>
              <button id="closeDashboardImagePreviewBtn" class="danger">Close</button>
            </div>
            <img id="dashboardLargePreviewImage" src="" alt="">
          </div>
        </div>
      `;


      bindThemeButtons();


      const dashboardRoot = document.getElementById('dashboardRoot');
      const dashboardBrandSyncDot = document.getElementById('dashboardBrandSyncDot');
      const dashboardBackBtn = document.getElementById('dashboardBackBtn');
      const dashboardProfileBtn = document.getElementById('dashboardProfileBtn');
      const dashboardSettingsBtn = document.getElementById('dashboardSettingsBtn');
      const dashboardReadonlyBadge = document.getElementById('dashboardReadonlyBadge');


      const dashboardNameRequiredModal = document.getElementById('dashboardNameRequiredModal');
      const dashboardNameRequiredInput = document.getElementById('dashboardNameRequiredInput');
      const dashboardSaveNameBtn = document.getElementById('dashboardSaveNameBtn');
      const dashboardNameRequiredSub = document.getElementById('dashboardNameRequiredSub');


      const dashboardProfileModal = document.getElementById('dashboardProfileModal');
      const closeDashboardProfileModalBtn = document.getElementById('closeDashboardProfileModalBtn');
      const dashboardProfileCurrentName = document.getElementById('dashboardProfileCurrentName');
      const dashboardProfileInput = document.getElementById('dashboardProfileInput');
      const dashboardProfileSaveBtn = document.getElementById('dashboardProfileSaveBtn');


      const dashboardSettingsModal = document.getElementById('dashboardSettingsModal');
      const dashboardSettingsBody = document.getElementById('dashboardSettingsBody');
      const closeDashboardSettingsModalBtn = document.getElementById('closeDashboardSettingsModalBtn');
      const dashboardSettingsSaveTopBtn = document.getElementById('dashboardSettingsSaveTopBtn');


      const dashboardImportWizardModal = document.getElementById('dashboardImportWizardModal');
      const dashboardImportWizardBody = document.getElementById('dashboardImportWizardBody');


      const dashboardImportModal = document.getElementById('dashboardImportModal');
      const closeDashboardImportModalBtn = document.getElementById('closeDashboardImportModalBtn');
      const dashboardImportFile = document.getElementById('dashboardImportFile');
      const dashboardImportSubmitBtn = document.getElementById('dashboardImportSubmitBtn');
      const dashboardImportFileName = document.getElementById('dashboardImportFileName');


      const dashboardExportModal = document.getElementById('dashboardExportModal');
      const closeDashboardExportModalBtn = document.getElementById('closeDashboardExportModalBtn');
      const dashboardExportFullBtn = document.getElementById('dashboardExportFullBtn');
      const dashboardExportVisibleBtn = document.getElementById('dashboardExportVisibleBtn');


      const dashboardRowDetailModal = document.getElementById('dashboardRowDetailModal');
      const closeDashboardRowDetailModalBtn = document.getElementById('closeDashboardRowDetailModalBtn');
      const dashboardRowDetailBody = document.getElementById('dashboardRowDetailBody');
      const dashboardRowDetailSub = document.getElementById('dashboardRowDetailSub');


      const dashboardCommentModal = document.getElementById('dashboardCommentModal');
      const closeDashboardCommentModalBtn = document.getElementById('closeDashboardCommentModalBtn');
      const dashboardCommentInput = document.getElementById('dashboardCommentInput');
      const dashboardCommentSaveBtn = document.getElementById('dashboardCommentSaveBtn');
      const dashboardCommentTarget = document.getElementById('dashboardCommentTarget');


      const dashboardAddFoundModal = document.getElementById('dashboardAddFoundModal');
      const closeDashboardAddFoundModalBtn = document.getElementById('closeDashboardAddFoundModalBtn');
      const dashboardAddFoundRecordType = document.getElementById('dashboardAddFoundRecordType');
      const dashboardAddFoundSenderName = document.getElementById('dashboardAddFoundSenderName');
      const dashboardAddFoundReviewedBy = document.getElementById('dashboardAddFoundReviewedBy');
      const dashboardAddFoundAddedBy = document.getElementById('dashboardAddFoundAddedBy');
      const dashboardAddFoundTimestamp = document.getElementById('dashboardAddFoundTimestamp');
      const dashboardAddFoundSelectedText = document.getElementById('dashboardAddFoundSelectedText');
      const dashboardAddFoundComment = document.getElementById('dashboardAddFoundComment');
      const dashboardAddFoundSaveBtn = document.getElementById('dashboardAddFoundSaveBtn');
      const dashboardAddFoundTarget = document.getElementById('dashboardAddFoundTarget');


      const dashboardImagePreviewModal = document.getElementById('dashboardImagePreviewModal');
      const dashboardLargePreviewImage = document.getElementById('dashboardLargePreviewImage');
      const closeDashboardImagePreviewBtn = document.getElementById('closeDashboardImagePreviewBtn');


      const dashboardState = {
        summary: null,
        meta: null,
        rows: [],
        page:1,
        pageSize:20,
        total:0,
        totalPages:1,
        search:'',
        sortBy:'',
        sortDir:'asc',
        status:'',
        recordType:'all',
        filters:{},
        activeCommentRowId:'',
        activeAddFoundRowId:'',
        importFile:null,
        renderedSummaryVersion: '',
        renderedRowsVersion: '',
        syncVersion: 0,
        isRefreshing: false,
        countLabel:'0',
        tableScrollLeft:0,
        freezeAutoRefresh:false,
        accessAllowed:true,
        accessMode:'readonly',
        activeColumnPopup:{ column:'', search:'' }
      };


      dashboardBackBtn.onclick = () => { window.location.href = '/receiver'; };
      closeDashboardImagePreviewBtn.onclick = () => {
        dashboardImagePreviewModal.classList.remove('show');
        refreshModalOpenState();
      };


      function isDashboardReadOnly() {
        return dashboardState.accessMode !== 'full';
      }
      function getDashboardAdminName() { return normalizeStrictUserName(getGlobalUserName() || ''); }
      function refreshDashboardProfileBadge() {
        dashboardProfileCurrentName.innerHTML = `<span>${escapeHtml(getDashboardAdminName() || '-')}</span>`;
      }
      function applyDashboardHeaderAccessMode() {
        const readonly = isDashboardReadOnly();
        if (dashboardReadonlyBadge) dashboardReadonlyBadge.classList.toggle('hidden', !readonly);
        if (dashboardProfileBtn) dashboardProfileBtn.style.display = readonly ? 'none' : 'inline-flex';
        if (dashboardSettingsBtn) dashboardSettingsBtn.style.display = readonly ? 'none' : 'inline-flex';
        if (dashboardBackBtn) dashboardBackBtn.style.display = readonly ? 'none' : 'inline-flex';
      }


      async function checkDashboardAccess() {
        try {
          const json = await fetchJson('/api/dashboard-access');
          dashboardState.accessAllowed = !!json.allowDashboard;
          dashboardState.accessMode = json.accessMode || 'readonly';
          applyDashboardHeaderAccessMode();
          return true;
        } catch {
          dashboardState.accessAllowed = true;
          dashboardState.accessMode = 'readonly';
          applyDashboardHeaderAccessMode();
          return true;
        }
      }


      async function ensureDashboardAdminName() {
        if (isDashboardReadOnly()) return true;
        const name = getDashboardAdminName();
        if (!name) {
          dashboardNameRequiredModal.classList.add('show');
          refreshModalOpenState();
          return false;
        }
        try {
          const json = await fetchJson('/api/set-receiver-name', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              receiverId:getReceiverId(),
              deviceId:getUnifiedClientId(),
              receiverName:name,
              isAdmin:true,
              mode:'dashboard',
              fingerprint:getFingerprint()
            })
          });
          setGlobalUserName(json.normalized || name);
          refreshDashboardProfileBadge();
          return true;
        } catch (e) {
          dashboardNameRequiredSub.textContent = e.message;
          dashboardNameRequiredModal.classList.add('show');
          refreshModalOpenState();
          return false;
        }
      }


      dashboardSaveNameBtn.onclick = async () => {
        const raw = String(dashboardNameRequiredInput.value || '').trim();
        if (!hasStrictUserName(raw)) {
          showToast('Username must contain English letters only.', 'warn');
          return;
        }
        setGlobalUserName(normalizeStrictUserName(raw));
        const ok = await ensureDashboardAdminName();
        if (ok) {
          dashboardNameRequiredModal.classList.remove('show');
          refreshModalOpenState();
          await refreshDashboard(true, true);
        }
      };


      if (dashboardProfileBtn) {
        dashboardProfileBtn.onclick = () => {
          if (isDashboardReadOnly()) return;
          refreshDashboardProfileBadge();
          dashboardProfileInput.value = '';
          dashboardProfileModal.classList.add('show');
          refreshModalOpenState();
        };
      }
      closeDashboardProfileModalBtn.onclick = () => {
        dashboardProfileModal.classList.remove('show');
        refreshModalOpenState();
      };
      dashboardProfileSaveBtn.onclick = async () => {
        if (isDashboardReadOnly()) return;
        const raw = String(dashboardProfileInput.value || '').trim();
        if (!hasStrictUserName(raw)) {
          showToast('Username must contain English letters only.', 'warn');
          return;
        }
        try {
          const json = await fetchJson('/api/set-receiver-name', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              receiverId:getReceiverId(),
              deviceId:getUnifiedClientId(),
              receiverName:normalizeStrictUserName(raw),
              isAdmin:true,
              mode:'dashboard',
              fingerprint:getFingerprint()
            })
          });
          setGlobalUserName(json.normalized || raw);
          refreshDashboardProfileBadge();
          dashboardProfileModal.classList.remove('show');
          refreshModalOpenState();
        } catch (e) {
          showToast('Save profile failed: ' + e.message, 'danger');
        }
      };


      closeDashboardImportModalBtn.onclick = () => {
        dashboardImportModal.classList.remove('show');
        refreshModalOpenState();
      };
      closeDashboardSettingsModalBtn.onclick = () => {
        dashboardSettingsModal.classList.remove('show');
        refreshModalOpenState();
      };
      closeDashboardRowDetailModalBtn.onclick = () => {
        dashboardRowDetailModal.classList.remove('show');
        refreshModalOpenState();
      };
      closeDashboardCommentModalBtn.onclick = () => {
        dashboardCommentModal.classList.remove('show');
        refreshModalOpenState();
      };
      closeDashboardAddFoundModalBtn.onclick = () => {
        dashboardAddFoundModal.classList.remove('show');
        refreshModalOpenState();
      };
      closeDashboardExportModalBtn.onclick = () => {
        dashboardExportModal.classList.remove('show');
        refreshModalOpenState();
      };


      if (dashboardSettingsBtn) {
        dashboardSettingsBtn.onclick = async () => {
          if (isDashboardReadOnly()) return;
          await renderDashboardSettingsModal();
          dashboardSettingsModal.classList.add('show');
          refreshModalOpenState();
        };
      }


      dashboardImportFile.onchange = (e) => {
        const file = e.target.files && e.target.files[0];
        dashboardState.importFile = file || null;
        dashboardImportFileName.textContent = file ? `${file.name} (${Math.round(file.size / 1024)} KB)` : 'No file selected.';
      };


      dashboardImportSubmitBtn.onclick = async () => {
        if (isDashboardReadOnly()) return;
        if (!dashboardState.importFile) {
          showToast('Please choose a file first.', 'warn');
          return;
        }
        const form = new FormData();
        form.append('requesterRole', 'admin');
        form.append('file', dashboardState.importFile);


        dashboardImportSubmitBtn.disabled = true;
        try {
          await fetchJson('/api/dashboard/import', { method:'POST', body: form });
          dashboardImportModal.classList.remove('show');
          dashboardImportWizardModal.classList.remove('show');
          refreshModalOpenState();
          dashboardState.importFile = null;
          dashboardImportFile.value = '';
          dashboardImportFileName.textContent = 'No file selected.';
          await renderDashboardSettingsModal();
          await refreshDashboard(true, true);
        } catch (e) {
          showToast('Import failed: ' + e.message, 'danger');
        }
        dashboardImportSubmitBtn.disabled = false;
      };


      dashboardCommentSaveBtn.onclick = async () => {
        if (isDashboardReadOnly()) return;
        if (!dashboardState.activeCommentRowId) return;
        try {
          await fetchJson('/api/dashboard/comment', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              requesterRole:'admin',
              rowId:dashboardState.activeCommentRowId,
              dashboardComment:dashboardCommentInput.value
            })
          });
          dashboardCommentModal.classList.remove('show');
          refreshModalOpenState();
          await loadDashboardRows(true);
          renderDashboardContentOnlyTable(true);
        } catch (e) {
          showToast('Save comment failed: ' + e.message, 'danger');
        }
      };


      dashboardAddFoundSaveBtn.onclick = async () => {
        if (isDashboardReadOnly()) return;
        if (!dashboardState.activeAddFoundRowId) return;
        try {
          const payload = {
            requesterRole:'admin',
            requesterName:getDashboardAdminName(),
            rowId:dashboardState.activeAddFoundRowId,
            selectedText:dashboardAddFoundSelectedText.value,
            comment:dashboardAddFoundComment.value
          };


          await fetchJson('/api/dashboard/add-found', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify(payload)
          });
          dashboardAddFoundModal.classList.remove('show');
          refreshModalOpenState();
          await refreshDashboard(true, true);
        } catch (e) {
          showToast('Add new found failed: ' + e.message, 'danger');
        }
      };


      dashboardExportFullBtn.onclick = () => startDashboardExport('full');
      dashboardExportVisibleBtn.onclick = () => startDashboardExport('visible');


      async function startDashboardExport(mode) {
        try {
          const res = await fetch('/api/dashboard/export?mode=' + encodeURIComponent(mode));
          if (!res.ok) throw new Error('Export failed');
          const blob = await res.blob();
          const disposition = res.headers.get('Content-Disposition') || '';
          const match = /filename="([^"]+)"/i.exec(disposition);
          downloadBlob(blob, match ? match[1] : 'dashboard_export.xlsx');
          dashboardExportModal.classList.remove('show');
          refreshModalOpenState();
        } catch (e) {
          showToast('Export failed: ' + e.message, 'danger');
        }
      }


      async function updateDashboardSyncDot() {
        try {
          const json = await fetchJson('/api/sync-status');
          if (json.version !== dashboardState.syncVersion || !dashboardBrandSyncDot.title) {
            dashboardState.syncVersion = json.version;
            dashboardBrandSyncDot.style.background = json.status === 'done' ? 'var(--success)' : 'var(--danger)';
            dashboardBrandSyncDot.title = json.lastSyncTime ? `Last sync: ${formatDateTime(json.lastSyncTime)}` : 'Last sync: -';
          }
        } catch {}
      }


      async function loadDashboardMeta(force = false) {
        const data = await fetchJson('/api/dashboard/meta');
        dashboardState.accessMode = data.accessMode || dashboardState.accessMode || 'readonly';
        applyDashboardHeaderAccessMode();
        if (!force && dashboardState.meta && dashboardState.meta.version === data.version) return dashboardState.meta;
        dashboardState.meta = data;
        return data;
      }


      async function loadDashboardSummary(force = false) {
        const data = await fetchJson('/api/dashboard/summary');
        dashboardState.accessMode = data.accessMode || dashboardState.accessMode || 'readonly';
        applyDashboardHeaderAccessMode();
        if (!force && dashboardState.summary && dashboardState.summary.version === data.version) return dashboardState.summary;
        dashboardState.summary = data;
        return data;
      }


      async function loadDashboardRows(force = false) {
        const params = new URLSearchParams({
          page:String(dashboardState.page),
          pageSize:String(dashboardState.pageSize),
          search:dashboardState.search,
          sortBy:dashboardState.sortBy,
          sortDir:dashboardState.sortDir,
          status:dashboardState.status,
          recordType:dashboardState.recordType,
          filters: JSON.stringify(dashboardState.filters || {})
        });
        const data = await fetchJson('/api/dashboard/rows?' + params.toString());
        dashboardState.accessMode = data.accessMode || dashboardState.accessMode || 'readonly';
        applyDashboardHeaderAccessMode();


        if (!force && dashboardState.renderedRowsVersion && dashboardState.renderedRowsVersion === String(data.version || '')) return;


        dashboardState.rows = data.items || [];
        dashboardState.page = data.page || 1;
        dashboardState.pageSize = data.pageSize || dashboardState.pageSize;
        dashboardState.total = data.total || 0;
        dashboardState.totalPages = data.totalPages || 1;
        dashboardState.renderedRowsVersion = String(data.version || '');


        dashboardState.countLabel = dashboardState.search
          ? `${dashboardState.total} found`
          : `${dashboardState.total} rows`;
      }


      function getVisibleColumns() {
        const settings = dashboardState.summary && dashboardState.summary.settings;
        return settings && Array.isArray(settings.visibleColumns) ? settings.visibleColumns.slice(0, 10) : [];
      }
      function dashboardSortIcon(key) {
        if (dashboardState.sortBy !== key) return '↕';
        return dashboardState.sortDir === 'asc' ? '↑' : '↓';
      }
      function dashboardStatusBadge(status, isAddNew) {
        if (isAddNew || status === 'new') return `<span class="dash-status-badge new">NEW</span>`;
        if (status === 'found') return `<span class="dash-status-badge found">FOUND</span>`;
        return `<span class="dash-status-badge pending">PENDING</span>`;
      }
      function dashboardOriginBadge(origin) {
        if (origin === 'import') return `<span class="dash-origin-badge import">IMPORT</span>`;
        if (origin === 'scanner') return `<span class="dash-origin-badge scanner">SCANNER</span>`;
        return `<span class="dash-origin-badge photo">PHOTO</span>`;
      }


      function renderDashboardHome(summary) {
        return `
          <div class="dashboard-home-head" id="dashboardHomeSection">
            <div>
              <div class="section-title" style="margin:0;">Dashboard Overview</div>
              <div class="sub">
                ${summary.activeImport ? `${escapeHtml(summary.activeImport.fileName)} • ${escapeHtml(formatDateTime(summary.activeImport.importedAt || ''))}` : 'No import'}
              </div>
            </div>
          </div>
          <div class="dashboard-top-cards" id="dashboardCardsSection">
            <div class="stat-card"><div class="stat-label dash-stat-title"><span class="dash-icon">📦</span><span>Total</span></div><div class="stat-value">${summary.cards.total}</div></div>
            <div class="stat-card"><div class="stat-label dash-stat-title"><span class="dash-icon">⏳</span><span>Pending</span></div><div class="stat-value">${summary.cards.importPending + summary.cards.photoScannerPending}</div></div>
            <div class="stat-card"><div class="stat-label dash-stat-title"><span class="dash-icon">✅</span><span>Found</span></div><div class="stat-value">${summary.cards.importFound}</div></div>
            <div class="stat-card"><div class="stat-label dash-stat-title"><span class="dash-icon">🆕</span><span>New</span></div><div class="stat-value">${summary.cards.newCount}</div></div>
            <div class="stat-card"><div class="stat-label dash-stat-title"><span class="dash-icon">📈</span><span>Match Rate</span></div><div class="stat-value">${summary.cards.matchRate}%</div></div>
          </div>
        `;
      }


      function getColumnFilterValues(column) {
        const vals = dashboardState.filters && dashboardState.filters[column];
        return Array.isArray(vals) ? vals : [];
      }


      function renderDashboardTable() {
        const visibleColumns = getVisibleColumns();
        const items = dashboardState.rows || [];
        const readonly = isDashboardReadOnly();
        const actionCol = '<th>Action</th>';
        const actionCell = (item) => readonly ? `
          <td>
            <div class="row-actions">
              <button data-dashboard-view="${item.id}" class="mini-action primary" title="View">V</button>
            </div>
          </td>
        ` : `
          <td>
            <div class="row-actions">
              <button data-dashboard-view="${item.id}" class="mini-action primary" title="View">V</button>
              <button data-dashboard-comment="${item.id}" class="mini-action" title="Comment">C</button>
              ${item.canAddNew ? `<button data-dashboard-addfound="${item.id}" class="mini-action success" title="Add New">A</button>` : ''}
            </div>
          </td>
        `;


        return `
          <div class="card" id="dashboardTableSection">
            <div class="dashboard-toolbar">
              <div>
                <div class="section-title" style="margin:0;">Inventory Check</div>
                <div class="sub">Showing import rows and unmatched completed inventory rows.</div>
              </div>
              <div class="row">
                <button id="dashboardSettingsBtn" class="icon-btn" title="Dashboard settings">⚙️</button>
                <button id="dashboardExportBtn" class="success">Export XLSX</button>
              </div>
            </div>


            <div class="dashboard-filter-grid">
              <div class="search-input-wrap">
                <input id="dashboardSearchInput" type="search" placeholder="Search imported data and matched inventory..." value="${escapeHtml(dashboardState.search)}" />
                <div class="search-count">${escapeHtml(dashboardState.countLabel || '0')}</div>
              </div>
              <select id="dashboardStatusFilter">
                <option value="" ${dashboardState.status === '' ? 'selected' : ''}>All Status</option>
                <option value="found" ${dashboardState.status === 'found' ? 'selected' : ''}>Found</option>
                <option value="pending" ${dashboardState.status === 'pending' ? 'selected' : ''}>Pending</option>
                <option value="new" ${dashboardState.status === 'new' ? 'selected' : ''}>New</option>
              </select>
              <select id="dashboardRecordTypeFilter">
                <option value="all" ${dashboardState.recordType === 'all' ? 'selected' : ''}>All Record Types</option>
                <option value="photo" ${dashboardState.recordType === 'photo' ? 'selected' : ''}>Photo</option>
                <option value="scanner" ${dashboardState.recordType === 'scanner' ? 'selected' : ''}>Scanner</option>
              </select>
              <button id="dashboardResetFiltersBtn">Reset Filters</button>
            </div>


            <div class="dashboard-chip-wrap" style="margin-bottom:12px;">
              ${Object.entries(dashboardState.filters || {}).flatMap(([col, values]) => (Array.isArray(values) ? values : []).map(val => `
                <span class="dashboard-chip">
                  ${escapeHtml(col)}: ${escapeHtml(val)}
                  <button type="button" data-chip-remove-col="${escapeHtml(col)}" data-chip-remove-val="${escapeHtml(val)}">×</button>
                </span>
              `)).join('')}
            </div>


            <div class="dashboard-table-wrap" id="dashboardTableWrap">
              <table class="dashboard-table">
                <thead>
                  <tr>
                    <th>
                      <div class="dashboard-th-wrap">
                        <span>Origin</span>
                        <button class="dashboard-sort-btn" data-sort="origin">${dashboardSortIcon('origin')}</button>
                      </div>
                    </th>
                    <th class="dashboard-col-index">#</th>
                    ${visibleColumns.map(col => `
                      <th>
                        <div class="dashboard-th-wrap">
                          <span>${escapeHtml(col)}</span>
                          <button class="dashboard-sort-btn" data-sort="${escapeHtml(col)}">${dashboardSortIcon(col)}</button>
                          <button class="dashboard-col-menu-btn" data-col-menu="${escapeHtml(col)}">▾</button>
                        </div>
                      </th>
                    `).join('')}
                    <th>
                      <div class="dashboard-th-wrap">
                        <span>Status</span>
                        <button class="dashboard-sort-btn" data-sort="status">${dashboardSortIcon('status')}</button>
                      </div>
                    </th>
                    <th>
                      <div class="dashboard-th-wrap">
                        <span>Matched Text</span>
                        <button class="dashboard-sort-btn" data-sort="matchedSelectedText">${dashboardSortIcon('matchedSelectedText')}</button>
                      </div>
                    </th>
                    <th>Comment</th>
                    ${actionCol}
                  </tr>
                </thead>
                <tbody>
                  ${items.length ? items.map(item => `
                    <tr>
                      <td>${dashboardOriginBadge(item.origin)}</td>
                      <td class="dashboard-col-index">${item.sourceIndex || '-'}</td>
                      ${visibleColumns.map(col => `<td>${item.origin === 'import' ? escapeHtml(item.sourceData && item.sourceData[col] || '-') : '-'}</td>`).join('')}
                      <td>${dashboardStatusBadge(item.status, item.isAddNew)}</td>
                      <td>${escapeHtml(item.matchedSelectedText || '-')}</td>
                      <td>${escapeHtml(item.dashboardComment || '-')}</td>
                      ${actionCell(item)}
                    </tr>
                  `).join('') : `<tr><td colspan="${visibleColumns.length + 6}"><div class="empty">No dashboard records found.</div></td></tr>`}
                </tbody>
              </table>
            </div>
            <div id="dashboardRowsPaginationWrap"></div>
          </div>
        `;
      }


      function closeDashboardColumnFilterPopup() {
        dashboardColumnFilterPopupHost.innerHTML = '';
        dashboardState.activeColumnPopup = { column:'', search:'' };
        unlockBackgroundScrollIfNeeded();
      }


      async function openDashboardColumnFilterPopup(column, anchorEl) {
        closeDashboardColumnFilterPopup();
        lockBackgroundScroll();
        dashboardState.activeColumnPopup = { column, search:'' };


        const selectedValues = getColumnFilterValues(column).slice();
        const rect = anchorEl.getBoundingClientRect();


        const pop = document.createElement('div');
        pop.className = 'dashboard-col-filter-pop';
        pop.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 372))}px`;
        pop.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 460)}px`;
        pop.addEventListener('mousedown', e => e.stopPropagation());
        pop.addEventListener('click', e => e.stopPropagation());


        pop.innerHTML = `
          <div class="dashboard-col-filter-pop-head">
            <strong>${escapeHtml(column)}</strong>
            <button id="dashboardColFilterCloseBtn" class="icon-btn" style="width:28px;height:28px;flex:0 0 28px;">×</button>
          </div>
          <div class="dashboard-focus-inline">
            <input id="dashboardColLookupInput" list="dashboardColLookupList" type="text" placeholder="Search and select value..." />
            <button id="dashboardColLookupAddBtn" type="button">Add</button>
          </div>
          <datalist id="dashboardColLookupList"></datalist>
          <div class="dashboard-chip-wrap" id="dashboardColLookupChipWrap" style="margin-top:10px;"></div>
          <div class="row" style="margin-top:10px;">
            <button id="dashboardColFilterApplyBtn" class="primary">Apply</button>
            <button id="dashboardColFilterClearBtn">Clear</button>
          </div>
        `;


        dashboardColumnFilterPopupHost.appendChild(pop);


        const closeBtn = document.getElementById('dashboardColFilterCloseBtn');
        const lookupInput = document.getElementById('dashboardColLookupInput');
        const lookupList = document.getElementById('dashboardColLookupList');
        const lookupAddBtn = document.getElementById('dashboardColLookupAddBtn');
        const chipWrap = document.getElementById('dashboardColLookupChipWrap');
        const applyBtn = document.getElementById('dashboardColFilterApplyBtn');
        const clearBtn = document.getElementById('dashboardColFilterClearBtn');


        function renderChips() {
          chipWrap.innerHTML = selectedValues.map(v => `
            <span class="dashboard-chip">
              ${escapeHtml(v)}
              <button type="button" data-remove-chip-val="${escapeHtml(v)}">×</button>
            </span>
          `).join('');


          chipWrap.querySelectorAll('[data-remove-chip-val]').forEach(btn => {
            btn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              const val = btn.getAttribute('data-remove-chip-val');
              const idx = selectedValues.indexOf(val);
              if (idx >= 0) selectedValues.splice(idx, 1);
              renderChips();
            };
          });
        }


        async function refreshLookup(keyword = '') {
          try {
            const params = new URLSearchParams({
              column,
              keyword
            });
            const data = await fetchJson('/api/dashboard/focus-values?' + params.toString());
            const items = Array.isArray(data.items) ? data.items : [];
            lookupList.innerHTML = items.map(v => `<option value="${escapeHtml(v)}"></option>`).join('');
          } catch {
            lookupList.innerHTML = '';
          }
        }


        function addLookupValue() {
          const value = normalizeFreeText(lookupInput.value);
          if (!value) return;
          if (!selectedValues.includes(value)) selectedValues.push(value);
          lookupInput.value = '';
          renderChips();
        }


        closeBtn.onclick = closeDashboardColumnFilterPopup;
        lookupInput.oninput = debounce(() => refreshLookup(lookupInput.value), 250);
        lookupInput.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addLookupValue();
          }
        });
        lookupAddBtn.onclick = addLookupValue;


        applyBtn.onclick = async () => {
          if (selectedValues.length) dashboardState.filters[column] = [...new Set(selectedValues)];
          else delete dashboardState.filters[column];
          dashboardState.page = 1;
          closeDashboardColumnFilterPopup();
          await loadDashboardRows(true);
          renderDashboardContentOnlyTable(true);
        };


        clearBtn.onclick = async () => {
          delete dashboardState.filters[column];
          dashboardState.page = 1;
          closeDashboardColumnFilterPopup();
          await loadDashboardRows(true);
          renderDashboardContentOnlyTable(true);
        };


        renderChips();
        await refreshLookup('');
      }


      function getFocusRules() {
        const rules = dashboardState.summary && dashboardState.summary.settings && dashboardState.summary.settings.focusRules;
        return Array.isArray(rules) && rules.length ? rules : [{ column:'', values:[] }];
      }


      async function renderDashboardSettingsModal() {
        if (isDashboardReadOnly()) return;
        await loadDashboardMeta(true);
        await loadDashboardSummary(true);


        const summary = dashboardState.summary;
        const activeImport = summary.activeImport;
        const allColumns = activeImport ? activeImport.columns || [] : [];
        const visibleColumns = summary.settings.visibleColumns || [];
        const importMatchColumn = summary.settings.importMatchColumn || '';
        const inventoryFields = summary.settings.inventoryFields || [];
        const inventoryMatchField = summary.settings.inventoryMatchField || 'selectedText';
        const matchMode = summary.settings.matchMode || 'exact';
        const focusRules = getFocusRules();


        dashboardSettingsBody.innerHTML = `
          <div class="card" style="box-shadow:none;">
            <div class="section-title" style="margin-bottom:12px;">Imported Source</div>
            <div class="sub" style="margin-bottom:12px;">
              ${activeImport ? `${escapeHtml(activeImport.fileName)} • ${activeImport.rowCount} rows • ${escapeHtml(formatDateTime(activeImport.importedAt || ''))}` : 'No imported source yet.'}
            </div>
            <div class="mini" style="margin-bottom:12px;">When you import a new file, the previous imported source will be replaced automatically.</div>
            <div class="row">
              <button id="dashboardSettingsImportBtn" class="primary">Import Source</button>
              <button id="dashboardSettingsClearImportsBtn" class="danger" ${activeImport ? '' : 'disabled'}>Clear Imported Source</button>
            </div>
          </div>


          <div class="card" style="box-shadow:none;">
            <div class="section-title" style="margin-bottom:12px;">Match Setting</div>
            <div class="dashboard-kv">
              <div class="mini"><strong>Visible Columns</strong><br>Choose up to 10 columns.</div>
              <div class="dashboard-columns-wrap">
                ${allColumns.map(col => `
                  <label class="dash-check">
                    <input type="checkbox" data-dashboard-col="${escapeHtml(col)}" ${visibleColumns.includes(col) ? 'checked' : ''}>
                    <span>${escapeHtml(col)}</span>
                  </label>
                `).join('') || '<div class="mini">No imported columns yet.</div>'}
              </div>
            </div>
            <div class="dashboard-kv" style="margin-top:12px;">
              <div class="mini"><strong>Import Match Column</strong><br>1:1 match only.</div>
              <div>
                <select id="dashboardImportMatchColumnSelect">
                  <option value="">Select column</option>
                  ${allColumns.map(col => `<option value="${escapeHtml(col)}" ${importMatchColumn === col ? 'selected' : ''}>${escapeHtml(col)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="dashboard-kv" style="margin-top:12px;">
              <div class="mini"><strong>Inventory Match Field</strong><br>1:1 match only.</div>
              <div>
                <select id="dashboardInventoryMatchFieldSelect">
                  ${inventoryFields.map(field => `<option value="${escapeHtml(field)}" ${inventoryMatchField === field ? 'selected' : ''}>${escapeHtml(field)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="dashboard-kv" style="margin-top:12px;">
              <div class="mini"><strong>Match Mode</strong></div>
              <div>
                <select id="dashboardMatchModeSelect">
                  <option value="exact" ${matchMode === 'exact' ? 'selected' : ''}>Exact Match</option>
                  <option value="partial" ${matchMode === 'partial' ? 'selected' : ''}>Partial Match</option>
                </select>
              </div>
            </div>
          </div>


          <div class="card" style="box-shadow:none;">
            <div class="section-title" style="margin-bottom:12px;">Focus Setting</div>
            <div class="dashboard-focus-hint" style="margin-bottom:12px;">
              You can define up to 5 focus columns. Each column must have its own values. All active focus rules must match together.
            </div>
            <div id="dashboardFocusRulesWrap" class="col"></div>
            <div class="row" style="margin-top:12px;">
              <button id="dashboardAddFocusRuleBtn" type="button" ${focusRules.length >= 5 ? 'disabled' : ''}>Add Column</button>
            </div>
          </div>
        `;


        const settingsImportBtn = document.getElementById('dashboardSettingsImportBtn');
        const settingsClearImportsBtn = document.getElementById('dashboardSettingsClearImportsBtn');
        const focusRulesWrap = document.getElementById('dashboardFocusRulesWrap');
        const addFocusRuleBtn = document.getElementById('dashboardAddFocusRuleBtn');


        let localFocusRules = focusRules.map(rule => ({
          column: String(rule && rule.column || ''),
          values: Array.isArray(rule && rule.values) ? rule.values.slice() : []
        })).slice(0, 5);


        if (!localFocusRules.length) localFocusRules = [{ column:'', values:[] }];


        async function buildSuggestionList(column, keyword) {
          if (!column) return [];
          try {
            const params = new URLSearchParams({ column, keyword });
            const json = await fetchJson('/api/dashboard/focus-values?' + params.toString());
            return Array.isArray(json.items) ? json.items : [];
          } catch {
            return [];
          }
        }


        async function renderFocusRulesBlock() {
          focusRulesWrap.innerHTML = localFocusRules.map((rule, idx) => `
            <div class="dashboard-focus-rule-card" data-focus-rule-index="${idx}">
              <div class="dashboard-focus-rule-head">
                <div class="dashboard-focus-rule-title">Focus Column ${idx + 1}</div>
                <button type="button" data-remove-focus-rule="${idx}" ${localFocusRules.length <= 1 ? 'disabled' : ''}>Remove</button>
              </div>
              <select data-focus-column="${idx}">
                <option value="">Select column</option>
                ${allColumns.map(col => `<option value="${escapeHtml(col)}" ${rule.column === col ? 'selected' : ''}>${escapeHtml(col)}</option>`).join('')}
              </select>
              <div class="dashboard-focus-inline">
                <input data-focus-lookup="${idx}" list="dashboardFocusValueList_${idx}" type="text" placeholder="Search value" />
                <button type="button" data-focus-add-btn="${idx}">Add</button>
              </div>
              <datalist id="dashboardFocusValueList_${idx}"></datalist>
              <div class="dashboard-chip-wrap" data-focus-chip-wrap="${idx}">
                ${(rule.values || []).map(v => `
                  <span class="dashboard-chip" data-focus-chip="${idx}:${escapeHtml(v)}">
                    ${escapeHtml(v)}
                    <button type="button" data-focus-remove="${idx}" data-focus-remove-value="${escapeHtml(v)}">×</button>
                  </span>
                `).join('')}
              </div>
            </div>
          `).join('');


          focusRulesWrap.querySelectorAll('[data-remove-focus-rule]').forEach(btn => {
            btn.onclick = () => {
              const idx = Number(btn.getAttribute('data-remove-focus-rule'));
              localFocusRules.splice(idx, 1);
              if (!localFocusRules.length) localFocusRules.push({ column:'', values:[] });
              renderFocusRulesBlock();
            };
          });


          focusRulesWrap.querySelectorAll('[data-focus-column]').forEach(sel => {
            sel.onchange = () => {
              const idx = Number(sel.getAttribute('data-focus-column'));
              localFocusRules[idx].column = sel.value;
            };
          });


          focusRulesWrap.querySelectorAll('[data-focus-lookup]').forEach(input => {
            const idx = Number(input.getAttribute('data-focus-lookup'));
            const datalist = document.getElementById(`dashboardFocusValueList_${idx}`);


            input.oninput = debounce(async () => {
              const values = await buildSuggestionList(localFocusRules[idx].column, input.value);
              datalist.innerHTML = values.map(v => `<option value="${escapeHtml(v)}"></option>`).join('');
            }, 250);


            input.addEventListener('keydown', e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const value = normalizeFreeText(input.value);
                if (!value) return;
                if (!Array.isArray(localFocusRules[idx].values)) localFocusRules[idx].values = [];
                if (!localFocusRules[idx].values.includes(value)) localFocusRules[idx].values.push(value);
                input.value = '';
                renderFocusRulesBlock();
              }
            });
          });


          focusRulesWrap.querySelectorAll('[data-focus-add-btn]').forEach(btn => {
            btn.onclick = () => {
              const idx = Number(btn.getAttribute('data-focus-add-btn'));
              const input = focusRulesWrap.querySelector(`[data-focus-lookup="${idx}"]`);
              const value = normalizeFreeText(input ? input.value : '');
              if (!value) return;
              if (!Array.isArray(localFocusRules[idx].values)) localFocusRules[idx].values = [];
              if (!localFocusRules[idx].values.includes(value)) localFocusRules[idx].values.push(value);
              if (input) input.value = '';
              renderFocusRulesBlock();
            };
          });


          focusRulesWrap.querySelectorAll('[data-focus-remove]').forEach(btn => {
            btn.onclick = () => {
              const idx = Number(btn.getAttribute('data-focus-remove'));
              const value = btn.getAttribute('data-focus-remove-value');
              localFocusRules[idx].values = (localFocusRules[idx].values || []).filter(v => v !== value);
              renderFocusRulesBlock();
            };
          });


          if (addFocusRuleBtn) addFocusRuleBtn.disabled = localFocusRules.length >= 5;
          dashboardSettingsBody._localFocusRules = localFocusRules;
        }


        if (addFocusRuleBtn) {
          addFocusRuleBtn.onclick = () => {
            if (localFocusRules.length >= 5) return;
            localFocusRules.push({ column:'', values:[] });
            renderFocusRulesBlock();
          };
        }


        await renderFocusRulesBlock();


        settingsImportBtn.onclick = () => {
          dashboardImportModal.classList.add('show');
          refreshModalOpenState();
        };


        settingsClearImportsBtn.onclick = async () => {
          try {
            await fetchJson('/api/dashboard/clear-imports', {
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ requesterRole:'admin' })
            });
            dashboardSettingsModal.classList.remove('show');
            refreshModalOpenState();
            await refreshDashboard(true, true);
          } catch (e) {
            showToast('Clear imported data failed: ' + e.message, 'danger');
          }
        };
      }


      dashboardSettingsSaveTopBtn.onclick = async () => {
        if (isDashboardReadOnly()) return;
        const selected = [...document.querySelectorAll('[data-dashboard-col]:checked')].map(x => x.getAttribute('data-dashboard-col'));
        if (selected.length > 10) {
          showToast('Please select no more than 10 columns.', 'warn');
          return;
        }


        const localFocusRules = (dashboardSettingsBody && dashboardSettingsBody._localFocusRules) ? dashboardSettingsBody._localFocusRules : [];
        const focusRules = localFocusRules
          .map(rule => ({
            column: String(rule && rule.column || '').trim(),
            values: Array.isArray(rule && rule.values) ? rule.values.map(v => String(v || '').trim()).filter(Boolean) : []
          }))
          .filter(rule => rule.column || rule.values.length)
          .slice(0, 5);


        try {
          await fetchJson('/api/dashboard/settings', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({
              requesterRole:'admin',
              visibleColumns:selected,
              importMatchColumn:(document.getElementById('dashboardImportMatchColumnSelect') || {}).value || '',
              inventoryMatchField:(document.getElementById('dashboardInventoryMatchFieldSelect') || {}).value || 'selectedText',
              matchMode:(document.getElementById('dashboardMatchModeSelect') || {}).value || 'exact',
              focusRules
            })
          });
          dashboardSettingsModal.classList.remove('show');
          refreshModalOpenState();
          await refreshDashboard(true, true);
        } catch (e) {
          showToast('Save settings failed: ' + e.message, 'danger');
        }
      };


      async function openDashboardWizardIfNeeded() {
        if (isDashboardReadOnly()) return;
        if (dashboardState.summary && dashboardState.summary.hasData) return;
        await renderDashboardSettingsModal();


        dashboardImportWizardBody.innerHTML = `
          <div class="dashboard-step">
            <div class="section-title" style="margin-bottom:8px;">Step 1 · Import Source</div>
            <div class="sub">Import CSV or XLSX first.</div>
            <div class="mini" style="margin-top:8px;">When you import a new file, the previous imported source will be replaced automatically.</div>
            <div class="row" style="margin-top:12px;">
              <button id="dashboardWizardImportBtn" class="primary">Import File</button>
            </div>
          </div>
          <div class="dashboard-step">
            <div class="section-title" style="margin-bottom:8px;">Step 2 · Match Setting</div>
            <div class="sub">After import, open settings and select visible columns, 1:1 match field, and focus rules.</div>
            <div class="row" style="margin-top:12px;">
              <button id="dashboardWizardSettingsBtn" class="success">Open Settings</button>
            </div>
          </div>
        `;


        document.getElementById('dashboardWizardImportBtn').onclick = () => {
          dashboardImportModal.classList.add('show');
          refreshModalOpenState();
        };
        document.getElementById('dashboardWizardSettingsBtn').onclick = async () => {
          await renderDashboardSettingsModal();
          dashboardSettingsModal.classList.add('show');
          refreshModalOpenState();
        };


        dashboardImportWizardModal.classList.add('show');
        refreshModalOpenState();
      }


      function dashboardHasActiveEditableField() {
        const el = document.activeElement;
        if (!el) return false;
        const tag = String(el.tagName || '').toUpperCase();
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      }


      function bindDashboardTable() {
        const searchInput = document.getElementById('dashboardSearchInput');
        const statusFilter = document.getElementById('dashboardStatusFilter');
        const recordTypeFilter = document.getElementById('dashboardRecordTypeFilter');
        const resetFiltersBtn = document.getElementById('dashboardResetFiltersBtn');
        const paginationWrap = document.getElementById('dashboardRowsPaginationWrap');
        const exportBtn = document.getElementById('dashboardExportBtn');
        const tableWrap = document.getElementById('dashboardTableWrap');


        if (tableWrap) {
          tableWrap.scrollLeft = dashboardState.tableScrollLeft || 0;
          tableWrap.addEventListener('scroll', () => {
            dashboardState.tableScrollLeft = tableWrap.scrollLeft;
            dashboardState.freezeAutoRefresh = true;
            clearTimeout(tableWrap._freezeTimer);
            tableWrap._freezeTimer = setTimeout(() => {
              dashboardState.freezeAutoRefresh = false;
            }, 1200);
          });
        }


        if (exportBtn) exportBtn.onclick = () => {
          dashboardExportModal.classList.add('show');
          refreshModalOpenState();
        };


        if (searchInput) {
          searchInput.oninput = debounce(async () => {
            dashboardState.search = normalizeFreeText(searchInput.value);
            dashboardState.page = 1;
            await loadDashboardRows(true);
            renderDashboardContentOnlyTable(true);
          }, 400);
        }
        if (statusFilter) {
          statusFilter.onchange = async () => {
            dashboardState.status = statusFilter.value;
            dashboardState.page = 1;
            await loadDashboardRows(true);
            renderDashboardContentOnlyTable(true);
          };
        }
        if (recordTypeFilter) {
          recordTypeFilter.onchange = async () => {
            dashboardState.recordType = recordTypeFilter.value;
            dashboardState.page = 1;
            await loadDashboardRows(true);
            renderDashboardContentOnlyTable(true);
          };
        }
        if (resetFiltersBtn) {
          resetFiltersBtn.onclick = async () => {
            dashboardState.search = '';
            dashboardState.status = '';
            dashboardState.recordType = 'all';
            dashboardState.sortBy = '';
            dashboardState.sortDir = 'asc';
            dashboardState.filters = {};
            dashboardState.page = 1;
            await loadDashboardRows(true);
            renderDashboardContentOnlyTable(true);
          };
        }


        document.querySelectorAll('[data-sort]').forEach(btn => {
          btn.onclick = async () => {
            const key = btn.getAttribute('data-sort');
            if (dashboardState.sortBy === key) dashboardState.sortDir = dashboardState.sortDir === 'asc' ? 'desc' : 'asc';
            else {
              dashboardState.sortBy = key;
              dashboardState.sortDir = 'asc';
            }
            await loadDashboardRows(true);
            renderDashboardContentOnlyTable(true);
          };
        });


        document.querySelectorAll('[data-col-menu]').forEach(btn => {
          btn.onclick = async (e) => {
            e.stopPropagation();
            await openDashboardColumnFilterPopup(btn.getAttribute('data-col-menu'), btn);
          };
        });


        document.querySelectorAll('[data-chip-remove-col]').forEach(btn => {
          btn.onclick = async () => {
            const col = btn.getAttribute('data-chip-remove-col');
            const val = btn.getAttribute('data-chip-remove-val');
            const current = getColumnFilterValues(col).filter(x => x !== val);
            if (current.length) dashboardState.filters[col] = current;
            else delete dashboardState.filters[col];
            dashboardState.page = 1;
            await loadDashboardRows(true);
            renderDashboardContentOnlyTable(true);
          };
        });


        document.querySelectorAll('[data-dashboard-view]').forEach(btn => {
          btn.onclick = () => openDashboardRowDetail(btn.getAttribute('data-dashboard-view'));
        });


        if (!isDashboardReadOnly()) {
          document.querySelectorAll('[data-dashboard-comment]').forEach(btn => {
            btn.onclick = () => {
              const rowId = btn.getAttribute('data-dashboard-comment');
              const row = (dashboardState.rows || []).find(x => x.id === rowId);
              dashboardState.activeCommentRowId = rowId;
              dashboardCommentTarget.textContent = row ? `${row.origin} row` : '';
              dashboardCommentInput.value = row ? (row.dashboardComment || '') : '';
              dashboardCommentModal.classList.add('show');
              refreshModalOpenState();
            };
          });


          document.querySelectorAll('[data-dashboard-addfound]').forEach(btn => {
            btn.onclick = () => {
              const rowId = btn.getAttribute('data-dashboard-addfound');
              const row = (dashboardState.rows || []).find(x => x.id === rowId);
              dashboardState.activeAddFoundRowId = rowId;
              dashboardAddFoundTarget.textContent = row ? `${row.origin} row` : '';
              dashboardAddFoundRecordType.value = row && row.recordType ? row.recordType : 'photo';
              dashboardAddFoundSenderName.value = row ? (row.matchedSenderName || '') : '';
              dashboardAddFoundReviewedBy.value = row ? (row.matchedReviewedBy || '') : '';
              dashboardAddFoundAddedBy.value = getDashboardAdminName();
              dashboardAddFoundTimestamp.value = row ? formatDateTimeInputLocal(row.matchedTimestamp || '') : '';
              dashboardAddFoundSelectedText.value = row ? (row.matchedSelectedText || '') : '';
              dashboardAddFoundComment.value = row ? (row.dashboardComment || '') : '';


              dashboardAddFoundRecordType.disabled = true;
              dashboardAddFoundSenderName.disabled = true;
              dashboardAddFoundReviewedBy.disabled = true;
              dashboardAddFoundAddedBy.disabled = true;
              dashboardAddFoundTimestamp.disabled = true;


              dashboardAddFoundModal.classList.add('show');
              refreshModalOpenState();
            };
          });
        }


        paginationWrap.innerHTML = renderPaginationBar('dashboardRows', dashboardState);
        bindPaginationBar('dashboardRows', dashboardState, async () => {
          await loadDashboardRows(true);
          renderDashboardContentOnlyTable(true);
        });
      }


      function renderDashboardContentOnlyTable(force = false) {
        const old = document.getElementById('dashboardTableSection');
        if (old) old.remove();


        const wrapper = document.createElement('div');
        wrapper.innerHTML = renderDashboardTable();
        dashboardRoot.appendChild(wrapper.firstElementChild);
        bindDashboardTable();
      }


      async function openDashboardRowDetail(rowId) {
        try {
          const data = await fetchJson('/api/dashboard/row/' + encodeURIComponent(rowId));
          const row = data.row;
          dashboardRowDetailSub.textContent = `${row.origin || '-'} ${row.sourceIndex ? '• Row #' + row.sourceIndex : ''}`;


          const sourceHtml = Object.entries(row.sourceData || {}).map(([k, v]) => `
            <div class="detail-kv">
              <div class="detail-key">${escapeHtml(k)}</div>
              <div class="detail-value">${escapeHtml(v || '-')}</div>
            </div>
          `).join('');


          let matchHtml = `<div class="empty">No matched Smart Inventory record.</div>`;


          if (row.matchedRecord) {
            const item = row.matchedRecord;
            matchHtml = `
              <div class="dashboard-badge-line">
                ${dashboardStatusBadge(row.status, row.isAddNew)}
                ${renderTypeBadge(item.recordType)}
                <span class="pill import-badge">Inventory Check</span>
              </div>
              <div class="detail-kv"><div class="detail-key">Inventory Record ID</div><div class="detail-value">${escapeHtml(item.id || '-')}</div></div>
              <div class="detail-kv"><div class="detail-key">Selected Text</div><div class="detail-value">${escapeHtml(item.selectedText || '-')}</div></div>
              <div class="detail-kv"><div class="detail-key">Source Text</div><div class="detail-value">${escapeHtml(item.selectedSourceText || '-')}</div></div>
              <div class="detail-kv"><div class="detail-key">Comment</div><div class="detail-value">${escapeHtml(item.comment || '-')}</div></div>
              <div class="detail-kv"><div class="detail-key">Sender</div><div class="detail-value">${escapeHtml(item.senderName || '-')}</div></div>
              <div class="detail-kv"><div class="detail-key">Reviewed By</div><div class="detail-value">${escapeHtml(item.reviewedBy || '-')}</div></div>
              <div class="detail-kv"><div class="detail-key">Added By</div><div class="detail-value">${escapeHtml(item.addedBy || '-')}</div></div>
              <div class="detail-kv"><div class="detail-key">Record Type</div><div class="detail-value">${escapeHtml(item.recordType === 'photo' ? 'Photo' : (item.recordType || '-'))}</div></div>
              <div class="detail-kv"><div class="detail-key">Timestamp</div><div class="detail-value">${escapeHtml(formatDateTime(item.timestamp || ''))}</div></div>
              ${(item.images && item.images.length) ? `
                <div class="dashboard-detail-images">
                  ${item.images.map((img, idx) => `
                    <div>
                      <img class="thumb" src="${img.url}" alt="${escapeHtml(img.name || '')}" data-dashboard-preview="${escapeHtml(img.url)}">
                      <div class="mini" style="margin-top:6px;">${escapeHtml(img.name || `Image ${idx + 1}`)}</div>
                    </div>
                  `).join('')}
                </div>
              ` : '<div class="mini" style="margin-top:10px;">No images.</div>'}
            `;
          } else if (row.matchedImport) {
            matchHtml = `
              <div class="section-title" style="font-size:16px;">Matched Imported Row</div>
              <div class="detail-kv">
                <div class="detail-key">Import Row #${row.matchedImport.sourceIndex}</div>
                <div class="detail-value">${escapeHtml(JSON.stringify(row.matchedImport.sourceData || {}))}</div>
              </div>
            `;
          }


          dashboardRowDetailBody.innerHTML = `
            <div class="dashboard-detail-grid">
              <div class="detail-block">
                <div class="section-title" style="font-size:16px;">Source Data</div>
                ${row.origin === 'import' ? (sourceHtml || '<div class="empty">No source data.</div>') : `
                  <div class="detail-kv"><div class="detail-key">Origin</div><div class="detail-value">${escapeHtml(row.origin || '-')}</div></div>
                  <div class="detail-kv"><div class="detail-key">Status</div><div class="detail-value">${escapeHtml(row.status || '-')}</div></div>
                  ${row.matchedRecord ? `
                    <div class="detail-kv"><div class="detail-key">Record ID</div><div class="detail-value">${escapeHtml(row.matchedRecord.id || '-')}</div></div>
                    <div class="detail-kv"><div class="detail-key">Sender</div><div class="detail-value">${escapeHtml(row.matchedRecord.senderName || '-')}</div></div>
                    <div class="detail-kv"><div class="detail-key">Selected Text</div><div class="detail-value">${escapeHtml(row.matchedRecord.selectedText || '-')}</div></div>
                    <div class="detail-kv"><div class="detail-key">Comment</div><div class="detail-value">${escapeHtml(row.matchedRecord.comment || '-')}</div></div>
                  ` : '<div class="empty">No source record.</div>'}
                `}
              </div>
              <div class="detail-block">
                <div class="section-title" style="font-size:16px;">Match Detail</div>
                ${matchHtml}
              </div>
            </div>
            <div class="card" style="margin-top:16px;box-shadow:none;">
              <div class="section-title" style="font-size:16px;">Dashboard Comment</div>
              <div class="detail-value">${escapeHtml(row.dashboardComment || '-')}</div>
            </div>
          `;


          dashboardRowDetailBody.querySelectorAll('[data-dashboard-preview]').forEach(el => {
            el.onclick = () => {
              dashboardLargePreviewImage.src = el.getAttribute('data-dashboard-preview');
              dashboardImagePreviewModal.classList.add('show');
              refreshModalOpenState();
            };
          });


          dashboardRowDetailModal.classList.add('show');
          refreshModalOpenState();
        } catch (e) {
          showToast('Load detail failed: ' + e.message, 'danger');
        }
      }


      async function refreshDashboard(force = false, forceRows = false) {
        if (dashboardState.isRefreshing) return;
        dashboardState.isRefreshing = true;


        try {
          await checkDashboardAccess();


          const ok = await ensureDashboardAdminName();
          if (!ok) return;


          await updateDashboardSyncDot();
          await loadDashboardMeta(force);
          await loadDashboardSummary(force);


          const summaryVersion = String((dashboardState.summary && dashboardState.summary.version) || '');
          const summaryChanged = force || dashboardState.renderedSummaryVersion !== summaryVersion;


          if (!dashboardState.summary.hasData) {
            dashboardRoot.innerHTML = `
              <div class="card">
                <div class="dashboard-import-empty">
                  <div class="dashboard-hero-icon">📊</div>
                  <div class="section-title" style="margin:0;">Dashboard Overview</div>
                  <div class="dashboard-upload-hint">
                    ${isDashboardReadOnly()
                      ? 'Read only dashboard. You can view imported and matched data from this device.'
                      : 'Import your first CSV or XLSX file, then open settings to choose visible columns, 1:1 match field, and focus rules.'}
                  </div>
                  ${isDashboardReadOnly() ? '' : `
                  <div class="row center">
                    <button id="dashboardOpenImportBtn" class="primary">Import CSV / XLSX</button>
                  </div>`}
                </div>
              </div>
            `;
            if (!isDashboardReadOnly()) {
              document.getElementById('dashboardOpenImportBtn').onclick = () => {
                dashboardImportModal.classList.add('show');
                refreshModalOpenState();
              };
              await openDashboardWizardIfNeeded();
            }
            dashboardState.renderedSummaryVersion = summaryVersion;
            dashboardState.renderedRowsVersion = '';
            return;
          }


          if (!isDashboardReadOnly()) {
            dashboardImportWizardModal.classList.remove('show');
            refreshModalOpenState();
          }


          if (summaryChanged || !document.getElementById('dashboardTableSection')) {
            await loadDashboardRows(true);
            dashboardRoot.innerHTML = `
              ${renderDashboardHome(dashboardState.summary)}
              ${renderDashboardTable()}
            `;
            bindDashboardTable();
            dashboardState.renderedSummaryVersion = summaryVersion;
            return;
          }


          if (dashboardState.freezeAutoRefresh) return;
          if (dashboardHasActiveEditableField()) return;


          await loadDashboardRows(forceRows);


          const cardsSection = document.getElementById('dashboardCardsSection');
          const homeSection = document.getElementById('dashboardHomeSection');
          if (summaryChanged || !cardsSection || !homeSection) {
            const temp = document.createElement('div');
            temp.innerHTML = renderDashboardHome(dashboardState.summary);
            const newHome = temp.children[0];
            const newCards = temp.children[1];
            if (homeSection && newHome) homeSection.replaceWith(newHome);
            if (cardsSection && newCards) cardsSection.replaceWith(newCards);
            dashboardState.renderedSummaryVersion = summaryVersion;
          }


          renderDashboardContentOnlyTable(true);
        } finally {
          dashboardState.isRefreshing = false;
        }
      }


      document.addEventListener('mousedown', (e) => {
        const popup = dashboardColumnFilterPopupHost.firstElementChild;
        if (!popup) return;
        if (popup.contains(e.target)) return;
        if (e.target.closest('[data-col-menu]')) return;
        closeDashboardColumnFilterPopup();
      });

      window.addEventListener('beforeunload', () => {
        if (eventSource) { eventSource.close(); eventSource = null; }
      });

      connectSSE();

      (async () => {
        applyDashboardHeaderAccessMode();
        await refreshDashboard(true, true);
        setInterval(() => refreshDashboard(false, false), 3500);
        setInterval(updateDashboardSyncDot, 3000);
      })();
