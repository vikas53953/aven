const { chromium } = require('playwright');
const fs = require('fs');
const crypto = require('crypto');

const root = 'C:\\Users\\vikasmit\\Downloads\\vikas problems\\netrok-muse';
const url = 'http://localhost:8767/avatar-system/four-preview.html';
const screenshotDir = `${root}\\.intentgraph`;
const expectedHashes = {
  'polished.html': '4ee265ff2b8f9fbdd32eecdffc1a6b14e0387e77d08175db828af5fc032babcc',
  'polished.css': 'a665c974bdb95112968a140d85e4f9207b14397cde25505a0147203cc78c705c',
  'polished.js': 'ce2665803e7982fdc1118664910b89a2bbb409705021180d57e2ec4fc06a942b',
  'polished-avatars.js': 'b4d0daff1007ff5f9fb5f99e5b6162d18b47952d371d6ec5d42a66e721d73188',
};

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail });
  if (!pass) console.error(`FAIL ${name}: ${detail}`);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function openContext(browser, viewport, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport, reducedMotion });
  await context.addInitScript(() => {
    window.__avatarStorageWrites = [];
    for (const method of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        window.__avatarStorageWrites.push({ method, args });
        return original.apply(this, args);
      };
    }
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#gallery svg').length === 4 && document.querySelectorAll('#sizes svg').length === 12);
  await sleep(100);
  check(`page errors ${viewport.width}px`, pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  return { context, page, pageErrors };
}

async function main() {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ignoreDefaultArgs: ['--headless'],
    args: ['--headless=new'],
  });

  for (const [name, expected] of Object.entries(expectedHashes)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(`${root}\\${name}`)).digest('hex');
    check(`legacy hash ${name}`, actual === expected, `actual=${actual} expected=${expected}`);
  }

  const desktop = await openContext(browser, { width: 1440, height: 1000 });
  const page = desktop.page;
  const structural = await page.evaluate(() => {
    const gallery = [...document.querySelectorAll('#gallery svg')];
    const sizes = [...document.querySelectorAll('#sizes svg')];
    const svgs = [...gallery, ...sizes];
    const expectedParts = ['character', 'feet', 'appendages', 'body', 'details', 'eyebrows', 'eyes', 'mouth'].sort();
    const namedParts = svgs.map(svg => ({
      role: svg.dataset.role,
      parts: [...svg.querySelectorAll('[data-part]')].map(node => node.dataset.part).sort(),
    }));
    const forbidden = svgs.flatMap(svg => [...svg.querySelectorAll('image,foreignObject,embed,object,iframe,use')].map(node => `${svg.dataset.role}:${node.tagName.toLowerCase()}`));
    const externalAttrs = svgs.flatMap(svg => [...svg.querySelectorAll('*')].flatMap(node => [...node.attributes].filter(attr => /^(src|href|xlink:href)$/i.test(attr.name) || /url\(/i.test(attr.value)).map(attr => `${svg.dataset.role}:${attr.name}=${attr.value}`)));
    const rendered = svgs.map(svg => {
      const rect = svg.getBoundingClientRect();
      return { role: svg.dataset.role, width: rect.width, height: rect.height, display: getComputedStyle(svg).display };
    });
    return {
      galleryCount: gallery.length,
      sizeCount: sizes.length,
      roles: [...new Set(gallery.map(svg => svg.dataset.role))],
      namedParts,
      expectedParts,
      forbidden,
      externalAttrs,
      rendered,
      imageLoaded: (() => { const image = document.querySelector('.reference img'); return image && image.complete && image.naturalWidth > 0; })(),
    };
  });
  check('four gallery SVGs', structural.galleryCount === 4, `count=${structural.galleryCount}`);
  check('twelve application-size SVGs', structural.sizeCount === 12, `count=${structural.sizeCount}`);
  check('four expected roles', JSON.stringify(structural.roles.sort()) === JSON.stringify(['cloud', 'firewall', 'router', 'switch']), `roles=${structural.roles.join(',')}`);
  check('editable SVG named parts', structural.namedParts.length === 16 && structural.namedParts.every(item => JSON.stringify(item.parts) === JSON.stringify(structural.expectedParts)), JSON.stringify(structural.namedParts));
  check('no raster/embed/external SVG assets', structural.forbidden.length === 0 && structural.externalAttrs.length === 0, JSON.stringify({ forbidden: structural.forbidden, externalAttrs: structural.externalAttrs }));
  check('all 16 still render', structural.rendered.every(item => item.width > 0 && item.height > 0 && item.display !== 'none'), JSON.stringify(structural.rendered));
  check('reference PNG loaded', structural.imageLoaded, `naturalWidth=${await page.locator('.reference img').evaluate(img => img.naturalWidth)}`);

  await page.locator('#stage').scrollIntoViewIfNeeded();
  await sleep(120);
  const animationState = await page.evaluate(() => {
    const active = document.querySelector('#active-art');
    const target = [...document.querySelectorAll('#gallery svg,#sizes svg')];
    const activeAnimations = active.getAnimations({ subtree: true }).length;
    const staticAnimations = target.reduce((total, svg) => total + svg.getAnimations({ subtree: true }).length, 0);
    return {
      motionIds: [...document.querySelectorAll('.motion-active')].map(node => node.id),
      activeAnimations,
      staticAnimations,
      animationChecked: document.querySelector('#animation').checked,
    };
  });
  check('no animation on 16 static SVGs', animationState.staticAnimations === 0, JSON.stringify(animationState));
  check('only #active-art animates', JSON.stringify(animationState.motionIds) === JSON.stringify(['active-art']) && animationState.activeAnimations > 0, JSON.stringify(animationState));

  const counts = await page.evaluate(() => ({ roles: document.querySelectorAll('#roles button').length, emotions: document.querySelectorAll('#emotions button').length }));
  check('role and five emotion controls', counts.roles === 4 && counts.emotions === 5, JSON.stringify(counts));

  await page.locator('#roles button[data-role="router"]').focus();
  await page.keyboard.press('Enter');
  check('keyboard role button selects Router', await page.locator('#character-name').textContent() === 'Router' && await page.locator('#roles button[data-role="router"]').getAttribute('aria-pressed') === 'true', await page.locator('#character-name').textContent());
  await page.locator('#roles button[data-role="cloud"]').click();
  await page.locator('#emotions button[data-emotion-choice="listening"]').focus();
  await page.keyboard.press('Space');
  check('keyboard emotion button selects Listening', await page.locator('#state-label').textContent() === 'Listening expression', await page.locator('#state-label').textContent());
  await page.locator('#emotions button[data-emotion-choice="idle"]').click();

  await page.locator('#stage').hover();
  check('hover greets from idle', await page.locator('#state-label').textContent() === 'Hover expression', await page.locator('#state-label').textContent());
  await page.mouse.move(5, 5);
  await sleep(40);
  check('pointer leave returns idle', await page.locator('#state-label').textContent() === 'Idle expression', await page.locator('#state-label').textContent());
  await page.locator('#stage').focus();
  await sleep(40);
  check('focus greets from idle', await page.locator('#state-label').textContent() === 'Hover expression', await page.locator('#state-label').textContent());
  await page.evaluate(() => document.activeElement.blur());
  await sleep(40);
  check('blur returns idle', await page.locator('#state-label').textContent() === 'Idle expression', await page.locator('#state-label').textContent());

  await page.locator('#emotions button[data-emotion-choice="success"]').click();
  check('success state is shown', await page.locator('#state-label').textContent() === 'Success expression', await page.locator('#state-label').textContent());
  await sleep(1250);
  check('success returns to idle', await page.locator('#state-label').textContent() === 'Idle expression', await page.locator('#state-label').textContent());

  await page.locator('#animation').uncheck();
  await sleep(40);
  const motionOff = await page.evaluate(() => ({ className: document.querySelector('#active-art').className, animations: document.querySelector('#active-art').getAnimations({ subtree: true }).length, note: document.querySelector('#motion-note').textContent }));
  check('animation toggle off stops active motion', motionOff.className === '' && motionOff.animations === 0 && /off/i.test(motionOff.note), JSON.stringify(motionOff));
  await page.locator('#animation').check();
  await sleep(40);
  const motionOn = await page.evaluate(() => ({ className: document.querySelector('#active-art').className, animations: document.querySelector('#active-art').getAnimations({ subtree: true }).length }));
  check('animation toggle on resumes active motion', motionOn.className === 'motion-active' && motionOn.animations > 0, JSON.stringify(motionOn));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await sleep(80);
  const reduced = await page.evaluate(() => ({ className: document.querySelector('#active-art').className, animations: document.querySelector('#active-art').getAnimations({ subtree: true }).length, note: document.querySelector('#motion-note').textContent }));
  check('reduced motion disables active motion', reduced.className === '' && reduced.animations === 0 && /Reduced motion is active/i.test(reduced.note), JSON.stringify(reduced));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await sleep(80);
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(160);
  const offscreen = await page.evaluate(() => {
    const rect = document.querySelector('#stage').getBoundingClientRect();
    return { className: document.querySelector('#active-art').className, animations: document.querySelector('#active-art').getAnimations({ subtree: true }).length, stageRect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), viewportHeight: window.innerHeight } };
  });
  check('offscreen preview pauses motion', offscreen.className === '' && offscreen.animations === 0, JSON.stringify(offscreen));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#stage').scrollIntoViewIfNeeded();
  await sleep(120);

  const storage = await page.evaluate(() => ({ localStorageLength: localStorage.length, sessionStorageLength: sessionStorage.length, writes: window.__avatarStorageWrites }));
  check('no storage writes', storage.localStorageLength === 0 && storage.sessionStorageLength === 0 && storage.writes.length === 0, JSON.stringify(storage));

  await page.screenshot({ path: `${screenshotDir}\\avatar-four-desktop.png`, fullPage: true });
  await desktop.context.close();

  for (const width of [390, 320]) {
    const narrow = await openContext(browser, { width, height: 800 });
    const narrowMetrics = await narrow.page.evaluate(() => {
      const width = window.innerWidth;
      const overflows = [...document.querySelectorAll('body *')].filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && (rect.right > width + 1 || rect.left < -1);
      }).slice(0, 8).map(el => ({ tag: el.tagName, id: el.id, className: el.className, right: Math.round(el.getBoundingClientRect().right), width: Math.round(el.getBoundingClientRect().width) }));
      return { innerWidth: width, documentScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, overflows };
    });
    check(`no horizontal overflow at ${width}px`, narrowMetrics.documentScrollWidth <= width && narrowMetrics.bodyScrollWidth <= width && narrowMetrics.overflows.length === 0, JSON.stringify(narrowMetrics));
    await narrow.page.screenshot({ path: `${screenshotDir}\\avatar-four-${width}.png`, fullPage: true });
    await narrow.context.close();
  }

  await browser.close();
  const summary = {
    generatedAt: new Date().toISOString(),
    url,
    pass: checks.every(item => item.pass),
    passed: checks.filter(item => item.pass).length,
    failed: checks.filter(item => !item.pass).length,
    checks,
    evidence: ['avatar-four-desktop.png', 'avatar-four-390.png', 'avatar-four-320.png'],
    visualOwnerApproval: 'pending; runtime QA cannot attest human visual approval',
  };
  fs.writeFileSync(`${screenshotDir}\\avatar-four-checks.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.pass ? 0 : 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
