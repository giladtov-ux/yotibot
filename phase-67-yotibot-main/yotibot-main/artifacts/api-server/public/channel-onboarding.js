(() => {
  'use strict';

  const ENDPOINT = 'api/onboarding/channels';
  const CONTROLLER_KEY = '__ahSheliChannelOnboarding';
  const STATUS_COPY = {
    loading: 'טוענים את החיבור ל־Telegram…',
    error: 'לא הצלחנו לטעון את פרטי הבוט. אפשר לנסות שוב.',
    noTelegram: 'קישור הבוט עדיין לא זמין. אפשר לנסות שוב בעוד רגע.'
  };

  if (window[CONTROLLER_KEY]) return;

  const state = { result: null, loading: false, error: '', requestId: 0 };
  let homepageRegistrationButton = null;
  const externalUrl = (value) => {
    if (!value) return '';
    try {
      const parsed = new URL(value, window.location.href);
      return parsed.href === 'https://t.me/AhSheli_Reminder_bot'
        ? parsed.href
        : '';
    } catch (_) {
      return '';
    }
  };
  const telegramWebApp = () => window.Telegram && window.Telegram.WebApp;

  async function loadChannels() {
    const requestId = ++state.requestId;
    state.loading = true;
    state.error = '';
    renderAll();

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(ENDPOINT, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        signal: controller.signal,
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('channel_request_failed');
      const payload = await response.json();
      if (requestId !== state.requestId) return;
      state.result = {
        telegram: {
          available: payload && payload.telegram && payload.telegram.available === true,
          url: externalUrl(payload && payload.telegram && payload.telegram.url)
        }
      };
      state.loading = false;
      renderAll();
    } catch (_) {
      if (requestId !== state.requestId) return;
      state.loading = false;
      state.error = 'error';
      renderAll();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content) node.textContent = content;
    return node;
  }

  function serviceStatus() {
    if (state.loading) return STATUS_COPY.loading;
    if (state.error) return STATUS_COPY.error;
    return 'נרשמים כאן באתר, או פותחים את אח שלי ב־Telegram.';
  }

  function makeRetry() {
    const retry = element('button', 'onboard-retry', 'לנסות שוב');
    retry.type = 'button';
    retry.addEventListener('click', loadChannels);
    return retry;
  }

  function makeStatus() {
    const status = element('p', 'onboard-status');
    status.setAttribute('role', state.error ? 'alert' : 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = state.error ? STATUS_COPY.error : serviceStatus();
    return status;
  }

  function renderChoice(panel, channel, appMode) {
    const stateMessage = makeStatus();
    if (channel === 'telegram' && !state.loading && !state.error) {
      stateMessage.textContent = appMode
        ? 'ממשיכים לשיחה עם אח שלי ב־Telegram.'
        : 'נרשמים כאן באתר, או פותחים את הבוט ב־Telegram.';
    }
    panel.append(stateMessage);

    if (!appMode && channel === 'telegram') {
      if (!homepageRegistrationButton) {
        homepageRegistrationButton = element('button', 'onboard-action onboard-action-secondary', 'הרשמה לתוכנית Pro');
        homepageRegistrationButton.type = 'button';
        homepageRegistrationButton.dataset.openRegistration = '';
        homepageRegistrationButton.dataset.plan = 'Pro';
      }
      panel.append(homepageRegistrationButton);
    }

    if (state.loading) return;
    if (state.error) {
      panel.append(makeRetry());
      return;
    }

    const result = state.result;
    if (!result) return;
    if (channel === 'telegram') {
      if (result.telegram.available && result.telegram.url) {
        const link = element('a', 'onboard-action onboard-action-primary', 'פתיחת הבוט ב־Telegram');
        link.href = result.telegram.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        if (appMode) {
          link.addEventListener('click', (event) => {
            const webApp = telegramWebApp();
            if (!webApp?.initData || typeof webApp.openTelegramLink !== 'function') return;
            event.preventDefault();
            try {
              webApp.openTelegramLink(result.telegram.url);
            } catch (_) {
              window.open(result.telegram.url, '_blank', 'noopener,noreferrer');
            }
          });
        }
        panel.append(link);
      } else {
        const unavailable = element('p', 'onboard-note', STATUS_COPY.noTelegram);
        panel.append(unavailable, makeRetry());
      }
      return;
    }

  }

  function renderTabs(host, appMode) {
    const selected = host.dataset.channel || 'telegram';
    host.querySelectorAll('[data-onboard-tab]').forEach((tab) => {
      const active = tab.dataset.onboardTab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    host.querySelectorAll('[data-onboard-panel]').forEach((panel) => {
      const active = panel.dataset.onboardPanel === selected;
      panel.hidden = !active;
      if (active) {
        panel.replaceChildren();
        renderChoice(panel, selected, appMode);
      }
    });
    host.classList.toggle('onboard-mini-app', appMode);
  }

  function buildChooser(host, appMode) {
    host.dataset.channel = 'telegram';
    const tabs = element('div', 'onboard-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'חיבור Telegram');
    const content = element('div', 'onboard-content');
    ['telegram'].forEach((channel) => {
      const label = 'Telegram';
      const tab = element('button', 'onboard-tab', label);
      tab.type = 'button';
      tab.dataset.onboardTab = channel;
      tab.id = `${host.id}-${channel}-tab`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', `${host.id}-${channel}-panel`);
      tab.addEventListener('click', () => {
        host.dataset.channel = channel;
        renderTabs(host, appMode);
      });
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = 'telegram';
        host.dataset.channel = next;
        renderTabs(host, appMode);
        host.querySelector(`[data-onboard-tab="${next}"]`).focus();
      });
      tabs.append(tab);
      const panel = element('section', 'onboard-channel-panel');
      panel.dataset.onboardPanel = channel;
      panel.id = `${host.id}-${channel}-panel`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      content.append(panel);
    });
    host.replaceChildren(tabs, content);
    renderTabs(host, appMode);
  }

  function ensureHomepageChooser() {
    const card = document.querySelector('#personal-area .personal-card');
    if (!card || card.querySelector('[data-onboard-home]')) return;
    const copy = card.querySelector(':scope > div');
    if (copy) {
      const title = copy.querySelector('#personal-title');
      const stamp = copy.querySelector('.demo-stamp');
      if (stamp) stamp.textContent = 'הרשמה / כניסה';
      const paragraphs = copy.querySelectorAll('p');
      if (title) title.textContent = 'מתחילים עם אח שלי ב־Telegram.';
      if (paragraphs[0]) paragraphs[0].textContent = 'פותחים את @AhSheli_Reminder_bot וממשיכים עם העוזר האישי שלכם.';
      if (paragraphs[1]) paragraphs[1].textContent = 'אותו חשבון, אותן רשימות ואותו לו״ז — בהודעות, בתזכורות ובסיכומים.';
    }
    const form = card.querySelector('#personal-email-form');
    if (form) {
      form.classList.add('onboard-email-hidden');
      form.setAttribute('aria-hidden', 'true');
      form.querySelectorAll('input, button, select, textarea').forEach((control) => {
        control.tabIndex = -1;
      });
    }
    const chooser = element('section', 'onboard-chooser');
    chooser.id = 'onboard-home-chooser';
    chooser.dataset.onboardHome = '';
    chooser.setAttribute('aria-label', 'חיבור לבוט Telegram');
    card.append(chooser);
    buildChooser(chooser, false);
  }

  function createAppDialog() {
    const dialog = document.createElement('dialog');
    dialog.className = 'onboard-dialog';
    dialog.id = 'onboard-app-dialog';
    dialog.setAttribute('aria-labelledby', 'onboard-app-title');
    const shell = element('div', 'onboard-dialog-shell');
    const head = element('div', 'onboard-dialog-head');
    const title = element('h2', '', 'חיבור לבוט Telegram');
    title.id = 'onboard-app-title';
    const close = element('button', 'onboard-close', 'סגירה');
    close.type = 'button';
    close.setAttribute('aria-label', 'סגירת חלון חיבור Telegram');
    close.addEventListener('click', () => dialog.close());
    head.append(title, close);
    const chooser = element('section', 'onboard-chooser onboard-app-chooser');
    chooser.id = 'onboard-app-chooser';
    chooser.setAttribute('aria-label', 'חיבור לבוט Telegram');
    shell.append(head, chooser);
    dialog.append(shell);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      dialog.close();
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((node) => !node.hidden && node.getClientRects().length);
      if (!focusable.length) {
        event.preventDefault();
        close.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    document.body.append(dialog);
    buildChooser(chooser, true);
    return { dialog, close };
  }

  function ensureMiniAppChooser() {
    const menu = document.getElementById('menu-popover');
    if (!menu || menu.querySelector('[data-onboard-open]')) return;
    const openButton = element('button', '', 'פתיחת הבוט ב־Telegram');
    openButton.type = 'button';
    openButton.dataset.onboardOpen = '';
    openButton.setAttribute('aria-haspopup', 'dialog');
    menu.append(openButton);
    const { dialog, close } = createAppDialog();
    let previousFocus = null;
    openButton.addEventListener('click', () => {
      previousFocus = document.getElementById('menu-trigger') || openButton;
      if (menu) menu.hidden = true;
      const trigger = document.getElementById('menu-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      dialog.showModal();
      close.focus();
    });
    dialog.addEventListener('close', () => {
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
      else openButton.focus();
    });
  }

  function renderAll() {
    document.querySelectorAll('[data-onboard-home], #onboard-app-chooser').forEach((host) => {
      renderTabs(host, host.id === 'onboard-app-chooser');
    });
  }

  function initialize() {
    ensureHomepageChooser();
    ensureMiniAppChooser();
    const personalArea = document.getElementById('personal-area');
    if (personalArea) {
      const showOnboarding = () => {
        history.replaceState(history.state, '', '#personal-area');
        personalArea.querySelector('[data-onboard-tab][aria-selected="true"]')?.focus({ preventScroll: true });
        // "auto" inherits the page's smooth scrolling; this entry must be immediate.
        personalArea.scrollIntoView({ behavior: 'instant', block: 'start' });
      };
      document.querySelectorAll('a[href="#personal-area"]').forEach(link => {
        link.addEventListener('click', event => { event.preventDefault(); showOnboarding(); });
      });
      if (window.AhSheliOnboardingRequested) requestAnimationFrame(showOnboarding);
    }
    if (document.querySelector('[data-onboard-home], #onboard-app-chooser')) loadChannels();
  }

  window[CONTROLLER_KEY] = { load: loadChannels };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
