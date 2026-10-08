const PREFIX = 'preview:';
const MAX_BYTES = 7 * 1024 * 1024;
const timers = new Map();
const revisions = new Map();
let captureQueue = Promise.resolve();
let lastCapture = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const keyFor = id => `${PREFIX}${id}`;
const tabRevision = id => revisions.get(id) || 0;
const invalidate = id => revisions.set(id, tabRevision(id) + 1);
let menuAction = false;
const menuCleanup = new Map();
const overlayKey = windowId => `overlay:${windowId}`;
const openingMenus = new Map();

function openMenu(windowId) {
  if (openingMenus.has(windowId)) return openingMenus.get(windowId);
  const opening = (async () => {
    const win = await chrome.windows.get(windowId).catch(() => null);
    if (!win?.focused) return;
    // Choose the final surface before creating any visible UI. No native-popup trampoline.
    if (await showOverlay(windowId)) return;
    const currentWindow = await chrome.windows.get(windowId).catch(() => null);
    if (!currentWindow?.focused) return;
    const [tab] = await chrome.tabs.query({windowId,active:true});
    if (!tab) return;
    // Only the actual fallback needs a native popup. Clear its temporary binding afterwards,
    // so a later toolbar click (including after navigation) always goes through onClicked.
    await chrome.action.setPopup({tabId:tab.id,popup:'popup.html'});
    try { await chrome.action.openPopup({windowId}); }
    finally { await chrome.action.setPopup({tabId:tab.id,popup:''}).catch(() => {}); }
  })().finally(() => openingMenus.delete(windowId));
  openingMenus.set(windowId, opening);
  return opening;
}

chrome.action.onClicked.addListener(tab => {
  if (tab?.windowId !== undefined) openMenu(tab.windowId).catch(error => console.warn('页览打开失败:',error.message));
});

async function hideOverlay(windowId) {
  const key = overlayKey(windowId);
  const state = (await chrome.storage.session.get(key))[key];
  if (!state) return;
  await chrome.storage.session.remove(key);
  await chrome.tabs.sendMessage(state.tabId, {type:'overlay-hide', token:state.token}).catch(() => {});
}

async function showOverlay(windowId) {
  const [tab] = await chrome.tabs.query({windowId, active:true});
  if (!tab || !/^https?:/.test(tab.url || '')) return false;
  try {
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['overlay.js']});
    await hideOverlay(windowId);
    // Capture before showing the floating menu; never put our own interface into a preview.
    captureQueue = captureQueue.then(() => capture(windowId)).catch(() => {});
    await captureQueue;
    const current = await chrome.tabs.get(tab.id);
    if (!current.active || current.url !== tab.url) return false;
    const state = {tabId:tab.id,token:crypto.randomUUID()};
    await chrome.storage.session.set({[overlayKey(windowId)]:state});
    const response = await chrome.tabs.sendMessage(tab.id,{type:'overlay-show',token:state.token});
    if (!response?.ok) throw new Error('浮层未打开');
    // Script injection alone does not prove that a site's frame policy allowed the UI to load.
    for (let attempt = 0; attempt < 20; attempt++) {
      await delay(60);
      const mounted = (await chrome.storage.session.get(overlayKey(windowId)))[overlayKey(windowId)];
      if (mounted?.token !== state.token) return false;
      if (mounted.ready) return true;
    }
    throw new Error('浮层加载未完成');
  } catch {
    await hideOverlay(windowId);
    return false;
  }
}

async function trustedPanel(sender) {
  let url;
  try { url = new URL(sender.url); } catch { return false; }
  if (url.origin !== new URL(chrome.runtime.getURL('popup.html')).origin || url.pathname !== '/popup.html') return false;
  if (!sender.tab) return !url.search;
  const state = (await chrome.storage.session.get(overlayKey(sender.tab.windowId)))[overlayKey(sender.tab.windowId)];
  return url.searchParams.get('embed') === '1' && state?.tabId === sender.tab.id && state.token === url.searchParams.get('token');
}

async function menuOperation(message) {
  if (menuAction) throw new Error('上一个操作尚未完成');
  menuAction = true;
  const { windowId, action, tabId } = message;
  const stateKey = `menu:${windowId}`;
  clearTimeout(menuCleanup.get(windowId));
  try {
    if (!Number.isInteger(windowId)) throw new Error('窗口无效');
    if (!['activate', 'close', 'new'].includes(action)) throw new Error('未知操作');
    let changesActiveTab = action === 'new';
    if (action !== 'new') {
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId !== windowId) throw new Error('标签页已移到其他窗口');
      changesActiveTab = action === 'activate' ? !tab.active : tab.active;
    }
    await chrome.storage.session.set({ [stateKey]: {
      query: String(message.query || '').slice(0, 2000),
      scrollTop: Math.max(0, Number(message.scrollTop) || 0),
      until: Date.now() + 5000
    } });
    if (changesActiveTab) await hideOverlay(windowId);
    if (action === 'activate') await chrome.tabs.update(tabId, { active: true });
    if (action === 'close') await chrome.tabs.remove(tabId);
    if (action === 'new') await chrome.tabs.create({ windowId, active: true });
    if (!changesActiveTab) return;
    // Edge destroys action popups on tab activation. Restore from the worker, which survives it.
    // When closing a background tab the original popup survives, so do not open a second one.
    for (const wait of [80, 120, 200, 300]) {
      await delay(wait);
      const win = await chrome.windows.get(windowId).catch(() => null);
      if (!win?.focused) break;
      const contexts = await chrome.runtime.getContexts({ contextTypes:['POPUP'] });
      if (contexts.length) continue;
      try { await openMenu(windowId); break; }
      catch(error) { if (wait === 300) throw error; }
    }
  } finally {
    menuAction = false;
    // The replacement popup has already read its one-shot restore state at this point.
    menuCleanup.set(windowId, setTimeout(() => {
      menuCleanup.delete(windowId);
      chrome.storage.session.remove(stateKey).catch(() => {});
    }, 1500));
  }
}

async function iconFor(count) {
  const images = {};
  for (const size of [16, 32]) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.scale(size / 32, size / 32);
    ctx.strokeStyle = '#6198f5';
    ctx.lineWidth = 2.7;
    ctx.beginPath();
    ctx.roundRect(3, 3, 26, 26, 4);
    ctx.stroke();
    ctx.fillStyle = '#6198f5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = count > 999 ? '999+' : String(count);
    ctx.font = `700 ${label.length > 3 ? 9 : label.length > 2 ? 12 : 17}px Arial`;
    ctx.fillText(label, 16, 17);
    images[size] = ctx.getImageData(0, 0, size, size);
  }
  return images;
}

async function updateWindowIcon(windowId) {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    const active = tabs.find(t => t.active);
    if (!active) return;
    await chrome.action.setIcon({ tabId: active.id, imageData: await iconFor(tabs.length) });
    await chrome.action.setTitle({ tabId: active.id, title: `页览 · ${tabs.length} 个标签页` });
  } catch { /* The window may already have closed. */ }
}

async function storePreview(tab, data, revision) {
  const current = await chrome.tabs.get(tab.id).catch(() => null);
  if (!current || current.url !== tab.url || tabRevision(tab.id) !== revision) return;
  const all = await chrome.storage.session.get(null);
  const entries = Object.entries(all).filter(([key]) => key.startsWith(PREFIX) && key !== keyFor(tab.id));
  let used = entries.reduce((sum, [key, value]) => sum + 2 * (key.length + JSON.stringify(value).length), 0);
  const value = { data, url: tab.url, time: Date.now() };
  const bytes = 2 * (keyFor(tab.id).length + JSON.stringify(value).length);
  const remove = [];
  entries.sort((a, b) => a[1].time - b[1].time);
  for (const [key, old] of entries) {
    if (used + bytes <= MAX_BYTES) break;
    remove.push(key);
    used -= 2 * (key.length + JSON.stringify(old).length);
  }
  if (remove.length) await chrome.storage.session.remove(remove);
  if (tabRevision(tab.id) !== revision) return;
  await chrome.storage.session.set({ [keyFor(tab.id)]: value });
  // Close/navigation can race the asynchronous write. Never leave the stale image behind.
  const after = await chrome.tabs.get(tab.id).catch(() => null);
  if (!after || after.url !== tab.url || tabRevision(tab.id) !== revision) {
    await chrome.storage.session.remove(keyFor(tab.id));
  }
}

async function capture(windowId) {
  await delay(Math.max(0, 650 - (Date.now() - lastCapture)));
  const win = await chrome.windows.get(windowId).catch(() => null);
  if (!win || !win.focused || win.state === 'minimized') return;
  const [tab] = await chrome.tabs.query({ windowId, active: true });
  if (!tab || tab.incognito || tab.discarded || tab.status !== 'complete') return;
  const overlay = (await chrome.storage.session.get(overlayKey(windowId)))[overlayKey(windowId)];
  if (overlay?.tabId === tab.id) return;
  const revision = tabRevision(tab.id);
  try {
    lastCapture = Date.now();
    const raw = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 65 });
    const [activeAfter] = await chrome.tabs.query({ windowId, active: true });
    if (!activeAfter || activeAfter.id !== tab.id || activeAfter.url !== tab.url || tabRevision(tab.id) !== revision) return;
    const decoded = atob(raw.slice(raw.indexOf(',') + 1));
    const blob = new Blob([Uint8Array.from(decoded, char => char.charCodeAt(0))], { type:'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    // Crop the visible viewport to 16:9, keeping the top of the page rather than stretching it.
    const canvas = new OffscreenCanvas(480, 270);
    const ctx = canvas.getContext('2d');
    const cropWidth = Math.min(bitmap.width, bitmap.height * 16 / 9);
    const cropHeight = cropWidth * 9 / 16;
    ctx.drawImage(bitmap, (bitmap.width - cropWidth) / 2, 0, cropWidth, cropHeight, 0, 0, 480, 270);
    bitmap.close();
    const small = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
    const bytes = new Uint8Array(await small.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    await storePreview(tab, `data:image/jpeg;base64,${btoa(binary)}`, revision);
  } catch { /* Restricted pages have an honest placeholder; capture failure is not a fake preview. */ }
}

function scheduleCapture(windowId, wait = 450) {
  clearTimeout(timers.get(windowId));
  timers.set(windowId, setTimeout(() => {
    timers.delete(windowId);
    captureQueue = captureQueue.then(() => capture(windowId)).catch(() => {});
  }, wait));
}

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  // Invalidate an in-flight capture even if a user switches away and back very quickly.
  invalidate(tabId);
  if (!menuAction) hideOverlay(windowId).catch(() => {});
  updateWindowIcon(windowId);
  scheduleCapture(windowId);
});
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (change.url || change.status === 'loading') {
    invalidate(id);
    chrome.storage.session.remove(keyFor(id)).catch(() => {});
    if (tab.active && !menuAction) hideOverlay(tab.windowId).catch(() => {});
  }
  if (tab.active && (change.status === 'complete' || change.url)) scheduleCapture(tab.windowId, 650);
});
chrome.tabs.onCreated.addListener(tab => updateWindowIcon(tab.windowId));
chrome.tabs.onRemoved.addListener((id, info) => {
  invalidate(id);
  chrome.storage.session.remove(keyFor(id)).catch(() => {});
  if (!menuAction) chrome.storage.session.get(overlayKey(info.windowId)).then(saved => {
    if (saved[overlayKey(info.windowId)]?.tabId === id) hideOverlay(info.windowId);
  }).catch(() => {});
  if (!info.isWindowClosing) updateWindowIcon(info.windowId);
});
chrome.tabs.onAttached.addListener((id, info) => updateWindowIcon(info.newWindowId));
chrome.tabs.onDetached.addListener((id, info) => updateWindowIcon(info.oldWindowId));
chrome.windows.onFocusChanged.addListener(id => {
  if (id >= 0) { updateWindowIcon(id); scheduleCapture(id); }
});
chrome.windows.onRemoved.addListener(id => {
  clearTimeout(timers.get(id)); timers.delete(id);
  clearTimeout(menuCleanup.get(id)); menuCleanup.delete(id);
  chrome.storage.session.remove(`menu:${id}`).catch(() => {});
  chrome.storage.session.remove(overlayKey(id)).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'page-activity' && sender.tab) {
    if (sender.frameId === 0 && sender.tab.active && !sender.tab.incognito) scheduleCapture(sender.tab.windowId, 150);
    return false;
  }
  (async () => {
    if (message?.type === 'overlay-dismissed' && sender.tab) {
      const key = overlayKey(sender.tab.windowId);
      const state = (await chrome.storage.session.get(key))[key];
      if (state?.tabId === sender.tab.id && state.token === message.token) {
        await hideOverlay(sender.tab.windowId);
        scheduleCapture(sender.tab.windowId);
      }
      return {ok:true};
    }
    if (!await trustedPanel(sender)) return {ok:false,error:'菜单来源无效'};
    if (!Number.isInteger(message.windowId)) return {ok:false,error:'窗口无效'};
    if (sender.tab && sender.tab.windowId !== message.windowId) return {ok:false,error:'窗口不匹配'};
    if (message.type === 'panel-init') {
      if (sender.tab) {
        const key = overlayKey(message.windowId);
        const state = (await chrome.storage.session.get(key))[key];
        if (!state) return {ok:false,error:'浮层已关闭'};
        return {ok:true,redirected:false};
      }
      return {ok:true,redirected:false};
    }
    if (message.type === 'panel-dismiss') {
      await hideOverlay(message.windowId); scheduleCapture(message.windowId); return {ok:true};
    }
    if (message.type === 'panel-size' && sender.tab) {
      const state = (await chrome.storage.session.get(overlayKey(message.windowId)))[overlayKey(message.windowId)];
      await chrome.tabs.sendMessage(sender.tab.id,{type:'overlay-size',token:state.token,height:message.height});
      await chrome.storage.session.set({[overlayKey(message.windowId)]:{...state,ready:true}});
      return {ok:true};
    }
    if (message.type === 'menu-operation') { await menuOperation(message); return {ok:true}; }
    if (message.type === 'refresh') {
      scheduleCapture(message.windowId, 0); updateWindowIcon(message.windowId); return {ok:true};
    }
    return {ok:false,error:'未知操作'};
  })().then(respond,error=>respond({ok:false,error:error.message}));
  return true;
});

async function initialize() {
  const tabs = await chrome.tabs.query({});
  const live = new Set(tabs.map(tab => keyFor(tab.id)));
  const saved = await chrome.storage.session.get(null);
  await chrome.storage.session.remove(Object.keys(saved).filter(key => key.startsWith(PREFIX) && !live.has(key)));
  for (const id of new Set(tabs.map(tab => tab.windowId))) updateWindowIcon(id);
  const active = tabs.find(tab => tab.active && !tab.incognito);
  if (active) scheduleCapture(active.windowId);
}
initialize().catch(() => {});
