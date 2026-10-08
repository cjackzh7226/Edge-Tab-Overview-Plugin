const $ = selector => document.querySelector(selector);
const grid = $('#cards');
const scroller = $('#scroller');
const search = $('#search');
const nodes = new Map();
let tabs = [];
let previews = {};
let windowId;
let refreshVersion = 0;
let errorTimer;
const fallbackIcon = chrome.runtime.getURL('icons/site.svg');
const embedded = new URL(location.href).searchParams.get('embed') === '1';
let lastPanelHeight = 0;
let authorized = false;
if (embedded) {
  document.documentElement.classList.add('embedded');
  const available = Number(new URL(location.href).searchParams.get('height'));
  if (available >= 160) document.documentElement.style.setProperty('--popup-height', `${Math.min(600, available)}px`);
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.type !== 'overview-viewport' || event.data.token !== new URL(location.href).searchParams.get('token')) return;
    const height = Number(event.data.height);
    if (!Number.isFinite(height)) return;
    document.documentElement.style.setProperty('--popup-height', `${Math.max(160,Math.min(600,height))}px`);
    render();
  });
}

function dismissPanel() {
  if (embedded) chrome.runtime.sendMessage({type:'panel-dismiss',windowId}).catch(() => {});
  else window.close();
}

async function operate(action, tabId) {
  const result = await chrome.runtime.sendMessage({
    type:'menu-operation', action, tabId, windowId,
    query:search.value, scrollTop:scroller.scrollTop
  });
  if (!result?.ok) throw new Error(result?.error || '操作没有完成');
  await refresh();
}

function report(error) {
  $('#error').textContent = error?.message || '操作没有完成，请重试';
  $('#error').hidden = false;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { $('#error').hidden = true; }, 3500);
}

function createCard(tab) {
  const card = $('#card-template').content.firstElementChild.cloneNode(true);
  card.dataset.id = String(tab.id);
  card.querySelector('.activate').addEventListener('click', async () => {
    try {
      await operate('activate', tab.id);
    } catch(error) { report(error); refresh(); }
  });
  card.querySelector('.close').addEventListener('click', async () => {
    try { await operate('close', tab.id); }
    catch(error) { report(error); refresh(); }
  });
  card.querySelector('.favicon').addEventListener('error', event => {
    if (event.target.src !== fallbackIcon) event.target.src = fallbackIcon;
  });
  card.querySelector('.thumbnail').addEventListener('error', () => {
    card.querySelector('.thumbnail').hidden = true;
    card.querySelector('.placeholder').hidden = false;
  });
  return card;
}

function render() {
  if (!authorized) return;
  const scrollTop = scroller.scrollTop;
  const query = search.value.trim().toLocaleLowerCase();
  const visible = tabs.filter(tab => `${tab.title || ''}\n${tab.url || ''}`.toLocaleLowerCase().includes(query));
  const visibleIds = new Set(visible.map(tab => tab.id));
  for (const [id, card] of nodes) {
    if (!visibleIds.has(id)) { card.remove(); nodes.delete(id); }
  }
  for (const [index, tab] of visible.entries()) {
    let card = nodes.get(tab.id);
    if (!card) { card = createCard(tab); nodes.set(tab.id, card); }
    if (grid.children[index] !== card) grid.insertBefore(card, grid.children[index] || null);
    card.classList.toggle('current', tab.active);
    const title = tab.title || '未命名标签页';
    const activate = card.querySelector('.activate');
    activate.title = `${title}\n${tab.url || ''}`;
    activate.setAttribute('aria-label', `${tab.active ? '当前标签页：' : '切换到：'}${title}`);
    activate.setAttribute('aria-current', tab.active ? 'page' : 'false');
    card.querySelector('.title').textContent = title;
    card.querySelector('.close').setAttribute('aria-label', `关闭：${title}`);
    card.querySelector('.close').title = `关闭 ${title}`;
    const favicon = card.querySelector('.favicon');
    const icon = tab.favIconUrl || fallbackIcon;
    if (favicon.dataset.source !== icon) { favicon.dataset.source = icon; favicon.src = icon; }
    const preview = previews[`preview:${tab.id}`];
    const hasPreview = Boolean(preview?.data && preview.url === tab.url);
    const img = card.querySelector('.thumbnail');
    if (hasPreview && img.src !== preview.data) img.src = preview.data;
    if (!hasPreview) img.removeAttribute('src');
    img.hidden = !hasPreview;
    card.querySelector('.placeholder').hidden = hasPreview;
    card.querySelector('.preview').title = hasPreview ? `最近浏览画面 · ${new Date(preview.time).toLocaleTimeString('zh-CN')}` : '尚无预览；浏览普通网页后会自动更新，部分浏览器页面不支持预览';
  }
  $('#empty').hidden = visible.length !== 0;
  $('#count').textContent = query ? `${visible.length} / ${tabs.length} 个标签页` : `当前窗口 · ${tabs.length} 个标签页`;
  // At most four rows; the native popup height limit may show fewer enlarged cards.
  const first = grid.firstElementChild;
  const gap = parseFloat(getComputedStyle(grid).rowGap);
  scroller.style.maxHeight = first ? `${first.getBoundingClientRect().height * 4 + gap * 3 + 6}px` : '186px';
  scroller.scrollTop = scrollTop;
  setTimeout(fitAvailableHeight, 60);
}

function fitAvailableHeight() {
  if (embedded) {
    const height = Math.ceil(document.body.getBoundingClientRect().height);
    if (windowId !== undefined && height !== lastPanelHeight) {
      lastPanelHeight = height;
      chrome.runtime.sendMessage({type:'panel-size',windowId,height}).catch(() => {});
    }
    return;
  }
  // Fit the compatibility menu to the native window's available width and height.
  // Native popups initially report a 25px viewport, so defer width fitting until sized.
  if (innerWidth >= 250 && document.body.scrollWidth > innerWidth + 1) {
    const savedScroll = scroller.scrollTop;
    document.body.style.width = `${Math.min(800, innerWidth)}px`;
    render();
    scroller.scrollTop = savedScroll;
  }
  if (innerHeight < 200) return;
  const excess = document.body.scrollHeight - innerHeight;
  if (excess <= 1) return;
  const savedScroll = scroller.scrollTop;
  document.documentElement.style.setProperty('--popup-height', `${Math.min(600, innerHeight)}px`);
  scroller.scrollTop = savedScroll;
}
addEventListener('resize', () => setTimeout(fitAvailableHeight, 60));

async function refresh() {
  if (windowId === undefined || !authorized) return;
  const version = ++refreshVersion;
  const latest = await chrome.tabs.query({ windowId });
  const saved = await chrome.storage.session.get(latest.map(tab => `preview:${tab.id}`));
  if (version !== refreshVersion) return;
  tabs = latest.sort((a,b) => a.index - b.index);
  previews = saved;
  render();
}

search.addEventListener('input', () => { scroller.scrollTop = 0; render(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (search.value) { event.preventDefault(); event.stopPropagation(); search.value = ''; render(); search.focus(); }
    else dismissPanel();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); search.focus(); search.select(); }
});
$('#new-tab').addEventListener('click', async () => {
  try { await operate('new'); }
  catch(error) { report(error); }
});
for (const event of [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onActivated, chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached]) {
  event.addListener(() => { refresh().catch(report); });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  for (const [key, change] of Object.entries(changes)) {
    if (change.newValue) previews[key] = change.newValue;
    else delete previews[key];
  }
  render();
});

(async () => {
  windowId = (await chrome.windows.getCurrent()).id;
  const init = await chrome.runtime.sendMessage({type:'panel-init',windowId});
  if (!init?.ok) { document.querySelector('main').hidden = true; return; }
  authorized = true;
  const stateKey = `menu:${windowId}`;
  const state = (await chrome.storage.session.get(stateKey))[stateKey];
  if (state?.until > Date.now()) search.value = state.query;
  await refresh();
  if (state?.until > Date.now()) scroller.scrollTop = state.scrollTop;
  await chrome.runtime.sendMessage({ type:'refresh', windowId });
  search.focus();
})().catch(report);
