/* Network coworker avatar adapter. Artwork stays in avatar-system/artwork.js. */
(() => {
  'use strict';

  const art = globalThis.NetworkCoworkerArt;
  const styles = [
    'cloud', 'router', 'firewall', 'switch', 'load-balancer', 'wifi', 'dns-ddi', 'sd-wan',
    'leaf', 'spine', 'server', 'storage', 'vpn', 'proxy', 'monitoring', 'controller'
  ];
  const legacyAliases = { mesh: 'sd-wan', rack: 'server', wireless: 'wifi', fiber: 'controller' };
  const colors = ['#FAAE54', '#45c9b0', '#69a9f4', '#a387ed', '#ec709b', '#ec6a58', '#c5d46a', '#a8b9c8', '#f4a754'];
  const fallbackLabels = Object.fromEntries(styles.map(role => [role, role.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(' ')]));
  const labels = { ...fallbackLabels, ...(art?.labels || {}) };
  const artAmber = art?.tokens?.amber || '#FAAE54';
  const hash = text => [...String(text)].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 7);
  const normalizeStyle = style => {
    const candidate = String(style || '').trim().toLowerCase();
    const normalized = legacyAliases[candidate] || candidate;
    return styles.includes(normalized) ? normalized : '';
  };
  const labelFor = style => labels[style] || fallbackLabels[style] || style;

  let motionFrame = 0;
  let motionInstalled = false;
  let visibilityObserver = null;
  const visibilityState = new WeakMap();
  const observedNodes = new Set();

  function isOnscreen(node) {
    if (document.hidden || !node?.isConnected || !node.getClientRects().length) return false;
    const rect = node.getBoundingClientRect();
    return rect.bottom > 0 && rect.right > 0 && rect.top < globalThis.innerHeight && rect.left < globalThis.innerWidth;
  }

  function isLiveCandidate(node) {
    return !!node && !node.classList.contains('is-photo') && !node.closest('.avatar-style-grid') && !node.closest('.avatar-colors');
  }

  function firstVisible(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (isLiveCandidate(node) && isOnscreen(node)) return node;
    }
    return null;
  }

  function hasTransientInteraction(node) {
    if (node.matches(':hover')) return true;
    const owner = node.closest('.agent-open, .avatar-edit-button, #avatar');
    return !!owner?.matches(':focus-within');
  }

  function syncMotion() {
    for (const node of observedNodes) {
      if (!node.isConnected) {
        visibilityObserver?.unobserve(node);
        observedNodes.delete(node);
        visibilityState.delete(node);
      }
    }
    document.querySelectorAll('.network-avatar.motion-active').forEach(node => {
      node.classList.remove('motion-active');
      node.removeAttribute('data-emotion');
    });
    const next = firstVisible([
      '#right-pane:not([hidden]) .profile-avatar-wrap .network-avatar',
      '#agent-list .agent-open:focus-within .network-avatar',
      '#agent-list .sidebar-row.is-active .network-avatar',
      '#avatar .network-avatar'
    ]);
    if (!next) return;
    next.dataset.emotion = hasTransientInteraction(next) ? 'hover' : 'idle';
    if (!document.hidden && isOnscreen(next)) next.classList.add('motion-active');
  }

  function scheduleMotionSync() {
    if (motionFrame) return;
    const run = () => { motionFrame = 0; syncMotion(); };
    if (typeof globalThis.requestAnimationFrame === 'function') motionFrame = globalThis.requestAnimationFrame(run);
    else motionFrame = globalThis.setTimeout(run, 0);
  }

  function observeVisibility(node) {
    if (typeof globalThis.IntersectionObserver !== 'function' || node.classList.contains('avatar-choice') || node.classList.contains('is-photo')) return;
    visibilityObserver ||= new globalThis.IntersectionObserver(entries => {
      let changed = false;
      entries.forEach(entry => {
        const next = entry.isIntersecting;
        if (visibilityState.get(entry.target) !== next) {
          visibilityState.set(entry.target, next);
          changed = true;
        }
      });
      if (changed) scheduleMotionSync();
    }, { threshold: 0 });
    visibilityObserver.observe(node);
    observedNodes.add(node);
  }

  function installMotionController() {
    if (motionInstalled || typeof document === 'undefined') return;
    motionInstalled = true;
    ['pointerover', 'pointerout', 'focusin', 'focusout'].forEach(type => {
      document.addEventListener(type, event => {
        if (event.target.closest?.('.network-avatar, .agent-open, .avatar-edit-button, #avatar')) scheduleMotionSync();
      }, { passive: true });
    });
    document.addEventListener('visibilitychange', scheduleMotionSync, { passive: true });
    globalThis.addEventListener?.('resize', scheduleMotionSync, { passive: true });
    globalThis.addEventListener?.('pageshow', scheduleMotionSync, { passive: true });
  }

  function config(agent = {}) {
    const avatar = agent.avatar && typeof agent.avatar === 'object' ? agent.avatar : {};
    const style = normalizeStyle(avatar.style) || 'cloud';
    const color = /^#[0-9a-f]{6}$/i.test(avatar.color || '') ? avatar.color : colors[0];
    const numericSeed = Number(avatar.seed);
    const seed = Number.isFinite(numericSeed) ? numericSeed : 0;
    const image = /^data:image\/(png|jpeg|webp);base64,/.test(avatar.image || '') ? avatar.image : '';
    return { style, color, seed, image };
  }

  function svg(avatar, size) {
    if (!art?.svg) throw new Error('NetworkCoworkerArt is unavailable. Load avatar-system/artwork.js first.');
    return art.svg(avatar.style, size).replaceAll(artAmber, avatar.color);
  }

  function make(size = 'small', agent = {}) {
    const avatar = config(agent);
    const node = document.createElement('span');
    node.className = `network-avatar avatar-${size}`;
    node.setAttribute('aria-hidden', 'true');
    node.dataset.avatarRole = avatar.style;
    node.dataset.avatarLabel = labelFor(avatar.style);
    node.dataset.emotion = 'idle';
    node.style.setProperty('--avatar-color', avatar.color);
    node.style.setProperty('--blink-delay', -(hash(agent.id || agent.name || 'avatar') % 5000) / 1000 + 's');
    if (avatar.image) {
      node.classList.add('is-photo');
      const image = document.createElement('img');
      image.src = avatar.image;
      image.alt = '';
      node.append(image);
    } else {
      node.innerHTML = svg(avatar, ({ small: 48, choice: 64, large: 96 }[size] || 48));
    }
    observeVisibility(node);
    installMotionController();
    scheduleMotionSync();
    return node;
  }

  function generate(prompt, previous = {}) {
    const seed = hash(String(prompt || '') + ' ' + Date.now());
    const lower = String(prompt || '').toLowerCase();
    const role = styles.find(style => lower.includes(style)) || styles.find(style => lower.includes(labelFor(style).toLowerCase()));
    return { style: role || styles[seed % styles.length], color: colors[(seed >>> 5) % colors.length], seed, image: '' };
  }

  async function upload(file) {
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw Error('Choose a PNG, JPEG or WebP image.');
    if (file.size > 2 * 1024 * 1024) throw Error('Choose an image smaller than 2 MB.');
    const bitmap = await createImageBitmap(file).catch(() => { throw Error('This image could not be read. Try another file.'); });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 192;
    const ctx = canvas.getContext('2d');
    const scale = Math.max(192 / bitmap.width, 192 / bitmap.height);
    const width = bitmap.width * scale, height = bitmap.height * scale;
    ctx.drawImage(bitmap, (192 - width) / 2, (192 - height) / 2, width, height);
    bitmap.close();
    return canvas.toDataURL('image/webp', .86);
  }

  globalThis.AvenAvatars = { styles, colors, labels, labelFor, normalizeStyle, config, make, generate, upload, refreshMotion: scheduleMotionSync };
})();
