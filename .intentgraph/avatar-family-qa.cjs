const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const avatarDir = path.join(root, 'avatar-system');
const base = 'http://127.0.0.1:8767';
const evidenceDir = __dirname;
const sourceFiles = [
  'avatar-system/artwork.js',
  'avatar-system/avatar.css',
  'avatar-system/gallery.html',
  'avatar-system/gallery.css',
  'avatar-system/preview.js',
  'avatar-system/export.cjs',
  'avatar-system/react/NetworkAvatar.tsx',
  ...fs.readdirSync(path.join(avatarDir, 'svg')).filter(name => name.endsWith('.svg')).map(name => `avatar-system/svg/${name}`)
];
const sha256 = rel => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex');
const fingerprint = () => Object.fromEntries(sourceFiles.map(file => [file, sha256(file)]));
const report = {
  phase: 'gallery',
  startedAt: new Date().toISOString(),
  base,
  viewportRuns: [],
  checks: [],
  captures: [],
  errors: [],
  externalRequests: [],
  storageWrites: [],
  sourceFiles,
  candidateStart: fingerprint(),
  candidateEnd: null,
  appStart: null,
  appEnd: null
};

const art = require(path.join(avatarDir, 'artwork.js'));
const baseline = require(path.join(root, '.intentgraph', 'baselines', 'avatar-four-approved', 'avatar-system', 'artwork.js'));
const roles = art.roles;
const sizes = art.tokens.sizes;
const allParts = ['character', 'feet', 'appendages', 'body', 'details', 'eyebrows', 'eyes', 'mouth'];
let browser;

function addCheck(name, status, detail) {
  const item = { name, status };
  if (detail) item.detail = detail;
  report.checks.push(item);
  console.log(`${status === 'PASS' ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}

async function check(name, fn) {
  try { await fn(); addCheck(name, 'PASS'); }
  catch (error) { addCheck(name, 'FAIL', error.message); }
}

function trackPage(page, viewportLabel) {
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => report.errors.push({ viewport: viewportLabel, message: error.message }));
  page.on('request', request => {
    if (/^https?:/i.test(request.url()) && !request.url().startsWith(base + '/')) {
      report.externalRequests.push({ viewport: viewportLabel, url: request.url(), method: request.method() });
    }
  });
}

async function newPage(viewport, label, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport, reducedMotion });
  const page = await context.newPage();
  trackPage(page, label);
  await page.addInitScript(() => {
    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;
    const originalClear = Storage.prototype.clear;
    window.__storageWrites = [];
    Storage.prototype.setItem = function(key, value) {
      window.__storageWrites.push({ op: 'setItem', storage: this === localStorage ? 'local' : 'session', key, value });
      return originalSet.call(this, key, value);
    };
    Storage.prototype.removeItem = function(key) {
      window.__storageWrites.push({ op: 'removeItem', storage: this === localStorage ? 'local' : 'session', key });
      return originalRemove.call(this, key);
    };
    Storage.prototype.clear = function() {
      window.__storageWrites.push({ op: 'clear', storage: this === localStorage ? 'local' : 'session' });
      return originalClear.call(this);
    };
  });
  await page.goto(`${base}/avatar-system/gallery.html`, { waitUntil: 'networkidle' });
  await page.locator('#gallery').waitFor();
  return { context, page };
}

function renderReactNetworkAvatar() {
  let source = fs.readFileSync(path.join(avatarDir, 'react', 'NetworkAvatar.tsx'), 'utf8');
  source = source.replace(/^import ['"]\.\.\/avatar\.css['"];\r?\n/m, '');
  const compiled = esbuild.transformSync(source, { loader: 'tsx', format: 'cjs', platform: 'node', target: 'es2020' }).code;
  const mod = new Module(path.join(avatarDir, 'react', '__qa_network_avatar.cjs'), module);
  mod.filename = path.join(avatarDir, 'react', '__qa_network_avatar.cjs');
  mod.paths = Module._nodeModulePaths(path.dirname(mod.filename));
  mod._compile(compiled, mod.filename);
  return mod.exports;
}

function svgInner(markup) {
  const match = markup.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
  assert(match, 'rendered markup did not contain an svg');
  return match[1];
}

async function main() {
  browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    ignoreDefaultArgs: ['--headless'],
    args: ['--headless=new']
  });
  try {
    await check('artwork exposes 16 roles and 6 application sizes', () => {
      assert.equal(roles.length, 16);
      assert.deepEqual(sizes, [20, 24, 32, 48, 64, 96]);
      assert.equal(new Set(roles).size, 16);
    });

    await check('approved four inner geometry remains exact at all six sizes', () => {
      for (const role of ['cloud', 'router', 'firewall', 'switch']) {
        for (const size of sizes) assert.equal(art.inner(role, size), baseline.inner(role, size), `${role} ${size}px`);
      }
    });

    await check('all 16 exported SVGs are valid named-group assets without external/PNG assets', async () => {
      const files = fs.readdirSync(path.join(avatarDir, 'svg')).filter(file => file.endsWith('.svg')).sort();
      assert.deepEqual(files, roles.map(role => `${role}.svg`).sort(), 'SVG export set mismatch');
      const samples = Object.fromEntries(files.map(file => [file, fs.readFileSync(path.join(avatarDir, 'svg', file), 'utf8')]));
      for (const role of roles) {
        const markup = samples[`${role}.svg`];
        assert.equal(markup.trim(), `${art.svg(role, 96)}\n`.trim(), `${role}.svg is stale vs artwork.js`);
        assert(!/<(?:image|iframe|object|use)\b/i.test(markup), `${role} contains external/image element`);
        assert(!/(?:href|xlink:href|url\(|data:image|\.png\b)/i.test(markup), `${role} contains external/PNG asset reference`);
        assert(!/https?:\/\//i.test(markup.replace('xmlns="http://www.w3.org/2000/svg"','')), `${role} contains external URL outside the required SVG namespace`);
      }
      const validity = await verifySvgDom(samples);
      assert.equal(validity.invalid.length, 0, JSON.stringify(validity.invalid));
      assert.equal(validity.missingParts.length, 0, JSON.stringify(validity.missingParts));
    });

    await check('generated React components transpile and render geometry parity for all 16 96px variants', () => {
      const reactExports = renderReactNetworkAvatar();
      assert.equal(typeof reactExports.NetworkAvatar, 'function');
      const React = require('react');
      const ReactDOMServer = require('react-dom/server');
      for (const role of roles) {
        const componentName = `${role.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('')}Avatar`;
        assert.equal(typeof reactExports[componentName], 'function', `${componentName} missing`);
        const html = ReactDOMServer.renderToStaticMarkup(React.createElement(reactExports.NetworkAvatar, { role, size: 96 }));
        assert.equal(svgInner(html), art.inner(role, 96), `${role} React geometry mismatch`);
      }
    });

    await check('gallery has all 16 still tiles and six active preview sizes', async () => {
      const { page, context } = await newPage({ width: 1440, height: 1000 }, 'gallery-1440');
      try {
        assert.equal(await page.locator('#gallery [data-gallery-role]').count(), 16);
        assert.equal(await page.locator('#roles [data-role]').count(), 16);
        assert.equal(await page.locator('#gallery .cw-avatar').count(), 16);
        assert.equal(await page.locator('#gallery .cw-avatar').first().getAttribute('width'), '64');
        assert.match(await page.locator('.comparison').innerText(), /Still · 64px/);
        for (const role of roles) {
          await page.locator(`#roles button[data-role="${role}"]`).click();
          assert.equal(await page.locator('#sizes .size-item').count(), 6, `${role} six size items`);
          const dimensions = await page.locator('#sizes .size-item svg').evaluateAll(nodes => nodes.map(node => [node.getAttribute('width'), node.getAttribute('height')]));
          assert.deepEqual(dimensions, sizes.map(size => [String(size), String(size)]), `${role} size dimensions`);
          assert.equal(await page.locator(`#roles [data-role="${role}"]`).getAttribute('aria-pressed'), 'true');
          assert.equal(await page.locator(`#gallery [data-gallery-role="${role}"]`).getAttribute('aria-pressed'), 'true');
        }
        await page.screenshot({ path: path.join(evidenceDir, 'avatar-family-gallery-qa-1440.png'), fullPage: true });
        report.captures.push('.intentgraph/avatar-family-gallery-qa-1440.png');
      } finally { await context.close(); }
    });

    await check('all 9 emotion controls, hover/focus, success to idle, and animation toggle work', async () => {
      const { page, context } = await newPage({ width: 1440, height: 1000 }, 'interaction-1440');
      try {
        assert.equal(await page.locator('#emotions [data-emotion-choice]').count(), 9);
        for (const emotion of art.tokens.states) {
          await page.locator(`[data-emotion-choice="${emotion}"]`).click();
          assert.equal(await page.locator('#active-art').getAttribute('data-emotion'), emotion, `${emotion} state`);
          assert.equal(await page.locator(`[data-emotion-choice="${emotion}"]`).getAttribute('aria-pressed'), 'true', `${emotion} selected state`);
        }
        await page.locator('[data-emotion-choice="idle"]').click();
        await page.locator('#stage').hover();
        assert.equal(await page.locator('#active-art').getAttribute('data-emotion'), 'hover', 'pointer hover response');
        await page.mouse.move(20, 20);
        assert.equal(await page.locator('#active-art').getAttribute('data-emotion'), 'idle', 'pointer leave idle response');
        await page.locator('#stage').focus();
        assert.equal(await page.locator('#active-art').getAttribute('data-emotion'), 'hover', 'keyboard focus response');
        await page.locator('#stage').blur();
        assert.equal(await page.locator('#active-art').getAttribute('data-emotion'), 'idle', 'keyboard blur idle response');
        await page.locator('[data-emotion-choice="success"]').click();
        await page.waitForTimeout(1250);
        assert.equal(await page.locator('#active-art').getAttribute('data-emotion'), 'idle', 'success did not return to idle');
        assert.equal(await page.locator('#animation').isChecked(), true);
        assert.equal(await page.locator('#active-art').getAttribute('class'), 'motion-active');
        await page.locator('#animation').uncheck();
        assert.equal(await page.locator('#active-art').getAttribute('class'), '');
        await page.locator('#animation').check();
        assert.equal(await page.locator('#active-art').getAttribute('class'), 'motion-active');
      } finally { await context.close(); }
    });

    await check('reduced motion suppresses animation and offscreen suppresses animation', async () => {
      const reduced = await newPage({ width: 1440, height: 1000 }, 'reduced-motion-1440', 'reduce');
      try {
        assert.equal(await reduced.page.locator('#active-art').getAttribute('class'), '');
        await reduced.page.locator('[data-emotion-choice="thinking"]').click();
        assert.equal(await reduced.page.locator('#active-art').getAttribute('class'), '');
      } finally { await reduced.context.close(); }

      const { page, context } = await newPage({ width: 1440, height: 1000 }, 'offscreen-1440');
      try {
        await page.locator('#stage').scrollIntoViewIfNeeded();
        await page.waitForTimeout(100);
        assert.equal(await page.locator('#active-art').getAttribute('class'), 'motion-active', 'visible stage did not animate');
        await page.setViewportSize({width:1440,height:600});
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(150);
        assert((await page.locator('#stage').boundingBox()).y>=600,'Stage must actually be offscreen');
        assert.equal(await page.locator('#active-art').getAttribute('class'), '', 'offscreen stage still animates');
      } finally { await context.close(); }
    });

    for (const viewport of [{ width: 390, height: 920 }, { width: 320, height: 920 }]) {
      const label = `gallery-${viewport.width}`;
      await check(`${label} has no horizontal overflow and retains gallery/size controls`, async () => {
        const { page, context } = await newPage(viewport, label);
        try {
          const metrics = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            bodyScrollWidth: document.body.scrollWidth,
            bodyClientWidth: document.body.clientWidth,
            gallery: document.querySelector('#gallery')?.getBoundingClientRect().toJSON(),
            sizeStrip: document.querySelector('#sizes')?.getBoundingClientRect().toJSON(),
            stage: document.querySelector('#stage')?.getBoundingClientRect().toJSON()
          }));
          assert(metrics.scrollWidth <= viewport.width + 1, `document overflow ${JSON.stringify(metrics)}`);
          assert(metrics.bodyScrollWidth <= metrics.bodyClientWidth + 1, `body overflow ${JSON.stringify(metrics)}`);
          assert.equal(await page.locator('#gallery [data-gallery-role]').count(), 16);
          assert.equal(await page.locator('#sizes .size-item').count(), 6);
          await page.screenshot({ path: path.join(evidenceDir, `avatar-family-gallery-qa-${viewport.width}.png`), fullPage: true });
          report.captures.push(`.intentgraph/avatar-family-gallery-qa-${viewport.width}.png`);
          report.viewportRuns.push({ viewport, metrics });
        } finally { await context.close(); }
      });
    }

    await check('gallery emits no page errors, external requests, or storage writes', () => {
      assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
      assert.equal(report.externalRequests.length, 0, JSON.stringify(report.externalRequests));
      assert.equal(report.storageWrites.length, 0, JSON.stringify(report.storageWrites));
    });
  } finally {
    report.candidateEnd = fingerprint();
    report.candidateStable = JSON.stringify(report.candidateStart) === JSON.stringify(report.candidateEnd);
    if(report.checks.some(c=>c.status!=='PASS') || !report.candidateStable) process.exitCode=1;
    fs.writeFileSync(path.join(evidenceDir, 'avatar-family-qa-results.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
}

async function verifySvgDom(samples) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();
  const result = await page.evaluate(({ samples, allParts }) => {
    const invalid = [], missingParts = [];
    for (const [file, markup] of Object.entries(samples)) {
      const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
      const root = doc.documentElement;
      if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) invalid.push(file);
      for (const part of allParts) if (!doc.querySelector(`g[data-part="${part}"]`)) missingParts.push(`${file}:${part}`);
    }
    return { invalid, missingParts };
  }, { samples, allParts });
  await context.close();
  return result;
}

main().catch(error => {
  report.fatal = error.stack || String(error);
  report.candidateEnd = fingerprint();
  fs.writeFileSync(path.join(evidenceDir, 'avatar-family-qa-results.json'), JSON.stringify(report, null, 2));
  console.error(error.stack || error);
  process.exitCode = 1;
});
