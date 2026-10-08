const { chromium } = require('C:/Users/14913/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('node:path');
(async () => {
  const extension = path.resolve('edge-tab-overview');
  const context = await chromium.launchPersistentContext(path.resolve(`tests/edge-profile-${Date.now()}`), {
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless:true,
    ignoreDefaultArgs:['--disable-extensions'],
    args:[`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run', '--no-default-browser-check'],
    viewport:{ width:1280, height:800 }
  });
  try {
    console.log('BROWSER', context.browser()?.version());
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout:20000});
    console.log('WORKER', worker.url());
    await worker.evaluate(() => { globalThis.messageLog=[]; chrome.runtime.onMessage.addListener((message,sender)=>{globalThis.messageLog.push({message,sender});}); for(const [obj,key] of [[chrome.runtime,'getContexts'],[chrome.action,'openPopup']]) { const original=obj[key].bind(obj); obj[key]=async (...args)=>{try {const result=await original(...args);globalThis.messageLog.push({key,args,result});return result;}catch(e){globalThis.messageLog.push({key,error:e.message});throw e;}}} });
    console.log(await worker.evaluate(async () => ({ manifest:chrome.runtime.getManifest().name, tabs:await chrome.tabs.query({}) })));
    await worker.evaluate(() => chrome.action.openPopup());
    await new Promise(resolve => setTimeout(resolve,1000));
    console.log('PAGES', context.pages().map(p=>p.url()));
    const cdp = await context.browser().newBrowserCDPSession();
    console.log('TARGETS', (await cdp.send('Target.getTargets')).targetInfos);
    const popup = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.url.endsWith('/popup.html'));
    const {sessionId} = await cdp.send('Target.attachToTarget', {targetId:popup.targetId, flatten:false});
    let seq=0;
    const rpc = (method, params={}) => new Promise((resolve,reject) => {
      const id=++seq;
      const handler = e => { if(e.sessionId!==sessionId)return; const m=JSON.parse(e.message); if(m.id!==id)return; cdp.off('Target.receivedMessageFromTarget',handler); m.error?reject(m.error):resolve(m.result); };
      cdp.on('Target.receivedMessageFromTarget',handler);
      cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);
    });
    console.log('DOM',await rpc('Runtime.evaluate',{expression:'document.body.innerText',returnByValue:true}));
    console.log('CREATE',await rpc('Runtime.evaluate',{expression:'document.querySelector("#new-tab").click()',returnByValue:true}));
    await new Promise(resolve=>setTimeout(resolve,700));
    console.log('AFTER_CREATE',(await cdp.send('Target.getTargets')).targetInfos.map(t=>({id:t.targetId,url:t.url})));
    console.log('WINDOWS',await worker.evaluate(()=>chrome.windows.getAll()));
    console.log('CONTEXTS',await worker.evaluate(()=>chrome.runtime.getContexts({contextTypes:['POPUP']})));
    console.log('MANUAL_REOPEN',await worker.evaluate(()=>chrome.action.openPopup().then(()=>true,e=>e.message)));
    console.log('MESSAGES',JSON.stringify(await worker.evaluate(()=>globalThis.messageLog)));
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
