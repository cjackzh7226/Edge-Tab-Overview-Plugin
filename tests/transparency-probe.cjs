// Isolated feasibility experiment; does not alter the installed extension or personal profile.
const { chromium } = require('C:/Users/14913/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const experiment=fs.mkdtempSync(path.join(os.tmpdir(),'edge-glass-feasibility-'));
  const extension=path.join(experiment,'extension');
  fs.mkdirSync(extension);
  fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'Isolated transparency probe',version:'1.0',permissions:['tabs','scripting'],host_permissions:['<all_urls>'],background:{service_worker:'worker.js'},action:{default_popup:'popup.html'}}));
  fs.writeFileSync(path.join(extension,'worker.js'),'chrome.runtime.onInstalled.addListener(()=>{});');
  fs.writeFileSync(path.join(extension,'popup.html'),'<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><main>半透明面板：背景应能随网页变化</main></body></html>');
  fs.writeFileSync(path.join(extension,'style.css'),'html,body{margin:0;background:transparent!important;border-radius:24px;overflow:hidden}body{width:500px;height:300px}main{box-sizing:border-box;height:100%;padding:36px;border-radius:24px;border:1px solid rgba(255,255,255,.8);background:rgba(255,255,255,.25);backdrop-filter:blur(12px);font:20px sans-serif;color:#20252c}');
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Glass test fixture</title><body style="margin:0;height:100vh;background:repeating-linear-gradient(135deg,#ac2858 0 60px,#dfa442 60px 120px)"></body>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const context=await chromium.launchPersistentContext(path.join(experiment,'profile'),{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--load-extension=${extension}`,`--disable-extensions-except=${extension}`],viewport:{width:1280,height:800}});
  const output=path.resolve('tests/results/transparency'); fs.mkdirSync(output,{recursive:true});
  try {
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const page=context.pages()[0]; await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const cdp=await context.browser().newBrowserCDPSession(); let sequence=0;
    async function popupShot(name) {
      for(let attempt=0;attempt<5;attempt++) { try { await worker.evaluate(()=>chrome.action.openPopup()); break; } catch(error) {if(attempt===4)throw error;await delay(250);} } await delay(200);
      const target=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url.endsWith('/popup.html'));
      const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
      const rpc=(method,params={})=>new Promise((resolve,reject)=>{
        const id=++sequence; const timer=setTimeout(()=>reject(new Error('CDP timeout')),5000);
        const handler=e=>{if(e.sessionId!==sessionId)return;const m=JSON.parse(e.message);if(m.id!==id)return;clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',handler);m.error?reject(m.error):resolve(m.result);};
        cdp.on('Target.receivedMessageFromTarget',handler);cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(reject);
      });
      const shot=await rpc('Page.captureScreenshot',{format:'png'});
      fs.writeFileSync(path.join(output,name),Buffer.from(shot.data,'base64'));
      await rpc('Runtime.evaluate',{expression:'window.close()'}).catch(()=>{});await delay(150);
      return shot.data;
    }
    const before=await popupShot('native-over-red.png');
    await page.evaluate(()=>document.body.style.background='repeating-linear-gradient(135deg,#164ddb 0 60px,#2dab77 60px 120px)');
    const after=await popupShot('native-over-blue.png');
    const overlayResult=await worker.evaluate(async()=>{
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      return chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
        const overlay=document.createElement('div');overlay.id='glass-proof';
        overlay.style.cssText='position:fixed;top:20px;right:20px;width:500px;height:300px;box-sizing:border-box;padding:36px;border-radius:24px;background:rgba(255,255,255,.25);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.8);box-shadow:0 8px 32px #0003;font:20px sans-serif;';
        overlay.textContent='真实网页浮层：微透与圆角';document.body.append(overlay);return true;
      }});
    });
    await page.screenshot({path:path.join(output,'real-overlay-blue.png')});
    await page.evaluate(()=>document.body.style.background='repeating-linear-gradient(135deg,#ac2858 0 60px,#dfa442 60px 120px)');
    await page.screenshot({path:path.join(output,'real-overlay-red.png')});
    await page.goto('edge://extensions/');
    const restricted=await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});try{await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>true});return {allowed:true};}catch(e){return {allowed:false,error:e.message};}});
    const result={browser:context.browser().version(),nativePopupIdenticalAcrossDifferentWebBackgrounds:before===after,ordinaryPageOverlayAllowed:overlayResult[0].result,restrictedPage:restricted,scope:'Isolated headless Edge and local fixture; real extension APIs, no installed-extension changes',experiment};
    fs.writeFileSync(path.join(output,'feasibility.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  } finally {await context.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
