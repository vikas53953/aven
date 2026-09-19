const {chromium}=require('playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,ignoreDefaultArgs:['--headless'],args:['--headless=new']});
try{
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8767/intent-map.html');await page.getByRole('button',{name:'Create chat, channel, project or agent',exact:true}).waitFor();
const plus=await page.locator('#quick-create').boundingBox(),search=await page.getByRole('button',{name:'Search',exact:true}).boundingBox();assert(plus.y<search.y);
assert.equal(await page.locator('#agent-rail-add,#new-agent-shortcut').count(),0);
await page.getByRole('textbox',{name:'Wireframe message',exact:true}).fill('Keep my draft');
async function create(type,name){await page.getByRole('button',{name:'Create chat, channel, project or agent',exact:true}).click();await page.getByRole('button',{name:'New '+type,exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),0);await page.getByLabel(type==='agent'?'Agent name':'Name',{exact:true}).fill(name);if(type==='agent')await page.getByLabel('What should this agent help with?',{exact:true}).fill('Review network changes');await page.getByRole('button',{name:'Create '+type,exact:true}).click();}
await page.getByRole('button',{name:'Create chat, channel, project or agent',exact:true}).click();await page.getByRole('button',{name:'New agent',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('#draft').inputValue(),'Keep my draft');
await create('agent','Policy reviewer');assert.match(await page.locator('#surface').innerText(),/Chat with Policy reviewer/);
await page.getByRole('textbox',{name:'Wireframe message',exact:true}).fill('Review policy at https://example.test/guide');
await page.getByRole('button',{name:'Add attachments or tools',exact:true}).click();const fc=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Attach files',exact:true}).click();await(await fc).setFiles({name:'policy.txt',mimeType:'text/plain',buffer:Buffer.from('fixture')});
await page.getByRole('button',{name:'Preview sending message',exact:true}).click();
await create('project','Branch rollout');await page.getByRole('button',{name:'+ New channel',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Policies');await page.getByRole('button',{name:'Create channel',exact:true}).click();
await page.getByRole('button',{name:'Search',exact:true}).click();assert.equal(await page.getByRole('dialog',{name:'Search Aven',exact:true}).isVisible(),true);
const filters=page.locator('#search-filters');
for(const cat of ['All','Messages','Chats','Agents','Channels','Projects','Files','Links']){await filters.getByRole('button',{name:cat,exact:true}).click();if(cat==='Messages'){await page.getByRole('searchbox',{name:'Search workspace',exact:true}).fill('policy');}else await page.getByRole('searchbox',{name:'Search workspace',exact:true}).fill('');}
await filters.getByRole('button',{name:'Files',exact:true}).click();assert.match(await page.locator('#search-results').innerText(),/policy.txt/);
await filters.getByRole('button',{name:'Links',exact:true}).click();assert.match(await page.locator('#search-results').innerText(),/https:\/\/example.test\/guide/);
await filters.getByRole('button',{name:'Messages',exact:true}).click();await page.getByRole('searchbox',{name:'Search workspace',exact:true}).fill('policy');await page.locator('#search-results button').first().click();assert.match(await page.locator('#conversation').innerText(),/Review policy at/);
await page.getByRole('button',{name:'Review settings',exact:true}).click();await page.getByRole('button',{name:'Agents',exact:true}).click();assert.equal(await page.locator('#create-agent-form').count(),0);await page.getByRole('button',{name:'Create agent in workspace',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),0);await page.getByRole('button',{name:'Cancel',exact:true}).click();
await page.reload();await page.getByRole('button',{name:'Search',exact:true}).click();await page.locator('#search-filters').getByRole('button',{name:'Projects',exact:true}).click();assert.match(await page.locator('#search-results').innerText(),/Branch rollout/);
await page.setViewportSize({width:390,height:844});let b=await page.locator('#search-dialog').boundingBox();assert(b.x>=0&&b.x+b.width<=390);await page.keyboard.press('Escape');await page.getByRole('button',{name:'Review settings',exact:true}).click();b=await page.locator('#settings-dialog').boundingBox();assert(b.x>=0&&b.x+b.width<=390);await page.keyboard.press('Escape');
await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Search',exact:true}).click();await page.screenshot({path:'.intentgraph/search-v07.png'});assert.deepEqual(errors,[]);
console.log('PASS: native-inspired entry placement, central creation/cancel, settings separation, all search filters, message/file/link results, persistence, narrow overlays, no browser errors.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
