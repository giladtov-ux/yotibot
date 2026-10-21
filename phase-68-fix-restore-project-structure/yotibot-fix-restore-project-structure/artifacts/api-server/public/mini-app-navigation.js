(() => {
  const brand = document.querySelector('a.brand');
  if (!brand) return;
  // Explicit website entry bypasses the landing page's Mini App redirect.
  // Never copy private Telegram launch data into an external browser.
  const target = new URL('index.html?onboarding=1', window.location.href);
  brand.href = target.href;
  brand.addEventListener('click', (event) => {
    if (event.button > 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const app = window.Telegram?.WebApp;
    if (!window.AhSheliMiniApp?.active || typeof app?.openLink !== 'function') return;
    try {
      app.openLink(target.href);
      event.preventDefault();
    } catch {
      // Keep the native target="_blank" link working if the SDK is unavailable.
    }
  });
})();
