const ROOT = 'api/mini-app';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
const pendingActions = new Map();
function runAction(body) {
  const key = JSON.stringify(body);
  if (pendingActions.has(key)) return pendingActions.get(key);
  const pending = request('/action', {
    method: 'POST', body: { requestId: crypto.randomUUID(), ...body },
  }).finally(() => pendingActions.delete(key));
  pendingActions.set(key, pending);
  return pending;
}

async function request(path, options = {}) {
  const initData = window.Telegram?.WebApp?.initData;
  const url = path.startsWith('/api/') ? path : `${ROOT}${path}`;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      ...(initData && !path.startsWith('/api/email-auth/') ? { Authorization: `tma ${initData}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    credentials: 'same-origin',
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) {
    let message = '';
    try { message = (await response.json()).message || ''; } catch { /* Status remains useful without a response body. */ }
    throw new ApiError(message || `הבקשה לא הושלמה (${response.status}).`, response.status);
  }
  if (response.status === 204) return null;
  return response.json();
}

export const api = {
  emailAuth: () => request('/api/email-auth/me'),
  emailLink: () => request('/api/email-auth/link', { method: 'POST' }),
  data: () => request('/data'),
  profile: (body) => request('/profile', { method: 'PATCH', body }),
  action: runAction,
  calendarStatus: () => request('/calendar/status'),
  connectCalendar: () => request('/calendar/connect', { method: 'POST' }),
  disconnectCalendar: () => request('/calendar/disconnect', { method: 'POST' }),
  events: (start, end) => request(`/calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
  shares: () => request('/shares'),
  createShare: (body) => request('/shares', { method: 'POST', body }),
  deleteShare: (id) => request(`/shares/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  shareAction: (id, body) => request(`/shares/${encodeURIComponent(id)}/action`, { method: 'POST', body }),
};
