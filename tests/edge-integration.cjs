// Real Edge extension integration: native action popup via CDP, isolated test profile.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/14913/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const out = path.resolve('tests/results');
fs.mkdirSync(out,{recursive:true});
const results = [];
const check = (name, condition, detail) => { assert.ok(condition, `${name}: ${JSON.stringify(detail)}`); results.push({name,pass:true,detail}); console.log('PASS',name); };
async function waitFor(fn, message, timeout=12000) {
  const deadline=Date.now()+timeout; let result;
  do { try {result=await fn(); if(result)return result;}catch {} await sleep(100); }while(Date.now()<deadline);
  throw new Error(`Timed out: ${message}; last=${JSON.stringify(result)}`);
}
const names = ['项目说明','设计素材','阅读清单','学习笔记','工作计划','开发文档','本周任务','灵感收集','参考资料','页面十','页面十一','页面十二'];
const colors = ['#ba403d','#246ec4','#198967','#8362bc','#bb7530','#277e8d','#7460b5','#487443','#ad547d','#4984a5','#4b8d85','#88795f'];
const server=http.createServer((req,res)=>{
  if(req.url==='/favicon.svg'){res.writeHead(200,{'Content-Type':'image/svg+xml'});return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#4385d8"/><path d="M9 9h14v14H9z" fill="white"/></svg>');}
  const n=Number(new URL(req.url,'http://localhost').searchParams.get('n')||0)%12;
  if(req.url.includes('strict=1'))res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; frame-src 'none'");
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end(`<!doctype html><html><head><title>${names[n]} · 测试网页 ${n+1}</title><link rel="icon" href="/favicon.svg"></head><body style="margin:0;font:24px Segoe UI,Microsoft YaHei,sans-serif;background:#f6f7fa"><header style="background:${colors[n]};height:210px;padding:48px;color:white;box-sizing:border-box"><small>页览 / 本地测试页面 ${n+1}</small><h1 style="margin:12px 0">${names[n]}</h1></header><main style="padding:40px"><h2>这是用于验证预览的真实测试页面</h2><p>卡片画面来自浏览器实际截图。</p><div style="display:flex;gap:20px"><div style="background:#e1e6ee;width:30%;height:140px;border-radius:16px"></div><div style="background:#e1e6ee;width:60%;height:140px;border-radius:16px"></div></div><section id="lower" style="margin-top:600px;height:700px;background:#e9c847;padding:30px">滚动后的页面内容</section></main></body></html>`);
});

async function run() {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/`;
  const extension=path.resolve('edge-tab-overview');
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'edge-tab-overview-test-'));
  const options={ executablePath:process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:true, ignoreDefaultArgs:['--disable-extensions'], args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--enable-unsafe-extension-debugging'], viewport:{width:1280,height:800} };
  let context=await chromium.launchPersistentContext(profile,options);
  let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const extensionId=worker.url().split('/')[2];
  let cdp=await context.browser().newBrowserCDPSession();
  let popup;
  let rpcId=0;
  let errors=[];
  const targets=async()=> (await cdp.send('Target.getTargets')).targetInfos;
  const nativePopupTargets = new Set();
  const observeTarget = event => {
    const info=event.targetInfo;
    if(info?.url===`chrome-extension://${extensionId}/popup.html`)nativePopupTargets.add(info.targetId);
  };
  cdp.on('Target.targetCreated',observeTarget);
  cdp.on('Target.targetInfoChanged',observeTarget);
  await cdp.send('Target.setDiscoverTargets',{discover:true});
  async function clickToolbar() {
    const active=await worker.evaluate(async()=> (await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0]);
    const tabTargets=(await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]})).targetInfos;
    const target=tabTargets.find(t=>t.type==='tab'&&t.url===active.url);
    assert.ok(target,'active tab target');
    await cdp.send('Extensions.triggerAction',{id:extensionId,targetId:target.targetId});
  }
  const overlayFrames=()=>context.pages().flatMap(page=>page.frames()).filter(frame=>frame.url().includes(`chrome-extension://${extensionId}/popup.html?embed=1`));
  async function attachPopup() {
    const surface=await waitFor(async()=>{
      for(const frame of overlayFrames()) {
        if(await frame.evaluate(()=>document.querySelectorAll('.card').length>0).catch(()=>false))return {frame};
      }
      const target=(await targets()).find(t=>t.url===`chrome-extension://${extensionId}/popup.html`);
      if(target)return {target};
    },'menu surface');
    if(surface.frame) {
      popup={id:surface.frame.url(),frame:surface.frame,evaluate:expression=>surface.frame.evaluate(expression)};
      await sleep(200);return popup;
    }
    const target=surface.target;
    if(popup?.id===target.targetId)return popup;
    const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
    const rpc=(method,params={})=>new Promise((resolve,reject)=>{
      const id=++rpcId;
      const timeout=setTimeout(()=>{cdp.off('Target.receivedMessageFromTarget',handler);reject(new Error(`CDP timeout ${method}`));},5000);
      const handler=event=>{
        if(event.sessionId!==sessionId)return;
        const response=JSON.parse(event.message);
        if(response.id!==id)return;
        clearTimeout(timeout); cdp.off('Target.receivedMessageFromTarget',handler);
        if(response.error)reject(new Error(response.error.message));else resolve(response.result);
      };
      cdp.on('Target.receivedMessageFromTarget',handler);
      cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(error=>{clearTimeout(timeout);cdp.off('Target.receivedMessageFromTarget',handler);reject(error);});
    });
    const evaluate=async expression=>{
      const result=await rpc('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    popup={id:target.targetId,rpc,evaluate};
    await rpc('Runtime.enable');
    try { await waitFor(()=>evaluate('document.querySelectorAll(".card").length > 0'),'popup populated',2500); }
    catch { popup=null;return attachPopup(); }
    return popup;
  }
  async function click(selector) {
    if(popup.frame) {await popup.frame.locator(selector).click();return;}
    await popup.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);
    const point=await popup.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await popup.rpc('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await popup.rpc('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point}).catch(()=>{});
  }
  async function screenshot(name,scheme) {
    if(popup.frame) {
      await popup.frame.page().emulateMedia({colorScheme:scheme}); await sleep(200);
      const rect=await popup.frame.locator('body').boundingBox();
      await popup.frame.page().screenshot({path:path.join(out,name),clip:{x:rect.x-8,y:rect.y-8,width:rect.width+16,height:rect.height+16}});
      return;
    }
    await popup.rpc('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
    await sleep(150);
    const {data}=await popup.rpc('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(out,name),Buffer.from(data,'base64'));
  }
  try {
    const version=context.browser().version();
    console.log('EDGE',version);
    const initial=(await worker.evaluate(()=>chrome.tabs.query({})))[0];
    const windowId=initial.windowId;
    await worker.evaluate(({id,url})=>chrome.tabs.update(id,{url}),{id:initial.id,url:`${base}?n=0`});
    const ids=[initial.id];
    for(let n=1;n<12;n++)ids.push((await worker.evaluate(({windowId,url})=>chrome.tabs.create({windowId,url,active:false}),{windowId,url:`${base}?n=${n}`})).id);
    await waitFor(()=>worker.evaluate(async()=> (await chrome.tabs.query({})).every(t=>t.status==='complete')),'fixtures loaded');
    const preview= id=>worker.evaluate(async id=>(await chrome.storage.session.get(`preview:${id}`))[`preview:${id}`],id);
    await waitFor(()=>preview(ids[0]),'initial preview');
    check('真实可见页面生成临时缩略图',Boolean((await preview(ids[0])).data.startsWith('data:image/jpeg')));
    // Visit eight pages to populate actual viewport captures, leaving four honest placeholders.
    for(const id of ids.slice(1,8)) {
      await worker.evaluate(id=>chrome.tabs.update(id,{active:true}),id);
      await waitFor(()=>preview(id),`preview ${id}`);
    }
    await worker.evaluate(id=>chrome.tabs.update(id,{active:true}),ids[0]);
    await sleep(750);
    const initialNativeCount=nativePopupTargets.size;
    await clickToolbar();
    await attachPopup();
    await sleep(200);
    check('点击图标直接打开浮层，没有创建中转原生弹窗',nativePopupTargets.size===initialNativeCount);
    check('弹窗仅展示当前窗口的 12 个标签页',await popup.evaluate('document.querySelectorAll(".card").length')===12);
    const layout=await popup.evaluate(`(()=>{const s=document.querySelector('#scroller').getBoundingClientRect();const cards=[...document.querySelectorAll('.card')].map(x=>{const r=x.getBoundingClientRect();return{x:r.x,top:r.top,bottom:r.bottom}});const p=document.querySelector('.preview').getBoundingClientRect();return {bodyHeight:document.body.scrollHeight,bodyWidth:document.body.scrollWidth,viewport:innerHeight,fullyVisible:cards.filter(r=>r.top>=s.top&&r.bottom<=s.bottom).length,columns:new Set(cards.map(r=>r.x)).size,ratio:p.width/p.height,scrollHeight:document.querySelector('#scroller').scrollHeight,clientHeight:document.querySelector('#scroller').clientHeight}})()`);
    check('三列显示，按可用高度滚动',layout.columns===3&&layout.fullyVisible>=3&&layout.fullyVisible<=12,layout);
    check('浮层加宽到约 1051 像素',Math.abs(layout.bodyWidth-1051)<=2,layout);
    const readable=await popup.evaluate(`({previewWidth:document.querySelector('.preview').getBoundingClientRect().width,titleSize:parseFloat(getComputedStyle(document.querySelector('.title')).fontSize),footerBottom:document.querySelector('footer').getBoundingClientRect().bottom})`);
    check('保持原有卡片尺寸且底部按钮完整可见',Math.abs(readable.previewWidth-325)<=1&&readable.titleSize===14&&readable.footerBottom<=layout.viewport,readable);
    check('弹窗不超过 600 像素且无整体溢出',layout.bodyHeight<=600&&layout.bodyHeight<=layout.viewport,layout);
    check('网页预览比例为 16:9',Math.abs(layout.ratio-16/9)<0.005,layout);
    check('超出可见范围后在菜单内部滚动',layout.scrollHeight>layout.clientHeight,layout);
    check('已浏览页面有图，未浏览页面为占位',await popup.evaluate('document.querySelectorAll(".thumbnail:not([hidden])").length')===8);
    await screenshot('popup-light.png','light');
    await screenshot('popup-dark.png','dark');
    if(process.env.VISUAL_ONLY==='1') {
      console.log('GLASS STYLES',await popup.evaluate(`({htmlBackground:getComputedStyle(document.documentElement).backgroundColor,bodyBackground:getComputedStyle(document.body).backgroundColor,scheme:getComputedStyle(document.documentElement).colorScheme})`));
      return;
    }
    check('普通网页使用真实网页浮层',Boolean(popup.frame));
    // Compare pixels strictly inside the footer and the rounded cutout, not outside the menu.
    const webPage=popup.frame.page();
    const box=await popup.frame.locator('body').boundingBox();
    const footerPatch={x:box.x+box.width/2,y:box.y+box.height-24,width:8,height:8};
    const cornerPatch={x:box.x+1,y:box.y+1,width:3,height:3};
    const previewBeforeOverlayCheck=await preview(ids[0]);
    for(const scheme of ['light','dark']) {
      await webPage.emulateMedia({colorScheme:scheme});
      await webPage.evaluate(()=>{document.body.style.background='#ba403d';document.querySelector('header').style.background='#ba403d';});
      await sleep(150);
      const footerRed=await webPage.screenshot({clip:footerPatch});
      const cornerRed=await webPage.screenshot({clip:cornerPatch});
      await webPage.evaluate(()=>{document.body.style.background='#1559bb';document.querySelector('header').style.background='#1559bb';window.dispatchEvent(new Event('scroll'));});
      await sleep(1000);
      const footerBlue=await webPage.screenshot({clip:footerPatch});
      const cornerBlue=await webPage.screenshot({clip:cornerPatch});
      check(`${scheme} 模式浮层内部像素随真实网页改变`,!footerRed.equals(footerBlue));
      check(`${scheme} 模式圆角外没有不透明直角底板`,!cornerRed.equals(cornerBlue));
    }
    check('浮层显示期间不会把菜单截入预览',(await preview(ids[0])).data===previewBeforeOverlayCheck.data&&(await preview(ids[0])).time===previewBeforeOverlayCheck.time);
    await webPage.evaluate(()=>{document.body.style.background='#f6f7fa';document.querySelector('header').style.background='#ba403d';});
    // A website embedding the public iframe without its one-time session token gets no tab UI.
    await webPage.evaluate(url=>{const iframe=document.createElement('iframe');iframe.id='unauthorized-probe';iframe.src=url;iframe.style.cssText='position:fixed;bottom:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';document.body.append(iframe);},`chrome-extension://${extensionId}/popup.html?embed=1&token=invalid`);
    const untrusted=await waitFor(()=>webPage.frames().find(f=>f.url().includes('token=invalid')),'unauthorized iframe loaded');
    await waitFor(()=>untrusted.evaluate(()=>document.querySelector('main')?.hidden),'unauthorized iframe denied');
    check('没有有效会话令牌的网页不能打开标签页界面',await untrusted.evaluate(()=>document.querySelectorAll('.card').length===0));
    await webPage.evaluate(()=>document.querySelector('#unauthorized-probe').remove());
    await webPage.setViewportSize({width:1280,height:480}); await sleep(400);
    check('缩小网页窗口后浮层底部仍完整可见',await popup.evaluate('document.body.scrollHeight<=innerHeight&&document.querySelector("footer").getBoundingClientRect().bottom<=innerHeight'));
    await webPage.setViewportSize({width:1280,height:800}); await sleep(400);
    await popup.evaluate(`document.querySelector('#search').value='测试网页';document.querySelector('#search').dispatchEvent(new Event('input'));document.querySelector('#scroller').scrollTop=150;`);
    const scrollBefore=await popup.evaluate('document.querySelector("#scroller").scrollTop');
    const switchId=ids[4];
    await click(`.card[data-id="${switchId}"] .activate`);
    await sleep(1000); await attachPopup();
    check('点击卡片后对应标签页激活',await worker.evaluate(async id=>(await chrome.tabs.get(id)).active,switchId));
    check('切换后菜单恢复显示',await popup.evaluate('document.querySelectorAll(".card").length > 0'));
    const restored=await popup.evaluate(`({query:document.querySelector('#search').value,scroll:document.querySelector('#scroller').scrollTop,width:document.body.scrollWidth})`);
    const savedMenu=await worker.evaluate(async windowId=>(await chrome.storage.session.get(`menu:${windowId}`))[`menu:${windowId}`],windowId);
    check('切换后保留搜索词和滚动位置',restored.query==='测试网页'&&Math.abs(restored.scroll-scrollBefore)<1,{restored,scrollBefore,savedMenu});
    check('切换后突出当前标签页',await popup.evaluate(`document.querySelector('.card.current').dataset.id === '${switchId}'`));
    await popup.evaluate(`document.querySelector('#search').value='没有这个标题XYZ';document.querySelector('#search').dispatchEvent(new Event('input'));`);
    check('搜索无结果时提供空状态',await popup.evaluate('!document.querySelector("#empty").hidden && document.querySelectorAll(".card").length===0'));
    await popup.evaluate(`document.querySelector('#search').value='n=3';document.querySelector('#search').dispatchEvent(new Event('input'));`);
    check('支持按网址搜索',await popup.evaluate('document.querySelectorAll(".card").length===1'));
    await popup.evaluate(`document.querySelector('#search').value='';document.querySelector('#search').dispatchEvent(new Event('input'));`);
    // Closing an inactive tab keeps the same popup, and immediately drops its temporary preview.
    const oldPopup=popup.id;
    await click(`.card[data-id="${ids[1]}"] .close`); await sleep(450); await attachPopup();
    check('关闭后台标签页保留原菜单',popup.id===oldPopup&&(await popup.evaluate('document.querySelectorAll(".card").length'))===11);
    check('关闭标签页清除对应预览',!await preview(ids[1]));
    await click(`.card[data-id="${switchId}"] .close`); await sleep(1000); await attachPopup();
    check('关闭当前标签页后菜单恢复',await popup.evaluate('document.querySelectorAll(".card").length')===10);
    // Repeat switches through real mouse input, so one lucky restoration is insufficient.
    for(const id of [ids[0],ids[2],ids[3]]) {
      const beforeSwitchNative=nativePopupTargets.size;
      await popup.evaluate('document.querySelector("#scroller").scrollTop=0');
      await click(`.card[data-id="${id}"] .activate`); await sleep(850); await attachPopup();
      check(`连续切换后菜单可继续操作 ${ids.indexOf(id)+1}`,await worker.evaluate(async id=>(await chrome.tabs.get(id)).active,id));
      check(`连续切换不创建中转原生弹窗 ${ids.indexOf(id)+1}`,nativePopupTargets.size===beforeSwitchNative);
    }
    await click('#new-tab'); await sleep(1200); await attachPopup();
    check('新建标签页后菜单继续显示',await popup.evaluate('document.querySelectorAll(".card").length')===11);
    const newActive=(await worker.evaluate(()=>chrome.tabs.query({active:true,lastFocusedWindow:true})))[0];
    check('新建标签页自动激活',newActive.url.startsWith('edge://newtab'));
    const fallbackLayout=await popup.evaluate('({columns:getComputedStyle(document.querySelector("#cards")).gridTemplateColumns,width:document.body.scrollWidth,viewport:innerWidth})');
    check('特殊页面三列兼容菜单不超出宽度上限',!popup.frame&&fallbackLayout.columns.split(' ').length===3&&fallbackLayout.width<=800&&fallbackLayout.width<=fallbackLayout.viewport,fallbackLayout);
    check('兼容菜单不会留下下次点击的弹窗绑定',await worker.evaluate(async id=>(await chrome.action.getPopup({tabId:id}))==='',newActive.id));
    await screenshot('popup-fallback.png','light');
    // Explicit dismissal must stay dismissed; restoration is bounded to the requested operation.
    await popup.evaluate('dismissPanel()').catch(()=>{}); await sleep(1200);
    check('主动收起菜单后不会反复弹出',!(await targets()).some(t=>t.url.endsWith('/popup.html'))&&overlayFrames().length===0);
    // Other window tabs must not appear in this window's popup.
    const second=await worker.evaluate(url=>chrome.windows.create({url,focused:false}),`${base}?n=11`);
    await worker.evaluate(id=>chrome.windows.update(id,{focused:true}),windowId);
    await clickToolbar(); await attachPopup();
    check('其他窗口标签页不会混入',await popup.evaluate('document.querySelectorAll(".card").length')===11);
    await popup.evaluate('dismissPanel()').catch(()=>{});
    await worker.evaluate(id=>chrome.windows.remove(id),second.id);
    await worker.evaluate(({id,url})=>chrome.tabs.update(id,{active:true,url}),{id:ids[0],url:`${base}?n=0&strict=1`});
    await sleep(700);await clickToolbar();await attachPopup();
    check('严格页面策略下仍有可用菜单或兼容回退',await popup.evaluate('document.querySelectorAll(".card").length>0'));
    await popup.evaluate('dismissPanel()').catch(()=>{});
    await worker.evaluate(({id,url})=>chrome.tabs.update(id,{url}),{id:ids[0],url:`${base}?n=0`});
    await sleep(700);
    // Scrolling must refresh the active page preview without changing the active tab.
    await worker.evaluate(id=>chrome.tabs.update(id,{active:true}),ids[0]);
    const firstPage=await waitFor(()=>context.pages().find(p=>p.url()===`${base}?n=0`),'fixture page');
    await waitFor(()=>preview(ids[0]),'preview before scrolling');
    const before=await preview(ids[0]);
    await firstPage.evaluate(()=>document.querySelector('#lower').scrollIntoView());
    const changed=await waitFor(async()=>{const p=await preview(ids[0]);return p&&p.time>before.time&&p.data!==before.data?p:false;},'scroll refresh');
    check('滚动停下后更新真实画面',changed.data!==before.data);
    const byteCount=await worker.evaluate(()=>chrome.storage.session.getBytesInUse(null));
    check('临时预览用量在内存预算内',byteCount<10*1024*1024,{bytes:byteCount});
    check('没有写入持久化存储',await worker.evaluate(async()=>Object.keys(await chrome.storage.local.get(null)).length===0&&Object.keys(await chrome.storage.sync.get(null)).length===0));
    // Navigation invalidates the old URL's image even while the replacement page is loading.
    await firstPage.goto(`${base}?n=10`);
    await waitFor(async()=>{const p=await preview(ids[0]);return !p||p.url===`${base}?n=10`;},'navigation invalidation');
    check('导航后不会沿用上一个网址的画面',!(await preview(ids[0]))||(await preview(ids[0])).url===`${base}?n=10`);
    // Small count shrinks the popup; then closing the final tab closes its window naturally.
    const keep=ids[0];
    await worker.evaluate(async keep=>{for(const t of await chrome.tabs.query({}))if(t.id!==keep)await chrome.tabs.remove(t.id);},keep);
    await sleep(400); await clickToolbar(); await attachPopup();
    const small=await popup.evaluate('document.body.scrollHeight');
    check('少量标签页时菜单自动变矮',small<400,{height:small});
    await screenshot('popup-one-tab.png','light');
    await popup.evaluate('dismissPanel()').catch(()=>{});
    // Restart the same isolated profile, with an about:blank startup tab so no new web capture occurs.
    await context.close();
    context=await chromium.launchPersistentContext(profile,options);
    worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    check('浏览器重启后不保留预览',await worker.evaluate(async()=>!Object.keys(await chrome.storage.session.get(null)).some(key=>key.startsWith('preview:'))));
    const summary={date:new Date().toISOString(),browser:`Microsoft Edge ${version}`,mode:'headless real browser, page overlay and native fallback; actual mouse input and composited pixel comparisons',passed:results.length,results,profile,notes:['Screenshots use local test pages, not personal browser data.','Light/dark transparency verified by changing the real webpage and comparing pixel patches inside the menu and at its corner.','A visible desktop/manual check is still useful for perceived menu transition timing.']};
    fs.writeFileSync(path.join(out,'integration.json'),JSON.stringify(summary,null,2));
    console.log('ALL PASS',results.length);
  } finally { await context.close(); server.close(); }
}
run().catch(error=>{console.error(error);fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:error.stack,results},null,2));server.close();process.exitCode=1;});
