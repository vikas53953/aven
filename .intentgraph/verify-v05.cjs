const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,ignoreDefaultArgs:['--headless'],args:['--headless=new']});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[],posts=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
 await page.goto('http://127.0.0.1:8767/intent-map.html');
 await page.getByRole('button',{name:'Add attachments or tools',exact:true}).click();
 const choose=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Attach files',exact:true}).click();
 await (await choose).setFiles([{name:'report.txt',mimeType:'text/plain',buffer:Buffer.from('Local verification fixture')},{name:'sample.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lWQAAAAASUVORK5CYII=','base64')}]);
 await page.waitForFunction(()=>document.querySelectorAll('.attachment-chip').length===2);
 await page.waitForFunction(()=>document.querySelector('.attachment-chip img').complete&&document.querySelector('.attachment-chip img').naturalWidth>0);
 await page.getByRole('button',{name:'Remove attachment report.txt',exact:true}).click();
 assert.equal(await page.locator('.attachment-chip').count(),1);
 assert.equal(await page.getByRole('button',{name:'Preview sending message',exact:true}).isEnabled(),true);
 await page.getByRole('button',{name:'Preview sending message',exact:true}).click();
 assert.equal(await page.locator('.attachment-chip').count(),0);
 assert.match(await page.locator('#conversation').innerText(),/Attachment: sample.png/);
 await page.getByRole('button',{name:'Add attachments or tools',exact:true}).click();
 const chooseImage=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Attach images',exact:true}).click();
 await (await chooseImage).setFiles({name:'image-only.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lWQAAAAASUVORK5CYII=','base64')});
 assert.equal(await page.locator('#image-picker').getAttribute('accept'),'image/*');
 await page.getByRole('button',{name:'Remove attachment image-only.png',exact:true}).click();
 await page.getByRole('textbox',{name:'Wireframe message',exact:true}).fill('Preserve my draft');
 await page.getByRole('button',{name:'Review settings',exact:true}).click();
 for(const name of ['General','Appearance','Agents','Models & providers','Connections','Privacy & data'])await page.getByRole('button',{name,exact:true}).click();
 await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByLabel('Theme',{exact:true}).selectOption('light');
 await page.getByRole('button',{name:'Save settings',exact:true}).click();
 await page.getByRole('button',{name:'Agents',exact:true}).click();
 await page.getByLabel('Agent name',{exact:true}).fill('Firewall specialist');await page.getByLabel('What should this agent help with?',{exact:true}).fill('Inspect firewall policies.');
 await page.getByRole('button',{name:'Create agent',exact:true}).click();
 await page.getByLabel('Agent name',{exact:true}).fill('Firewall specialist');await page.getByLabel('What should this agent help with?',{exact:true}).fill('Duplicate');
 await page.getByRole('button',{name:'Create agent',exact:true}).click();assert.match(await page.locator('#agent-create-status').innerText(),/different agent name/);
 await page.keyboard.press('Escape');
 assert.equal(await page.locator('#draft').inputValue(),'Preserve my draft');
 await page.getByLabel('Active agent',{exact:true}).selectOption('companion');
 assert.equal(await page.locator('#draft').inputValue(),'Preserve my draft');
 await page.reload();assert.equal(await page.locator('.canvas').getAttribute('data-theme'),'light');
 assert.equal(await page.locator('#active-agent option').count(),2);
 await page.getByRole('button',{name:'Review settings',exact:true}).click();
 await page.setViewportSize({width:390,height:844});
 const bounds=await page.locator('#settings-dialog').boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=390);
 await page.getByRole('button',{name:'Agents',exact:true}).click();await page.getByRole('button',{name:'Remove Firewall specialist',exact:true}).click();
 await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByLabel('Theme',{exact:true}).selectOption('dark');await page.getByRole('button',{name:'Save settings',exact:true}).click();
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'General',exact:true}).click();
 await page.screenshot({path:'.intentgraph/settings-v05.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(posts,[]);
 console.log('PASS: files + image pickers, thumbnail, removal, attachment-only send, six settings pages, save/reload, profile creation/duplicate rejection/switching, draft preservation, narrow dialog, no page errors or POST uploads.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});


