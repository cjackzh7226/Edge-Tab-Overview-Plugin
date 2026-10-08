// Runs in an isolated content-script world. The page never receives tab data/messages.
(() => {
  if (globalThis.__pageOverviewOverlay) return;
  globalThis.__pageOverviewOverlay = true;
  let root, panel, frame, token;
  const media = matchMedia('(prefers-color-scheme: dark)');
  function tint() {
    if (!panel) return;
    panel.style.background = media.matches ? 'rgba(20,29,44,.66)' : 'rgba(248,252,255,.64)';
    panel.style.borderColor = media.matches ? 'rgba(220,236,255,.28)' : 'rgba(255,255,255,.8)';
  }
  function dismiss(notify = true) {
    if (!root) return;
    const previousToken = token;
    root.remove(); root = panel = frame = null; token = null;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', keydown, true);
    if (notify) chrome.runtime.sendMessage({ type:'overlay-dismissed', token:previousToken }).catch(() => {});
  }
  function outside(event) {
    if (root && !event.composedPath().includes(root)) dismiss();
  }
  function keydown(event) { if (event.key === 'Escape') dismiss(); }
  media.addEventListener('change', tint);
  addEventListener('pagehide', () => dismiss());
  addEventListener('resize', () => {
    if (!frame) return;
    const maxHeight = Math.max(160, Math.min(600, innerHeight - 32));
    panel.style.maxHeight = `${maxHeight}px`;
    frame.style.maxHeight = `${maxHeight}px`;
    frame.contentWindow?.postMessage({type:'overview-viewport',token,height:Math.max(160,maxHeight - 2)},chrome.runtime.getURL('').slice(0,-1));
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message.type === 'overlay-hide') {
      if (!message.token || token === message.token) dismiss(false);
      respond({ok:true}); return false;
    }
    if (message.type === 'overlay-size' && message.token === token && frame) {
      const height = Math.max(160, Math.min(600, innerHeight - 32, message.height));
      frame.style.height = `${height}px`;
      panel.style.visibility = 'visible';
      if (!frame.dataset.focused) {
        frame.dataset.focused = 'true';
        setTimeout(() => frame?.focus(), 180);
      }
      respond({ok:true}); return false;
    }
    if (message.type !== 'overlay-show') return false;
    dismiss(false);
    token = message.token;
    root = document.createElement('div');
    root.setAttribute('popover', 'manual');
    root.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;margin:0!important;padding:0!important;border:0!important;width:100vw!important;height:100dvh!important;background:transparent!important;pointer-events:none!important;overflow:visible!important;z-index:2147483647!important;color-scheme:normal!important;';
    const shadow = root.attachShadow({mode:'closed'});
    const style = document.createElement('style');
    style.textContent = ':host::backdrop{background:transparent!important;pointer-events:none!important}';
    shadow.append(style);
    panel = document.createElement('section');
    panel.setAttribute('aria-label', '页览标签页菜单');
    panel.style.cssText = 'position:absolute;right:16px;top:16px;width:min(1051px,calc(100vw - 32px));max-height:calc(100dvh - 32px);box-sizing:border-box;overflow:hidden;border:1px solid;border-radius:24px;pointer-events:auto;backdrop-filter:blur(12px) saturate(1.35);box-shadow:0 16px 56px rgba(0,12,32,.28),inset 0 1px 0 rgba(255,255,255,.55);';
    panel.style.visibility = 'hidden';
    tint();
    frame = document.createElement('iframe');
    frame.title = '页览 · 标签页预览';
    frame.style.cssText = 'display:block;width:100%;height:600px;max-height:calc(100dvh - 34px);border:0;background:transparent;color-scheme:only light;';
    const url = new URL(chrome.runtime.getURL('popup.html'));
    url.searchParams.set('embed','1'); url.searchParams.set('token', token);
    url.searchParams.set('height', String(Math.max(160, Math.min(600, innerHeight - 34))));
    frame.src = url.href;
    panel.append(frame); shadow.append(panel); document.documentElement.append(root);
    try { root.showPopover(); } catch { /* z-index fallback for older page environments. */ }
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown, true);
    respond({ok:true}); return false;
  });
})();
