'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..');
const {chromium}=require(path.join(root,'intentgraph/node_modules/playwright'));
(async()=>{
 const server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://fixture').pathname);const file=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{const content=fs.readFileSync(file);const ext=path.extname(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css'})[ext]||'text/plain');res.end(content);}catch{res.writeHead(404).end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1050}});const page=await context.newPage();const errors=[],blocked=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue(): (blocked.push(route.request().url()),route.abort()));
 try{
  await page.goto(origin+'/docs/architecture/');
  await page.locator('#revision').filter({hasText:'HLD 16'}).waitFor();checks.push('HLD 16 loaded');
  await page.locator('#current').click();assert.equal(await page.locator('#current').getAttribute('aria-pressed'),'true');
  await page.locator('#diagram .node').filter({hasText:'Frontend'}).click();assert.match(await page.locator('#detail').innerText(),/ux-audit-fixes-v8/);checks.push('Current view displays patched build');
  await page.locator('#target').click();assert.equal(await page.locator('#target').getAttribute('aria-pressed'),'true');checks.push('Target view selects');
  const count=await page.locator('#steps button').count();assert.ok(count>1);
  for(let i=0;i<count;i++){await page.locator('#steps button').nth(i).click();assert.ok((await page.locator('#step-title').innerText()).startsWith(`${i+1}. `));}
  checks.push(`All ${count} walkthrough steps render`);
  await page.locator('#current').click();await page.locator('#diagram .node').filter({hasText:'Frontend'}).click();
  await page.screenshot({path:path.join(__dirname,'architecture-v8.png'),fullPage:false});
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  fs.writeFileSync(path.join(__dirname,'atlas-verification.json'),JSON.stringify({passed:true,checks,pageErrors:errors,blockedRequests:blocked},null,2));console.log(JSON.stringify({passed:true,checks}));
 }finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
