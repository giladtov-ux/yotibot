(() => {
  if (new URLSearchParams(window.location.search).get('onboarding') === '1') return;
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  // These URL hints select the interface only; the API still verifies signed initData.
  const nativeEntry = hash.has('tgWebAppData') || query.has('tgWebAppData')
    || hash.has('tgWebAppPlatform') || query.has('tgWebAppPlatform');
  if (window.AhSheliMiniApp?.active || nativeEntry) {
    const target = new URL('app.html', window.location.href);
    target.search = window.location.search;
    target.hash = window.location.hash;
    window.location.replace(target.href);
  }
})();
