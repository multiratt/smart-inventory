// Global state object
export const state = {
  // Identity
  currentUser: null,
  currentMode: null,
  currentDeviceId: null,
  currentReceiverId: null,
  currentRole: null,
  currentName: null,
  apiBase: '',

  // Records
  records: [],

  // Dashboard state
  dashboardMeta: null,
  dashboardSummary: null,
  dashboardRows: [],

  // Selected items
  selectedRecord: null,
  pendingUploads: [],

  // Clipboard
  clipboardText: null,
  clipboardImage: null,

  // Local DB
  localDb: null,

  // Intervals
  heartbeatInterval: null,
  pingInterval: null,
  pollingIntervals: [],
  alertPollers: [],

  // Server owner info cache
  serverOwnerInfo: {
    ok: false,
    adminReceiverId: 'receiver_admin_main',
    adminReceiverName: '',
    adminInitialized: false,
    cleanGeneration: 0
  },

  // Web popup host element
  webPopupHost: null,

  // Modal open state tracking
  modalOpenCount: 0
};

export function initState() {
  state.webPopupHost = document.getElementById('webPopupHost');
}

export function getState() {
  return state;
}

export function setState(key, value) {
  state[key] = value;
}
