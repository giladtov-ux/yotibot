import { api, ApiError } from './app-api.js';
import { calendarAuthorizationUrl } from './calendar-oauth-link.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const state = {
  data: null, calendar: { configured: false, connected: false }, events: [],
  tab: 'profile', reminderFilter: 'active', taskFilter: 'active', taskList: '',
  calendarMode: 'week', calendarDate: new Date(), loaded: false, busy: false,
  emailAuth: null, emailAuthError: null, shares: [], shareLoaded: false, refreshQueued: false, refreshForce: false, shareRefreshQueued: false, authChecking: false,
  refreshTimer: 0, loadGeneration: 0, streamStarted: false, sessionKeeperRequested: false,
};
const days = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const glyphs = {
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.8 4.8L8 20l11.7-11.7a2 2 0 0 0-2.8-2.8L5.2 17.2M14.5 7.5l2 2"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 10 6-10 6z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12m8-12v12"/></svg>',
  external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6m0-6-9 9M18 13v6H5V6h6"/></svg>',
};

function safe(text = '') {
  const node = document.createElement('span');
  node.textContent = String(text);
  return node.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function dateAt(value, options = {}) {
  return new Intl.DateTimeFormat('he-IL', { timeZone: state.data?.profile?.timezone || 'Asia/Jerusalem', ...options }).format(new Date(value));
}
function localDate(date, timezone = state.data?.profile?.timezone || 'Asia/Jerusalem') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || '00';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function localTime(date, timezone = state.data?.profile?.timezone || 'Asia/Jerusalem') {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(date);
  return `${parts.find((entry)=>entry.type==='hour')?.value || '09'}:${parts.find((entry)=>entry.type==='minute')?.value || '00'}`;
}
function announce(message, error = false) {
  const box = $('#app-alert');
  box.hidden = !message;
  box.textContent = message || '';
  box.classList.toggle('is-error', error);
}
function setLoading(value) {
  $('#loading-state').hidden = !value;
  $('#main').classList.toggle('is-loading', value);
  if (value) {
    $$('.view').forEach((view) => { view.hidden = true; });
    $('.bottom-nav').hidden = true;
  }
}
function enterLocked(message = 'פתחו את אח שלי מתוך Telegram כדי להציג את המידע האישי שלכם.') {
  setLoading(false);
  $('#error-state').hidden = true;
  $('#locked-state').hidden = false;
  $$('.view').forEach((el) => { el.hidden = true; });
  $('.bottom-nav').hidden = false;
  $$('.nav-item').forEach((button) => { button.disabled = true; button.setAttribute('aria-disabled','true'); });
  $('#locked-state p').textContent = message;
  const linkButton = $('#locked-link-telegram');
  linkButton.hidden = !(state.emailAuth?.signedIn && state.emailAuth?.verifiedEmail && !state.emailAuth?.telegramId);
  $('#locked-email-signout').hidden = !state.sessionSignedIn;
  $('#locked-retry-auth').hidden = !state.emailAuthError;
}
function showError(error) {
  setLoading(false);
  $('#locked-state').hidden = true;
  $$('.view').forEach((el) => { el.hidden = true; });
  $('.bottom-nav').hidden = false;
  $$('.nav-item').forEach((button) => { button.disabled = true; button.setAttribute('aria-disabled','true'); });
  $('#error-state').hidden = false;
  $('#error-message').textContent = error.message || 'בדקי את החיבור ונסי שוב.';
}
function unlockShell() {
  $('#locked-state').hidden = true;
  $('#error-state').hidden = true;
  $('.bottom-nav').hidden = false;
  $$('.view').forEach((view) => { view.hidden = view.id !== `view-${state.tab}`; });
  $$('.nav-item').forEach((button) => { button.disabled = false; button.removeAttribute('aria-disabled'); });
}
function ensureClerkSessionKeeper() {
  if (state.sessionKeeperRequested) return state.sessionKeeperPromise;
  state.sessionKeeperRequested = true;
  state.sessionKeeperPromise = new Promise((resolve) => {
    const timer = window.setTimeout(resolve, 15000);
    window.addEventListener('ah-sheli-email-ready', (event) => {
      state.sessionSignedIn = event.detail?.signedIn === true;
      const subjectChanged = state.sessionUserId && state.sessionUserId !== event.detail?.userId;
      state.sessionUserId = event.detail?.userId || null;
      const nativeTelegram = Boolean(window.Telegram?.WebApp?.initData);
      if ((!state.sessionSignedIn || subjectChanged) && state.loaded && !nativeTelegram) {
        state.loadGeneration++;
        state.data = null;
        state.shares = [];
        state.shareLoaded = false;
        state.loaded = false;
        state.emailAuth = null;
        enterLocked('היכנסו בדוא״ל או פתחו את אח שלי מתוך Telegram.');
      }
      clearTimeout(timer);
      resolve();
      queueRefresh(!nativeTelegram);
      drainQueuedRefresh();
    });
  });
  const script = document.createElement('script');
  script.type = 'module';
  script.src = '/session-keeper.js';
  script.onerror = () => { state.sessionKeeperRequested = false; };
  document.head.append(script);
  return state.sessionKeeperPromise;
}
function hasActiveDraft() {
  if ($('dialog[open]') || $$('form[data-unsaved="true"]').length) return true;
  const active = document.activeElement;
  return Boolean(active?.matches?.('input,select,textarea') && active.closest('form'));
}
function queueRefresh(force = false, refreshShares = false) {
  state.refreshQueued = true;
  state.refreshForce ||= force;
  state.shareRefreshQueued ||= refreshShares;
}
function drainQueuedRefresh() {
  if (!state.refreshQueued || state.busy || state.authChecking) return;
  if (hasActiveDraft() && !state.refreshForce) return;
  const force = state.refreshForce;
  const refreshShares = state.shareRefreshQueued;
  state.refreshQueued = false;
  state.refreshForce = false;
  state.shareRefreshQueued = false;
  loadData(false, force).then(() => {
    if (refreshShares && state.data) loadShares(false);
  });
}
async function loadData(first = false, force = false) {
  if (state.busy || state.authChecking) { queueRefresh(force); return; }
  if (!state.loaded) setLoading(true);
  if (!force && hasActiveDraft()) { queueRefresh(); return; }
  const initData = window.Telegram?.WebApp?.initData;
  const nativeTelegram = Boolean(window.AhSheliMiniApp?.active && initData);
  if (!nativeTelegram) {
    state.authChecking = true;
    try {
      await ensureClerkSessionKeeper();
      state.emailAuth = await api.emailAuth();
      state.emailAuthError = null;
      if (state.emailAuth?.signedIn) ensureClerkSessionKeeper();
    }
    catch (error) { state.emailAuth = null; state.emailAuthError = error; }
    finally { state.authChecking = false; }
    if (!state.emailAuth?.signedIn || !state.emailAuth?.verifiedEmail || !state.emailAuth?.telegramId || state.emailAuth?.hasAccess !== true) {
      enterLocked(state.emailAuthError
        ? `לא הצלחנו לבדוק את מצב החשבון. ${state.emailAuthError.message || 'בדקו את החיבור ונסו שוב.'}`
        : !state.emailAuth?.signedIn
        ? 'אפשר להיכנס או ליצור חשבון בדוא״ל. אחרי אימות הכתובת, מחברים את Telegram כדי לפתוח את המידע.'
        : !state.emailAuth?.verifiedEmail
          ? 'צריך לאמת את כתובת הדוא״ל דרך הודעת האימות שנשלחה.'
          : !state.emailAuth?.telegramId
            ? 'חשבון הדוא״ל מאומת. מחברים עכשיו את חשבון Telegram כדי להמשיך.'
            : 'אין כרגע גישה פעילה למרחב. אפשר לבדוק את המסלולים והרכישה באתר.');
      renderAccountControls();
      state.refreshQueued = false;
      state.refreshForce = false;
      state.shareRefreshQueued = false;
      return;
    }
  } else {
    // Email is optional for a signed native Telegram launch; it must never delay or replace native access.
    ensureClerkSessionKeeper();
    api.emailAuth().then((auth) => {
      state.emailAuth = auth;
      renderAccountControls();
    }).catch(() => { /* Existing Telegram access remains available without an email session. */ });
  }
  const initialLoad = !state.loaded;
  const generation = ++state.loadGeneration;
  state.busy = true;
  if (first) setLoading(true);
  try {
    const [data, calendar] = await Promise.all([api.data(), api.calendarStatus()]);
    if (generation !== state.loadGeneration) return;
    state.data = data;
    state.calendar = calendar;
    state.loaded = true;
    if (!state.streamStarted) { state.streamStarted = true; watchChanges(); }
    unlockShell();
    setLoading(false);
    if (initialLoad) {
      populateProfile(data.profile);
      $('#greeting').textContent = data.profile.name ? `היי ${data.profile.name}` : 'המרחב שלי';
    }
    $('#account-note').textContent = data.profile.access ? `גישה ${data.profile.access}${data.profile.expiresAt ? ` · עד ${dateAt(data.profile.expiresAt, { dateStyle: 'medium' })}` : ''}` : '';
    renderAccountControls();
    renderActive();
    await fetchEvents();
    if (state.tab === 'profile' && !state.shareLoaded) await loadShares(false);
  } catch (error) {
    if (error instanceof ApiError && [401, 403, 410].includes(error.status)) {
      enterLocked('הגישה לחשבון אינה פעילה כרגע. אפשר להתחבר או לחדש גישה דרך ההרשמה.');
      return;
    }
    if (first || !state.loaded) showError(error);
    else announce(error.message, true);
  } finally {
    state.busy = false;
    drainQueuedRefresh();
  }
}
function populateProfile(profile) {
  $('#profile-name').value = profile.name || '';
  $('#profile-gender').value = profile.gender || 'unspecified';
  $('#profile-language').value = profile.language || 'he';
  const timezone = profile.timezone || 'Asia/Jerusalem';
  if (![...$('#profile-timezone').options].some((option) => option.value === timezone)) {
    const option = document.createElement('option');
    option.value = timezone; option.textContent = timezone; $('#profile-timezone').prepend(option);
  }
  $('#profile-timezone').value = timezone;
}
function renderAccountControls() {
  const target = $('#account-link-panel');
  if (!target) return;
  const auth = state.emailAuth;
  if (!auth && window.AhSheliMiniApp?.active && window.Telegram?.WebApp?.initData) {
    target.innerHTML = '<div class="account-auth-copy"><strong>מחוברים דרך Telegram</strong><p>הפרטים מוצגים מתוך ההשקה המאובטחת של המיני־אפליקציה.</p></div>';
    return;
  }
  if (!auth?.signedIn) {
    target.innerHTML = `<div class="account-auth-copy"><strong>כניסה לחשבון</strong><p>אפשר להיכנס בדוא״ל. לאחר אימות וחיבור Telegram, המרחב האישי ייפתח.</p></div><div class="account-auth-actions"><a class="button button-outline" href="/sign-in">כניסה</a><a class="button button-pink" href="/sign-up">יצירת חשבון</a></div>`;
    return;
  }
  const email = safe(auth.email || '');
  target.innerHTML = `<div class="account-auth-copy"><strong>${auth.verifiedEmail ? 'דוא״ל מאומת' : 'נדרש אימות דוא״ל'}</strong><p dir="ltr">${email || 'לא סופקה כתובת דוא״ל'}</p>${auth.telegramId ? `<p>חשבון Telegram מחובר · ${safe(auth.telegramId)}</p>` : '<p>חשבון Telegram עדיין לא מחובר.</p>'}</div>${!auth.verifiedEmail ? `<a class="button button-outline" href="/sign-in">השלמת אימות בדוא״ל</a>` : !auth.telegramId ? `<button class="button button-pink" type="button" data-email-link>חיבור Telegram</button>` : '<span class="account-connected">החיבור לחשבון פעיל</span>'}<button class="button button-outline" type="button" data-email-signout>יציאה מחשבון הדוא״ל</button>`;
}
async function startEmailLink(button = null) {
  const feedback = $('#locked-auth-feedback');
  if (button) { button.disabled = true; button.textContent = 'מכינים קישור…'; }
  if (feedback) feedback.textContent = '';
  try {
    const result = await api.emailLink();
    const url = new URL(result.url, window.location.href);
    if (!['https:', 'tg:'].includes(url.protocol)) throw new Error('קישור החיבור אינו תקין.');
    if (window.Telegram?.WebApp?.openTelegramLink && url.hostname === 't.me') window.Telegram.WebApp.openTelegramLink(url.href);
    else if (window.Telegram?.WebApp?.openLink && url.protocol === 'https:') window.Telegram.WebApp.openLink(url.href);
    else window.location.assign(url.href);
    if (feedback) feedback.textContent = 'פתחו את Telegram ואשרו במפורש את חיבור החשבון.';
  } catch (error) {
    if (feedback) feedback.textContent = error.message || 'לא הצלחנו ליצור קישור חיבור כרגע.';
    announce(error.message || 'לא הצלחנו ליצור קישור חיבור כרגע.', true);
  } finally {
    if (button) { button.disabled = false; button.textContent = 'חיבור חשבון Telegram'; }
  }
}

async function loadShares(showLoading = true) {
  const target = $('#shares-content');
  if (!target || !state.data) return;
  const active = document.activeElement;
  const currentForm = $('#share-invite-form');
  const savedValues = currentForm ? Object.fromEntries(new FormData(currentForm).entries()) : null;
  const focusedName = active?.form === currentForm ? active.name : '';
  const wasUnsaved = currentForm?.dataset.unsaved === 'true';
  if (showLoading) target.innerHTML = '<div class="share-loading" aria-live="polite"><span></span><span></span><span></span></div>';
  try {
    const result = await api.shares();
    state.shares = Array.isArray(result.shares) ? result.shares : [];
    state.shareLoaded = true;
    renderShares();
    if (savedValues) {
      const freshForm = $('#share-invite-form');
      Object.entries(savedValues).forEach(([name, value]) => {
        const field = freshForm?.elements.namedItem(name);
        if (field && 'value' in field) field.value = value;
      });
      if (wasUnsaved) freshForm.dataset.unsaved = 'true';
      if (focusedName) freshForm?.elements.namedItem(focusedName)?.focus();
    }
  } catch (error) {
    target.innerHTML = `<div class="share-empty"><strong>לא הצלחנו לטעון שיתופים</strong><p>${safe(error.message || 'בדקו את החיבור ונסו שוב.')}</p><button class="button button-outline" type="button" data-retry-shares>לנסות שוב</button></div>`;
  }
}
function renderShares() {
  const target = $('#shares-content');
  if (!target) return;
  const lists = (state.data?.lists || []).filter((list) => !listIsTask(list));
  const cards = state.shares.map((share) => {
    const editable = share.owned || share.role === 'editor';
    const rows = (share.items || []).map((item) => `<li class="${item.checked ? 'is-checked' : ''}">${editable ? `<button type="button" class="share-check ${item.checked ? 'selected' : ''}" data-shared-check="${safe(share.id)}" data-item-id="${safe(item.id)}" data-checked="${item.checked ? 'true' : 'false'}" aria-label="${item.checked ? 'החזרת פריט לפעילות' : 'סימון פריט כהושלם'}" aria-pressed="${item.checked ? 'true' : 'false'}">${item.checked ? 'בוצע' : 'פתוח'}</button>` : ''}<span>${safe(item.text)}</span>${editable ? `<div class="share-item-actions"><button type="button" class="share-edit-button" data-edit-shared-item="${safe(share.id)}" data-item-id="${safe(item.id)}">עריכה</button><button type="button" class="share-edit-button" data-delete-shared-item="${safe(share.id)}" data-item-id="${safe(item.id)}">מחיקה</button></div>` : ''}</li>`).join('');
    return `<article class="share-card"><div class="share-card-heading"><div><h3>${safe(share.listName)}</h3><span class="share-role">${share.owned ? 'הרשימה שלך' : share.role === 'editor' ? 'אפשר לערוך' : 'צפייה בלבד'}</span></div>${share.owned ? `<button type="button" class="share-revoke" data-revoke-share="${safe(share.id)}">ביטול שיתוף</button>` : ''}</div>${rows ? `<ul class="shared-items">${rows}</ul>` : '<p class="share-empty-copy">הרשימה עדיין ריקה.</p>'}${editable ? `<button type="button" class="button button-outline share-add" data-add-shared-item="${safe(share.id)}">הוספת פריט לרשימה</button>` : ''}</article>`;
  }).join('');
  const options = lists.map((list) => `<option value="${safe(list.name)}">${safe(list.name)}</option>`).join('');
  target.innerHTML = `<form class="share-invite" id="share-invite-form"><div><strong>מזמינים דרך Telegram</strong><p>מזינים את מזהה Telegram של האדם ואת הרשימה לשיתוף.</p></div><label>רשימה<select name="listName" ${lists.length ? '' : 'disabled'}>${options || '<option>אין רשימות לשיתוף</option>'}</select></label><label>מזהה Telegram<input name="memberTelegramId" inputmode="numeric" autocomplete="off" required placeholder="לדוגמה: 123456789"></label><label>הרשאה<select name="role"><option value="viewer">צפייה בלבד</option><option value="editor">צפייה ועריכה</option></select></label><button type="submit" class="button button-pink" ${lists.length ? '' : 'disabled'}>שליחת הזמנה</button><p class="share-feedback" id="share-feedback" role="status" aria-live="polite"></p></form>${cards ? `<div class="share-list">${cards}</div>` : '<div class="share-empty"><strong>עדיין אין כאן שיתופים</strong><p>אפשר להזמין אדם אחר לרשימה, או לראות כאן רשימות ששותפו איתך.</p></div>'}`;
  const form = $('#share-invite-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const feedback = $('#share-feedback');
    const memberTelegramId = String(data.get('memberTelegramId') || '').trim();
    if (!/^\d{3,20}$/.test(memberTelegramId)) { feedback.textContent = 'מזהה Telegram צריך להכיל 3–20 ספרות.'; return; }
    const submit = $('button[type="submit"]', form);
    submit.disabled = true; feedback.textContent = 'שולחים הזמנה…';
    try {
      await api.createShare({ listName: data.get('listName'), memberTelegramId, role: data.get('role') });
      form.reset();
      form.dataset.unsaved = 'false';
      await loadShares(false);
      announce('ההזמנה נשלחה.');
      queueRefresh(true, true);
      drainQueuedRefresh();
    } catch (error) { feedback.textContent = error.message || 'לא הצלחנו לשלוח את ההזמנה.'; }
    finally { if (submit.isConnected) submit.disabled = false; }
  });
}
function sharedItemDialog(shareId, item = null) {
  const share = state.shares.find((entry) => String(entry.id) === String(shareId));
  if (!share || (!share.owned && share.role !== 'editor')) return;
  dialogOpen(item ? 'עריכת פריט משותף' : 'פריט חדש ברשימה', [makeField('תוכן הפריט', 'text', 'text', item?.text || '')], 'שמירה', 'שיתוף רשימות');
  $('#edit-form').onsubmit = async (event) => {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get('text') || '').trim();
    try {
      if (!text) throw new Error('כתבו מה לשמור.');
      await api.shareAction(shareId, { requestId: crypto.randomUUID(), entity: 'item', action: item ? 'update' : 'create', listName: share.listName, ...(item ? { id: item.id } : {}), text, checked: item?.checked });
      closeDialogs();
      await loadShares(false);
      announce('הרשימה המשותפת עודכנה.');
      queueRefresh(true, true);
      drainQueuedRefresh();
    } catch (error) { $('#dialog-error').textContent = error.message; $('#dialog-error').hidden = false; }
  };
}

function listIsTask(list) { return ['משימות', 'מטרות'].includes(list.name); }
function actionButton(kind, label, css = '') {
  return `<button type="button" class="round-action ${css}" data-action="${kind}" aria-label="${safe(label)}">${glyphs[kind] || ''}</button>`;
}
function renderLists() {
  const target = $('#lists-content');
  const lists = (state.data?.lists || []).filter((list) => !listIsTask(list));
  target.innerHTML = '';
  if (!lists.length) {
    target.innerHTML = `<div class="empty-state"><strong>עוד אין כאן רשימות</strong><p>צרו רשימה קטנה לקניות, קישורים או כל דבר שתרצו לשמור.</p><button type="button" class="button button-pink" data-new-list>יצירת רשימה</button></div>`;
    return;
  }
  lists.forEach((list) => {
    const section = document.createElement('section');
    section.className = 'list-section';
    const checked = list.items.filter((item) => item.checked).length;
    section.innerHTML = `<div class="list-heading"><h2>${safe(list.name)}</h2><div class="list-tools"><span class="list-count">${list.items.length ? `${checked} מתוך ${list.items.length} סומנו` : 'רשימה ריקה'}</span><button type="button" class="icon-button" data-delete-list="${safe(list.name)}" aria-label="מחיקת הרשימה">${glyphs.trash}</button></div></div><div class="paper-card list-card"></div><button type="button" class="button button-pink compact add-item" data-add-item="${safe(list.name)}">הוספת פריט <span class="plus">+</span></button>`;
    const card = $('.list-card', section);
    if (!list.items.length) card.innerHTML = '<div class="empty-state"><p>כאן יופיעו הפריטים שלך.</p></div>';
    list.items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'list-item';
      const isUrl = /^https?:\/\//i.test(item.text);
      const text = isUrl
        ? `<a class="list-text link-text" href="${safe(item.text)}" target="_blank" rel="noopener">${safe(item.text)} ${glyphs.external}</a>`
        : `<span class="list-text ${item.checked ? 'checked' : ''}">${safe(item.text)}</span>`;
      row.innerHTML = `${actionButton('trash', 'מחיקת פריט')} ${actionButton(item.checked ? 'undo' : 'check', item.checked ? 'החזרה לרשימה' : 'סימון כבוצע', item.checked ? '' : 'pink')} ${text}<button type="button" class="icon-button" data-edit-item="${safe(item.id)}" data-list-name="${safe(list.name)}" aria-label="עריכת פריט">${glyphs.edit}</button>`;
      $('.round-action[data-action="trash"]', row).dataset.deleteItem = item.id;
      $('.round-action[data-action="trash"]', row).dataset.listName = list.name;
      const toggle = $('.round-action[data-action="check"],.round-action[data-action="undo"]', row);
      toggle.dataset.toggleItem = item.id; toggle.dataset.listName = list.name;
      card.append(row);
    });
    target.append(section);
  });
}
function reminderDescription(reminder) {
  if (!reminder.recurring) return 'חד־פעמית';
  if (reminder.weekdays?.length) {
    const names = reminder.weekdays.slice().sort((a,b) => a-b).map((day) => ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'][day]).join(', ');
    return `חוזרת · ${names}`;
  }
  if (reminder.repeatEveryMs) return `חוזרת כל ${Math.max(1, Math.round(reminder.repeatEveryMs / 86400000))} ימים`;
  return 'חוזרת';
}
function renderReminders() {
  const target = $('#reminders-content'); target.innerHTML = '';
  const reminders = (state.data?.reminders || []).filter((item) => state.reminderFilter === 'history' ? item.completed : !item.completed)
    .sort((a,b) => a.dueAt - b.dueAt);
  if (!reminders.length) {
    target.innerHTML = `<div class="empty-state"><strong>${state.reminderFilter === 'history' ? 'עוד אין היסטוריה' : 'קצת שקט כאן'}</strong><p>${state.reminderFilter === 'history' ? 'תזכורות שסומנו כהושלמו יופיעו כאן.' : 'כשתרצי לזכור משהו, נשמור לך מקום.'}</p></div>`;
    return;
  }
  reminders.forEach((reminder) => {
    const card = document.createElement('article');
    card.className = 'paper-card reminder-card';
    const time = reminder.hour == null ? dateAt(reminder.dueAt, { hour: '2-digit', minute: '2-digit' }) : `${String(reminder.hour).padStart(2,'0')}:${String(reminder.minute || 0).padStart(2,'0')}`;
    card.innerHTML = `<div><div class="item-title">${safe(reminder.text)}</div><div class="item-meta"><span>${dateAt(reminder.dueAt, { weekday: 'long', day: 'numeric', month: 'long' })}</span><span>שעה ${time}</span></div></div><span class="repeat-badge">${safe(reminderDescription(reminder))}</span><div class="reminder-actions">${!reminder.completed ? `<button type="button" class="round-action pink" data-complete-reminder="${safe(reminder.id)}" aria-label="סימון כהושלם">${glyphs.check}</button>` : ''}<button type="button" class="round-action" data-edit-reminder="${safe(reminder.id)}" aria-label="עריכת תזכורת">${glyphs.edit}</button><button type="button" class="round-action" data-delete-reminder="${safe(reminder.id)}" aria-label="מחיקת תזכורת">${glyphs.trash}</button></div>`;
    target.append(card);
  });
}
function taskLists() { return (state.data?.lists || []).filter(listIsTask); }
function renderTasks() {
  const lists = taskLists();
  const switcher = $('#task-list-switch'); switcher.innerHTML = '';
  lists.forEach((list) => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = list.name; button.classList.toggle('selected', state.taskList === list.name);
    button.dataset.selectTaskList = list.name; switcher.append(button);
  });
  if (!lists.some((list) => list.name === state.taskList)) state.taskList = lists[0]?.name || '';
  $$('.task-list-switch button').forEach((button) => button.classList.toggle('selected', button.dataset.selectTaskList === state.taskList));
  const target = $('#tasks-content'); target.innerHTML = '';
  if (!lists.length) {
    target.innerHTML = `<div class="empty-state"><strong>כדי להתחיל, צרו רשימה בשם משימות או מטרות</strong><p>המשימות נשמרות ברשימות הקיימות שלכם, יחד עם שאר המידע.</p><button type="button" class="button button-pink" data-new-task-list>יצירת רשימת משימות</button></div>`;
    return;
  }
  const list = lists.find((candidate) => candidate.name === state.taskList) || lists[0];
  const items = state.taskFilter === 'history' ? list.items.filter((item) => item.checked)
    : Array.isArray(state.data.tasks) ? state.data.tasks.filter((item) => item.listName === list.name && !item.checked)
    : list.items.filter((item) => !item.checked);
  if (!items.length) {
    target.innerHTML = `<div class="empty-state"><strong>${state.taskFilter === 'history' ? 'כל הכבוד, עוד לא הושלם משהו' : 'אין משימות פתוחות כרגע'}</strong><p>${state.taskFilter === 'active' ? 'אפשר להוסיף כאן את הצעד הבא.' : 'משימות שסומנו יישמרו כאן להמשך.'}</p></div>`;
    return;
  }
  items.forEach((item) => {
    const card = document.createElement('article'); card.className = `paper-card task-card ${item.checked ? 'done' : ''}`;
    const deadline = item.dueAt ? `<span class="task-deadline">עד ${dateAt(item.dueAt, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</span>` : '';
    card.innerHTML = `<button type="button" class="task-check" data-task-toggle="${safe(item.id)}" data-list-name="${safe(list.name)}" aria-label="${item.checked ? 'העברה לפעילות' : 'סימון כהושלם'}">${item.checked ? glyphs.undo : glyphs.check}</button><div><div class="item-title">${safe(item.text)}</div><span class="goal-badge">${list.name === 'מטרות' ? 'מטרה' : 'משימה'}</span>${deadline}</div><div class="task-actions"><button type="button" class="round-action" data-task-edit="${safe(item.id)}" data-list-name="${safe(list.name)}" aria-label="עריכה">${glyphs.edit}</button><button type="button" class="round-action" data-task-delete="${safe(item.id)}" data-list-name="${safe(list.name)}" aria-label="מחיקה">${glyphs.trash}</button></div>`;
    target.append(card);
  });
}

function renderCalendar() {
  const status = $('#calendar-connect');
  if (!state.calendar.configured) status.innerHTML = '<div><strong>Google Calendar</strong><p>החיבור עדיין לא הוגדר במערכת.</p></div><button class="button button-outline" disabled>לא זמין עדיין</button>';
  else if (state.calendar.connected) status.innerHTML = '<div><strong>Google Calendar מחובר</strong><p>האירועים שלך מופיעים בלוח הזה.</p></div><button class="button button-outline" id="disconnect-calendar">ניתוק</button>';
  else status.innerHTML = '<div><strong>יומן Google לא מחובר</strong><p>אפשר להציג אירועים לצד התזכורות.</p></div><button class="button button-outline" id="connect-calendar">חיבור יומן</button>';
  const date = new Date(state.calendarDate); const start = new Date(date);
  if (state.calendarMode === 'month') start.setDate(1);
  if (state.calendarMode === 'week') start.setDate(date.getDate() - date.getDay());
  if (state.calendarMode === 'day') start.setDate(date.getDate());
  const count = state.calendarMode === 'month' ? new Date(date.getFullYear(), date.getMonth()+1, 0).getDate() : state.calendarMode === 'week' ? 7 : 1;
  $('#calendar-label').textContent = state.calendarMode === 'month'
    ? new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(date)
    : state.calendarMode === 'day' ? dateAt(date, { weekday:'long', day:'numeric', month:'long', year:'numeric' })
      : `${dateAt(start,{day:'numeric',month:'short'})} – ${dateAt(new Date(start.getTime()+6*86400000),{day:'numeric',month:'short',year:'numeric'})}`;
  const grid = $('#calendar-grid'); grid.innerHTML = '';
  if (state.calendarMode === 'month') days.forEach((dayName) => {
    const heading = document.createElement('div'); heading.className='calendar-day calendar-weekday'; heading.textContent=dayName; grid.append(heading);
  });
  const offset = state.calendarMode === 'month' ? start.getDay() : 0;
  for (let i=0; i<offset; i++) { const blank = document.createElement('div'); blank.className='calendar-day blank'; grid.append(blank); }
  for (let i=0; i<count; i++) {
    const day = new Date(start); day.setDate(start.getDate()+i);
    const cell = document.createElement('div'); cell.className = 'calendar-day';
    if (localDate(day) === localDate(new Date())) cell.classList.add('current');
    const dateStart = new Date(day); dateStart.setHours(0,0,0,0);
    const dateEnd = new Date(day); dateEnd.setHours(23,59,59,999);
    const reminderHere = (state.data?.reminders || []).some((r) => !r.completed && r.dueAt >= dateStart.getTime() && r.dueAt <= dateEnd.getTime());
    const eventsHere = state.events.some((event) => new Date(event.start).toDateString() === day.toDateString());
    cell.innerHTML = `<span class="day-name">${state.calendarMode === 'month' ? '' : days[day.getDay()]}</span><span class="day-number">${day.getDate()}</span>${reminderHere ? '<i class="day-dot" title="תזכורת"></i>' : ''}${eventsHere ? '<i class="day-dot" style="background:#754284" title="אירוע"></i>' : ''}`;
    cell.setAttribute('aria-label', dateAt(day,{weekday:'long',day:'numeric',month:'long'}));
    grid.append(cell);
  }
  const eventList = $('#calendar-events'); eventList.innerHTML = '';
  const sorted = state.events.filter((event) => new Date(event.start) >= start && new Date(event.start) < new Date(start.getTime() + count*86400000)).sort((a,b) => new Date(a.start)-new Date(b.start));
  sorted.forEach((event) => {
    const row = document.createElement('div'); row.className = 'event-row';
    row.innerHTML = `${safe(event.title)}<span>${event.allDay ? 'כל היום' : dateAt(event.start,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>`;
    eventList.append(row);
  });
  if (!sorted.length && state.calendar.connected) eventList.innerHTML = '<div class="empty-state"><p>אין אירועים בתקופה הזו.</p></div>';
}
async function fetchEvents() {
  if (!state.calendar.connected) { state.events = []; renderCalendar(); return; }
  const current = state.calendarDate;
  const start = new Date(current); start.setDate(1); start.setHours(0,0,0,0);
  const end = new Date(current.getFullYear(), current.getMonth()+1, 1);
  try { state.events = await api.events(start.toISOString(), end.toISOString()); renderCalendar(); }
  catch (error) { announce(`לא הצלחנו לטעון אירועי יומן: ${error.message}`, true); }
}
function renderActive() {
  if (!state.data) return;
  if (state.tab === 'lists') renderLists();
  if (state.tab === 'reminders') renderReminders();
  if (state.tab === 'tasks') renderTasks();
  if (state.tab === 'calendar') renderCalendar();
}
function switchTab(tab) {
  if (!state.data) return;
  state.tab = tab;
  $$('.view').forEach((view) => { const active = view.id === `view-${tab}`; view.hidden = !active; view.classList.toggle('active', active); });
  $$('.nav-item').forEach((button) => { const active = button.dataset.tab === tab; button.classList.toggle('selected', active); active ? button.setAttribute('aria-current','page') : button.removeAttribute('aria-current'); });
  $('#app-alert').hidden = true;
  renderActive();
}
function makeField(label, name, type = 'text', value = '', required = true) {
  const wrapper = document.createElement('label'); wrapper.className = 'field';
  const text = document.createElement('span'); text.textContent = label; wrapper.append(text);
  let input;
  if (type === 'weekdays') {
    input = document.createElement('div'); input.className = 'weekday-picker';
    ['א','ב','ג','ד','ה','ו','ש'].forEach((day, index) => {
      const option = document.createElement('label'); option.innerHTML = `<input type="checkbox" name="${name}" value="${index}"><span>${day}</span>`; input.append(option);
    });
  } else {
    input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type;
    input.name = name; input.value = value ?? ''; input.required = required;
    if (type === 'time') input.step = '60';
    if (type === 'textarea') input.maxLength = 300;
  }
  wrapper.append(input); return wrapper;
}
function dialogOpen(title, fields, submitLabel = 'שמירה', kicker = 'המרחב שלך') {
  $('#dialog-title').textContent = title; $('#dialog-kicker').textContent = kicker; $('#dialog-fields').replaceChildren(...fields);
  $('#dialog-submit').textContent = submitLabel; $('#dialog-error').hidden = true;
  $('#edit-dialog').showModal(); $('#dialog-fields input, #dialog-fields textarea')?.focus();
}
function closeDialogs() {
  $$('dialog[open]').forEach((dialog) => dialog.close());
  drainQueuedRefresh();
}
$$('dialog').forEach((dialog) => dialog.addEventListener('close', () => {
  $$('form', dialog).forEach((form) => { form.dataset.unsaved = 'false'; });
  drainQueuedRefresh();
}));
async function perform(action, success = '') {
  try {
    const next = await api.action(action); state.data = next; renderActive(); announce(success);
    queueRefresh(true);
    drainQueuedRefresh();
  } catch (error) { announce(error.message, true); throw error; }
}
function confirmAction(title, copy, action) {
  $('#confirm-title').textContent = title; $('#confirm-copy').textContent = copy;
  $('#confirm-error').hidden = true;
  const dialog = $('#confirm-dialog'); dialog.showModal();
  $('#confirm-submit').onclick = async (event) => {
    event.preventDefault();
    try {
      if (action.entity === 'calendar') {
        await api.disconnectCalendar();
        state.calendar.connected = false;
        state.events = [];
        renderCalendar();
        announce('יומן Google נותק.');
        queueRefresh(true);
        drainQueuedRefresh();
      } else await perform(action, 'הפריט נמחק.');
      dialog.close();
    }
    catch (error) {
      $('#confirm-error').textContent = error.message || 'לא הצלחנו להשלים את הפעולה.';
      $('#confirm-error').hidden = false;
    }
  };
}
function openListDialog(existing = null) {
  dialogOpen(existing ? 'שינוי שם הרשימה' : 'רשימה חדשה', [makeField('שם הרשימה','listName','text',existing?.name || '')], existing ? 'שמירת שם' : 'יצירת רשימה');
  $('#edit-form').onsubmit = async (event) => {
    event.preventDefault(); const name = new FormData(event.currentTarget).get('listName')?.trim();
    try {
      if (!name) throw new Error('צריך לבחור שם לרשימה.');
      if (existing) throw new Error('שינוי שם רשימה אינו נתמך כרגע.');
      const result = await api.action({ entity:'list', action:'create', listName:name });
      state.data = result; queueRefresh(true); closeDialogs(); renderActive(); announce('הרשימה נוצרה.');
    } catch (error) { $('#dialog-error').textContent = error.message; $('#dialog-error').hidden = false; }
  };
}
function openItemDialog(listName, item = null, isTask = false) {
  const fields = [makeField(isTask ? 'מה תרצי לקדם?' : 'מה להוסיף לרשימה?', 'text', 'text', item?.text || '')];
  if (isTask) fields.push(makeField('תאריך יעד (לא חובה)', 'dueDate', 'date', item?.dueAt ? new Date(item.dueAt).toISOString().slice(0, 10) : '', false));
  dialogOpen(item ? 'עריכת פריט' : isTask ? 'משימה חדשה' : 'פריט חדש', fields, 'שמירה');
  $('#edit-form').onsubmit = async (event) => {
    event.preventDefault(); const text = new FormData(event.currentTarget).get('text')?.trim();
    try {
      if (!text) throw new Error('כתבו מה לשמור.');
      const form = new FormData(event.currentTarget);
      if (isTask) {
        const date = form.get('dueDate');
        const dueAt = date ? new Date(`${date}T00:00:00.000Z`).getTime() : null;
        const next = await api.action({ entity: 'item', action: item ? 'update' : 'create', listName, ...(item ? { id: item.id } : {}), text, dueAt });
        state.data = next; renderActive(); announce(item ? 'המשימה עודכנה.' : 'המשימה נוספה.');
        queueRefresh(true);
      } else await perform({ entity:'item', action:item ? 'update':'create', ...(item ? {id:item.id} : {}), listName, text }, item ? 'הפריט עודכן.' : 'הפריט נוסף.');
      closeDialogs();
    } catch (error) { $('#dialog-error').textContent=error.message; $('#dialog-error').hidden=false; }
  };
}
function openTaskCreate() {
  const lists = taskLists();
  if (!lists.length) { openListDialog(); return; }
  if (lists.length === 1) { openItemDialog(lists[0].name, null, true); return; }
  const select = document.createElement('label'); select.className='field'; select.innerHTML='<span>רשימה</span>';
  const choice = document.createElement('select'); choice.name='listName'; lists.forEach((list)=>{const option=document.createElement('option');option.value=list.name;option.textContent=list.name;choice.append(option);});
  select.append(choice);
  dialogOpen('משימה חדשה',[select,makeField('מה תרצי לקדם?','text','text',''),makeField('תאריך יעד (לא חובה)','dueDate','date','',false)],'שמירה','צעד קטן קדימה');
  $('#edit-form').onsubmit = async (event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const text = data.get('text')?.trim();
    try {
      if (!text) throw new Error('כתבו מה לשמור.');
      const date = data.get('dueDate');
      const dueAt = date ? new Date(`${date}T00:00:00.000Z`).getTime() : null;
      state.data = await api.action({ entity:'item', action:'create', listName:data.get('listName'), text, dueAt });
      renderActive(); announce('המשימה נוספה.'); queueRefresh(true); closeDialogs();
    }
    catch(error){$('#dialog-error').textContent=error.message;$('#dialog-error').hidden=false;}
  };
}
function openReminderDialog(reminder = null) {
  const fields = [
    makeField('מה חשוב לזכור?','text','text',reminder?.text || ''),
    makeField('תאריך לפי שעון ישראל','date', 'date', localDate(reminder ? new Date(reminder.dueAt) : new Date(), 'Asia/Jerusalem')),
    makeField('שעה לפי שעון ישראל','time','time',reminder ? localTime(new Date(reminder.dueAt), 'Asia/Jerusalem') : '09:00'),
  ];
  const recurring = document.createElement('label'); recurring.className='field'; recurring.innerHTML='<span><input type="checkbox" name="recurring" id="recurring-toggle"> תזכורת שבועית</span>';
  fields.push(recurring);
  const weekdays = makeField('באילו ימים?','weekdays','weekdays'); weekdays.hidden = !reminder?.recurring || !(reminder?.weekdays?.length); fields.push(weekdays);
  dialogOpen(reminder ? 'עריכת תזכורת':'תזכורת חדשה',fields,'שמירה','בזמן שלך');
  const toggle = $('#recurring-toggle');
  const intervalSeries = Boolean(reminder?.repeatEveryMs && !reminder?.weekdays?.length);
  toggle.checked = Boolean(reminder?.weekdays?.length);
  toggle.disabled = intervalSeries;
  if (intervalSeries) recurring.append(document.createTextNode('המרווח המחזורי הקיים נשמר ללא שינוי.'));
  const picker = $('.weekday-picker');
  if (reminder?.weekdays) $$('input[type="checkbox"]',picker).forEach((check)=>{check.checked=reminder.weekdays.includes(Number(check.value));});
  toggle.onchange=()=>{picker.closest('.field').hidden=!toggle.checked;};
  $('#edit-form').onsubmit = async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const [hour,minute] = String(form.get('time')||'09:00').split(':').map(Number);
    const weekdaysSelected = form.getAll('weekdays').map(Number);
    try {
      const text = form.get('text')?.trim(); if (!text) throw new Error('כתבו מה להזכיר.');
      if (toggle.checked && !weekdaysSelected.length) throw new Error('בחרו לפחות יום אחד לתזכורת השבועית.');
      const body = {entity:'reminder',action:reminder?'update':'create',...(reminder?{id:reminder.id}:{}),text,date:form.get('date'),hour,minute,...(toggle.checked?{weekdays:weekdaysSelected}:{})};
      await perform(body,reminder?'התזכורת עודכנה.':'התזכורת נשמרה.'); closeDialogs();
    } catch(error){$('#dialog-error').textContent=error.message;$('#dialog-error').hidden=false;}
  };
}

$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const profileForm = event.currentTarget; const form = new FormData(profileForm);
  $('#profile-status').textContent='שומרת…';
  try {
    const profile = await api.profile({name:String(form.get('name')).trim(),gender:form.get('gender'),language:form.get('language'),timezone:form.get('timezone')});
    state.data.profile = {...state.data.profile,...profile}; $('#greeting').textContent=profile.name?`היי ${profile.name}`:'המרחב שלי';
    $('#profile-status').textContent='נשמר'; $('#account-note').textContent=profile.access ? `גישה ${profile.access}${profile.expiresAt?` · עד ${dateAt(profile.expiresAt,{dateStyle:'medium'})}`:''}` : '';
    profileForm.dataset.unsaved = 'false';
    queueRefresh(true);
    drainQueuedRefresh();
  } catch(error) { $('#profile-status').textContent=error.message; }
});
document.addEventListener('input', (event) => {
  const form = event.target.closest('form');
  if (form) form.dataset.unsaved = 'true';
});
document.addEventListener('change', (event) => {
  const form = event.target.closest('form');
  if (form) form.dataset.unsaved = 'true';
});
document.addEventListener('focusout', () => window.setTimeout(drainQueuedRefresh, 0));
$$('.nav-item').forEach((button)=>button.addEventListener('click',(event)=>{
  event.preventDefault(); switchTab(button.dataset.tab);
}));
$('#new-list').onclick=()=>openListDialog();
$('#new-reminder').onclick=()=>openReminderDialog();
$('#new-task').onclick=openTaskCreate;
$('#retry-load').onclick=()=>loadData(true);
$('#menu-trigger').onclick=()=>{
  const menu=$('#menu-popover'); menu.hidden=!menu.hidden; $('#menu-trigger').setAttribute('aria-expanded',String(!menu.hidden));
};
document.addEventListener('click',(event)=>{
  if (!event.target.closest('.menu-popover') && !event.target.closest('#menu-trigger')) { $('#menu-popover').hidden=true; $('#menu-trigger').setAttribute('aria-expanded','false'); }
  const menuItem=event.target.closest('[data-menu]');
  if (menuItem?.dataset.menu==='reload') loadData(true);
  if (menuItem?.dataset.menu==='share') sharePage();
  if (event.target.closest('[data-email-link]') || event.target.closest('#locked-link-telegram')) startEmailLink(event.target.closest('[data-email-link]') || $('#locked-link-telegram'));
  if (event.target.closest('[data-email-signout],#locked-email-signout')) window.AhSheliEmailSignOut?.();
  if (event.target.closest('#locked-retry-auth')) loadData(true);
  if (event.target.closest('[data-retry-shares]')) loadShares(true);
  const addShared = event.target.closest('[data-add-shared-item]');
  if (addShared) sharedItemDialog(addShared.dataset.addSharedItem);
  const editShared = event.target.closest('[data-edit-shared-item]');
  if (editShared) {
    const share = state.shares.find((entry) => String(entry.id) === String(editShared.dataset.editSharedItem));
    const item = share?.items?.find((entry) => String(entry.id) === String(editShared.dataset.itemId));
    if (item) sharedItemDialog(editShared.dataset.editSharedItem, item);
  }
  const deleteShared = event.target.closest('[data-delete-shared-item]');
  if (deleteShared && window.confirm('למחוק את הפריט מהרשימה המשותפת?')) {
    const share = state.shares.find((entry) => String(entry.id) === String(deleteShared.dataset.deleteSharedItem));
    deleteShared.disabled = true;
    api.shareAction(deleteShared.dataset.deleteSharedItem, {
      requestId: crypto.randomUUID(), entity: 'item', action: 'delete',
      listName: share?.listName, id: deleteShared.dataset.itemId,
    }).then(() => loadShares(false))
      .then(() => { queueRefresh(true, true); drainQueuedRefresh(); announce('הפריט נמחק מהרשימה המשותפת.'); })
      .catch((error) => { deleteShared.disabled = false; announce(error.message || 'לא הצלחנו למחוק את הפריט.', true); });
  }
  const checkShared = event.target.closest('[data-shared-check]');
  if (checkShared) {
    const share = state.shares.find((entry) => String(entry.id) === String(checkShared.dataset.sharedCheck));
    checkShared.disabled = true;
    api.shareAction(checkShared.dataset.sharedCheck, {
      requestId: crypto.randomUUID(), entity: 'item', action: 'complete',
      listName: share?.listName, id: checkShared.dataset.itemId,
      checked: checkShared.dataset.checked !== 'true',
    }).then(() => loadShares(false))
      .then(() => { queueRefresh(true, true); drainQueuedRefresh(); })
      .catch((error) => { checkShared.disabled = false; announce(error.message || 'לא הצלחנו לעדכן את הפריט.', true); });
  }
  const revokeShare = event.target.closest('[data-revoke-share]');
  if (revokeShare && window.confirm('לבטל את השיתוף של הרשימה הזו?')) {
    revokeShare.disabled = true;
    api.deleteShare(revokeShare.dataset.revokeShare).then(() => loadShares(false))
      .then(() => { queueRefresh(true, true); drainQueuedRefresh(); announce('השיתוף בוטל.'); })
      .catch((error) => { revokeShare.disabled = false; announce(error.message || 'לא הצלחנו לבטל את השיתוף.', true); });
  }
  const close=event.target.closest('[data-close-dialog]'); if(close) closeDialogs();
  if (event.target.closest('[data-new-list]')) openListDialog();
  if (event.target.closest('[data-new-task-list]')) {
    dialogOpen('יצירת רשימת משימות',[makeField('שם הרשימה','listName','text','משימות')],'יצירת רשימה','צעד קטן קדימה');
    $('#edit-form').onsubmit=async(submitEvent)=>{
      submitEvent.preventDefault();const listName=new FormData(submitEvent.currentTarget).get('listName')?.trim();
      if(!['משימות','מטרות'].includes(listName)){ $('#dialog-error').textContent='כדי שהמשימות יוצגו כאן, שם הרשימה צריך להיות משימות או מטרות.';$('#dialog-error').hidden=false;return; }
       try{state.data=await api.action({entity:'list',action:'create',listName});state.taskList=listName;queueRefresh(true);closeDialogs();renderTasks();announce('הרשימה נוצרה.');}
      catch(error){$('#dialog-error').textContent=error.message;$('#dialog-error').hidden=false;}
    };
  }
  const tab = event.target.closest('[data-select-task-list]');
  if(tab){state.taskList=tab.dataset.selectTaskList;renderTasks();}
  const reminderFilter=event.target.closest('[data-reminder-filter]');
  if(reminderFilter){state.reminderFilter=reminderFilter.dataset.reminderFilter;$$('[data-reminder-filter]').forEach((b)=>b.classList.toggle('selected',b===reminderFilter));renderReminders();}
  const taskFilter=event.target.closest('[data-task-filter]');
  if(taskFilter){state.taskFilter=taskFilter.dataset.taskFilter;$$('[data-task-filter]').forEach((b)=>b.classList.toggle('selected',b===taskFilter));renderTasks();}
  const mode=event.target.closest('[data-calendar-view]');
  if(mode){state.calendarMode=mode.dataset.calendarView;$$('[data-calendar-view]').forEach((b)=>b.classList.toggle('selected',b===mode));renderCalendar();}
  const deleteItem=event.target.closest('[data-delete-item]');
  if(deleteItem) confirmAction('למחוק את הפריט?','הפריט יוסר מהרשימה.',{entity:'item',action:'delete',id:deleteItem.dataset.deleteItem,listName:deleteItem.dataset.listName});
  const deleteList=event.target.closest('[data-delete-list]');
  if(deleteList) confirmAction('למחוק את הרשימה?','כל הפריטים שבה יימחקו. אי אפשר לשחזר את הרשימה.',{entity:'list',action:'delete',listName:deleteList.dataset.deleteList});
  const editList=event.target.closest('[data-edit-list]'); if(editList) openListDialog({name:editList.dataset.editList});
  const addItem=event.target.closest('[data-add-item]'); if(addItem) openItemDialog(addItem.dataset.addItem);
  const editItem=event.target.closest('[data-edit-item]'); if(editItem) {
    const list=state.data.lists.find((candidate)=>candidate.name===editItem.dataset.listName);
    const item=list?.items.find((candidate)=>candidate.id===editItem.dataset.editItem); if(item) openItemDialog(list.name,item);
  }
  const toggleItem=event.target.closest('[data-toggle-item]');
  if(toggleItem) perform({entity:'item',action:'update',id:toggleItem.dataset.toggleItem,listName:toggleItem.dataset.listName,checked:!state.data.lists.find((list)=>list.name===toggleItem.dataset.listName)?.items.find((item)=>item.id===toggleItem.dataset.toggleItem)?.checked}).catch(()=>{});
  const taskToggle=event.target.closest('[data-task-toggle]');
  if(taskToggle) perform({entity:'item',action:'update',id:taskToggle.dataset.taskToggle,listName:taskToggle.dataset.listName,checked:!state.data.lists.find((list)=>list.name===taskToggle.dataset.listName)?.items.find((item)=>item.id===taskToggle.dataset.taskToggle)?.checked}).catch(()=>{});
  const taskEdit=event.target.closest('[data-task-edit]'); if(taskEdit){
    const list=state.data.lists.find((candidate)=>candidate.name===taskEdit.dataset.listName);const item=list?.items.find((candidate)=>candidate.id===taskEdit.dataset.taskEdit);if(item)openItemDialog(list.name,item,true);
  }
  const taskDelete=event.target.closest('[data-task-delete]');
  if(taskDelete) confirmAction('למחוק את המשימה?','המשימה תימחק לצמיתות.',{entity:'item',action:'delete',id:taskDelete.dataset.taskDelete,listName:taskDelete.dataset.listName});
  const editReminder=event.target.closest('[data-edit-reminder]'); if(editReminder) openReminderDialog(state.data.reminders.find((r)=>r.id===editReminder.dataset.editReminder));
  const deleteReminder=event.target.closest('[data-delete-reminder]');
  if(deleteReminder){const item=state.data.reminders.find((r)=>r.id===deleteReminder.dataset.deleteReminder);confirmAction('למחוק את התזכורת?',item?.recurring?'התזכורת החוזרת כולה תבוטל.':'התזכורת תימחק.',{entity:'reminder',action:'delete',id:deleteReminder.dataset.deleteReminder});}
  const completeReminder=event.target.closest('[data-complete-reminder]');
  if(completeReminder) perform({entity:'reminder',action:'complete',id:completeReminder.dataset.completeReminder},'התזכורת סומנה כהושלמה.').catch(()=>{});
});
$$('[data-calendar-view]').forEach((button)=>button.addEventListener('click',()=>{}));
$('#calendar-today').onclick=()=>{state.calendarDate=new Date();renderCalendar();fetchEvents();};
$('#calendar-prev').onclick=()=>moveCalendar(-1);
$('#calendar-next').onclick=()=>moveCalendar(1);
function moveCalendar(amount){const date=state.calendarDate;if(state.calendarMode==='month')date.setMonth(date.getMonth()+amount);else date.setDate(date.getDate()+amount*(state.calendarMode==='week'?7:1));renderCalendar();fetchEvents();}
document.addEventListener('click',async(event)=>{
  if(event.target.closest('#connect-calendar')){
    if(location.origin!=='https://yotibot-azbu.onrender.com'){
      const appUrl='https://yotibot-azbu.onrender.com/app.html';
      if(window.Telegram?.WebApp?.openLink)window.Telegram.WebApp.openLink(appUrl);else window.location.assign(appUrl);
      return;
    }
    try{const result=await api.connectCalendar();const url=calendarAuthorizationUrl(result.url);if(window.Telegram?.WebApp?.openLink)window.Telegram.WebApp.openLink(url);else window.location.assign(url);}
    catch(error){announce(error.message,true);}
  }
  if(event.target.closest('#disconnect-calendar')) confirmAction('לנתק את Google Calendar?','רק החיבור של החשבון שלך ינותק.',{entity:'calendar',action:'disconnect'});
});
async function sharePage(){
  // Never share Telegram's signed initData from the URL hash.
  const shareData={title:'אח שלי — המרחב שלי',text:'המרחב האישי שלי לניהול רשימות, תזכורות ומטרות.',url:new URL('index.html',location.href).href};
  try{if(navigator.share)await navigator.share(shareData);else{await navigator.clipboard.writeText(shareData.url);announce('הקישור הועתק.');}}
  catch(error){if(error.name!=='AbortError'){try{await navigator.clipboard.writeText(shareData.url);announce('הקישור הועתק.');}catch{announce('לא הצלחנו לשתף כרגע.',true);}}}
}
document.addEventListener('keydown',(event)=>{if(event.key==='Escape'){$('#menu-popover').hidden=true;}});

// Keep private records in memory only. Refresh quietly on resume and every 30 seconds.
try {
  window.Telegram?.WebApp?.setHeaderColor?.('#07152b');
  window.Telegram?.WebApp?.setBackgroundColor?.('#07152b');
  window.Telegram?.WebApp?.setBottomBarColor?.('#07152b');
} catch { /* Older Telegram clients may not support the newer color methods. */ }
loadData(true);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')loadData(false);});
window.setInterval(()=>{if(document.visibilityState==='visible'&&(state.loaded||state.emailAuth?.signedIn))loadData(false);},30000);
function refreshFromChange() {
  window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(() => {
    if (document.visibilityState === 'visible') {
      queueRefresh(false, state.shareLoaded);
      drainQueuedRefresh();
    }
  }, 320);
}
async function watchChanges() {
  let delay = 1500;
  while (document.visibilityState !== 'unloaded') {
    try {
      const initData = window.Telegram?.WebApp?.initData;
      const response = await fetch('/api/mini-app/changes', {
        headers: initData ? { Authorization: `tma ${initData}` } : {},
        credentials: 'same-origin',
      });
      if (!response.ok || !response.body) throw new Error(`SSE ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      delay = 1500;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
          if (frame.split(/\r?\n/).some((line) => line.startsWith('data:'))) refreshFromChange();
        }
      }
      throw new Error('Change stream ended.');
    } catch {
      await new Promise((resolve) => window.setTimeout(resolve, delay));
      delay = Math.min(delay * 1.7, 30000);
    }
  }
}
