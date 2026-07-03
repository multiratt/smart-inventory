// Configuration
export const PAGE_ROLES = {
  sender: 'sender',
  receiver: 'receiver',
  dashboard: 'dashboard'
};

export const ROLE_LABELS = {
  admin: 'admin',
  receiver: 'receiver',
  all: 'everyone',
  sender: 'sender'
};

export const MAX_IMAGE_COUNT = 4;
export const MAX_INITIAL_IMAGES = 2;
export const THEME_KEY = 'theme_mode_v1';
export const DEVICE_ID_KEY = 'smart_inventory_device_id_v4';
export const RECEIVER_ID_KEY = 'receiver_device_id_v4';
export const GLOBAL_NAME_KEY = 'smart_inventory_user_name_v4';
export const SENDER_COMMENT_MODE_KEY = 'sender_comment_mode_v1';
export const CLEAN_GENERATION_KEY = 'clean_generation_v1';
export const ADMIN_RECEIVER_ID = 'receiver_admin_main';

export function getFingerprint() {
  return {
    userAgent: navigator.userAgent || '',
    platform: navigator.platform || '',
    language: navigator.language || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    screen: `${window.screen && window.screen.width || 0}x${window.screen && window.screen.height || 0}`
  };
}

export function getCurrentPath() {
  return window.location.pathname;
}

export function isSenderPage() {
  return window.location.pathname === '/sender';
}

export function isReceiverPage() {
  return window.location.pathname === '/receiver' || window.location.pathname === '/';
}

export function isDashboardPage() {
  return window.location.pathname === '/dashboard';
}

// ── Login helpers ─────────────────────────────────────────────────────────────
export function getCurrentUserRole() {
  return localStorage.getItem('currentUserRole') || '';
}

export function getCurrentUserName() {
  return localStorage.getItem('currentUserName') || '';
}

export function getCurrentUserId() {
  return localStorage.getItem('currentUserId') || '';
}

export function isLoggedIn() {
  return !!localStorage.getItem('currentUserId');
}

export function saveLoginSession(user) {
  localStorage.setItem('currentUserId', user.id || user.deviceId || '');
  localStorage.setItem('currentUserName', user.name || '');
  localStorage.setItem('currentUserRole', user.role || 'user');
  localStorage.setItem('receiver_token', user.token || user.deviceId || '');
}

export function clearLoginSession() {
  localStorage.removeItem('currentUserId');
  localStorage.removeItem('currentUserName');
  localStorage.removeItem('currentUserRole');
  localStorage.removeItem('receiver_token');
}

// isAdminReceiver: true only when role=admin on receiver page
export function isAdminReceiver() {
  return isReceiverPage() && getCurrentUserRole() === 'admin';
}

// isAdminSender: true only when role=admin on sender page
export function isAdminSender() {
  return isSenderPage() && getCurrentUserRole() === 'admin';
}
