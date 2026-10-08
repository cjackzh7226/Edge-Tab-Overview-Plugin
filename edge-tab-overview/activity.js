// Signals only: no page text, form values, or DOM content leaves this script.
(() => {
  let timer;
  let lastSent = 0;
  const request = () => {
    if (document.visibilityState !== 'visible') return;
    const wait = Math.max(0, 1200 - (Date.now() - lastSent));
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      lastSent = Date.now();
      chrome.runtime.sendMessage({ type: 'page-activity' }).catch(() => {});
    }, wait);
  };
  let scrollTimer;
  addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(request, 350);
  }, { passive: true, capture: true });
  addEventListener('resize', request, { passive: true });
  addEventListener('pageshow', request);
  document.addEventListener('visibilitychange', request);
  // Refresh changing content while visible without a high-frequency capture loop.
  setInterval(request, 6000);
  request();
})();
