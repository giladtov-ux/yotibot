(() => {
  'use strict';

  const app = window.Telegram && window.Telegram.WebApp;
  const active = Boolean(app && (app.initData || (app.platform && app.platform !== 'unknown')));
  // This bridge controls presentation only. Telegram client data is NOT login proof.
  // The existing private verification code and server-side payment checks remain mandatory.
  const safely = (operation) => { try { operation(); } catch { /* Older clients retain browser behavior. */ } };
  window.AhSheliMiniApp = {
    active,
    openExternal(url) {
      const target = new URL(url);
      if (target.protocol !== 'https:' || target.username || target.password) throw new Error('invalid_external_url');
      const telegram = target.hostname === 't.me';
      const whop = target.hostname === 'whop.com' || target.hostname.endsWith('.whop.com');
      if (!telegram && !whop) throw new Error('invalid_external_host');
      if (active) {
        try {
          if (telegram && typeof app.openTelegramLink === 'function') {
            app.openTelegramLink(target.href);
            return true;
          }
          if (whop && typeof app.openLink === 'function') {
            app.openLink(target.href);
            return true;
          }
        } catch { /* A missing native bridge must not prevent ordinary navigation. */ }
      }
      window.location.assign(target.href);
      return false;
    },
  };
  if (!active) return;

  document.documentElement.classList.add('telegram-mini-app');
  function updateViewport() {
    const style = document.documentElement.style;
    if (Number.isFinite(app.viewportHeight) && app.viewportHeight > 0) {
      style.setProperty('--mini-app-height', `${app.viewportHeight}px`);
    }
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const device = Number(app.safeAreaInset && app.safeAreaInset[side]) || 0;
      const content = Number(app.contentSafeAreaInset && app.contentSafeAreaInset[side]) || 0;
      style.setProperty(`--mini-safe-${side}`, `${Math.max(0, device, content)}px`);
    }
  }
  updateViewport();
  for (const event of ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged']) {
    safely(() => app.onEvent(event, updateViewport));
  }
  safely(() => app.setHeaderColor('#07152b'));
  safely(() => app.setBackgroundColor('#07152b'));
  safely(() => app.setBottomBarColor('#07152b'));
  // Telegram's chat menu background is client-owned. This is the native
  // Mini App action button, which does support the exact brand color.
  safely(() => app.MainButton?.setParams({ color: '#FFD000', text_color: '#080808' }));
  safely(() => app.expand());
  safely(() => app.ready());

  const dialog = document.getElementById('billing-dialog');
  if (dialog && app.BackButton) {
    const updateBack = () => safely(() => dialog.open ? app.BackButton.show() : app.BackButton.hide());
    safely(() => app.BackButton.onClick(() => { if (dialog.open) dialog.close(); }));
    new MutationObserver(updateBack).observe(dialog, { attributes: true, attributeFilter: ['open'] });
    updateBack();
  }
  // Telegram links stay in Telegram rather than replacing the Mini App's document.
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest && event.target.closest('a[href]');
    if (!anchor) return;
    let url;
    try { url = new URL(anchor.href); } catch { return; }
    if (url.protocol !== 'https:' || url.hostname !== 't.me' || url.username || url.password) return;
    event.preventDefault();
    window.AhSheliMiniApp.openExternal(url.href);
  });
})();
