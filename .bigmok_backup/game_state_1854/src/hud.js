import { clamp } from './util.js';

/**
 * Thin view over the DOM. The HUD never holds game state: it is written to from
 * Game.update() every frame, so what is on screen is exactly what the sim thinks.
 */
export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.crosshair = document.getElementById('crosshair');
    this.crosshairArms = [...this.crosshair.querySelectorAll('i')];
    this.hitmarker = document.getElementById('hitmarker');
    this.healthValue = document.getElementById('health-value');
    this.healthBar = document.querySelector('#health-bar span');
    this.ammoWrap = document.getElementById('ammo');
    this.ammoMag = document.getElementById('ammo-mag');
    this.ammoReserve = document.getElementById('ammo-reserve');
    this.weaponName = document.getElementById('weapon-name');
    this.timerValue = document.getElementById('timer-value');
    this.timerPanel = document.getElementById('timer-panel');
    this.scoreValue = document.getElementById('score-value');
    this.waveValue = document.getElementById('wave-value');
    this.damage = document.getElementById('damage');
    this.feed = document.getElementById('feed');

    this.overlay = document.getElementById('overlay');
    this.overlayTitle = document.getElementById('overlay-title');
    this.overlayCopy = document.getElementById('overlay-copy');
    this.overlayKicker = document.getElementById('overlay-kicker');
    this.overlayKeys = document.getElementById('overlay-keys');
    this.playButton = document.getElementById('play');

    this.hitTimer = 0;
    this.feedItems = [];
    this._lastHealth = -1;
    this._lastMag = -1;
    this._lastReserve = -1;
    this._lastScore = -1;
    this._lastTimer = '';
    this._lastWave = '';
    this._damageOpacity = 0;
  }

  showOverlay(state) {
    this.overlay.classList.remove('hidden');
    this.overlay.classList.toggle('result-win', state.kind === 'win');
    this.overlay.classList.toggle('result-loss', state.kind === 'loss');
    this.overlayKicker.textContent = state.kicker;
    this.overlayTitle.textContent = state.title;
    this.overlayCopy.textContent = state.copy;
    this.playButton.textContent = state.button;
    if (this.overlayKeys) this.overlayKeys.style.display = state.kind === 'start' ? '' : 'none';
  }

  hideOverlay() {
    this.overlay.classList.add('hidden');
  }

  /** Expanding crosshair driven by the live cone, in degrees. */
  setSpread(deg, adsAmount) {
    // 26px box, 7px arms. `gap` is the clear space from centre to the arm tip,
    // so the arms visually open with the real cone.
    const px = clamp(deg * 13.0, 0, 30) * (1 - adsAmount * 0.72);
    const gap = 3 + px;
    const armLen = 7;
    const [top, bottom, left, right] = this.crosshairArms;
    top.style.top = `${Math.max(0, 13 - gap - armLen)}px`;
    bottom.style.top = `${Math.min(19, 13 + gap)}px`;
    left.style.left = `${Math.max(0, 13 - gap - armLen)}px`;
    right.style.left = `${Math.min(19, 13 + gap)}px`;
    this.crosshair.style.opacity = String(1 - adsAmount * 0.55);
  }

  hit(crit) {
    this.hitmarker.classList.add('on');
    this.hitmarker.classList.toggle('crit', !!crit);
    this.hitTimer = 0.14;
  }

  pushFeed(text, cls) {
    this.feedItems.push({ text, cls, life: 2.2 });
    if (this.feedItems.length > 4) this.feedItems.shift();
    this.renderFeed();
  }

  renderFeed() {
    this.feed.innerHTML = '';
    for (const it of this.feedItems) {
      const d = document.createElement('div');
      d.className = it.cls;
      d.textContent = it.text;
      this.feed.appendChild(d);
    }
  }

  update(dt, state) {
    // Health.
    const hp = Math.round(state.health);
    if (hp !== this._lastHealth) {
      this.healthValue.textContent = String(hp);
      const pct = clamp(hp / 100, 0, 1);
      this.healthBar.style.width = `${pct * 100}%`;
      this.healthBar.style.background = pct > 0.6 ? '#57e08a' : pct > 0.3 ? '#ffc44d' : '#ff3b30';
      this.healthValue.style.color = pct > 0.6 ? '#57e08a' : pct > 0.3 ? '#ffc44d' : '#ff3b30';
      this._lastHealth = hp;
    }

    // Ammo.
    if (state.mag !== this._lastMag || state.reserve !== this._lastReserve) {
      this.ammoMag.textContent = String(state.mag);
      this.ammoReserve.textContent = String(state.reserve);
      this.ammoWrap.classList.toggle('low', state.mag > 0 && state.mag <= 6);
      this.ammoWrap.classList.toggle('empty', state.mag === 0);
      this._lastMag = state.mag;
      this._lastReserve = state.reserve;
    }
    if (state.weaponName && this.weaponName.textContent !== state.weaponName) {
      this.weaponName.textContent = state.weaponName;
    }

    // Timer, mm:ss.
    const t = Math.max(0, Math.ceil(state.timeLeft));
    const text = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    if (text !== this._lastTimer) {
      this.timerValue.textContent = text;
      this.timerPanel.classList.toggle('urgent', t <= 20);
      this._lastTimer = text;
    }

    // Score.
    if (state.score !== this._lastScore) {
      this.scoreValue.textContent = String(state.score);
      this._lastScore = state.score;
    }

    // Wave.
    const wave = `WAVE ${state.wave} / ${state.waves}  ·  ${state.remaining} LEFT`;
    if (wave !== this._lastWave) {
      this.waveValue.textContent = wave;
      this._lastWave = wave;
    }

    // Crosshair + hitmarker.
    this.setSpread(state.spreadDeg, state.ads);
    this.hitTimer -= dt;
    if (this.hitTimer <= 0) this.hitmarker.classList.remove('on');

    // Damage vignette.
    this._damageOpacity = Math.max(state.hurtFlash, this._damageOpacity - dt * 1.8);
    this.damage.style.opacity = String(clamp(this._damageOpacity, 0, 1));

    // Feed lifetimes.
    if (this.feedItems.length) {
      let changed = false;
      for (let i = this.feedItems.length - 1; i >= 0; i--) {
        this.feedItems[i].life -= dt;
        if (this.feedItems[i].life <= 0) {
          this.feedItems.splice(i, 1);
          changed = true;
        }
      }
      if (changed) this.renderFeed();
    }
  }

  setVisible(visible) {
    this.root.style.opacity = visible ? '1' : '0';
    this.root.style.transition = 'opacity 180ms linear';
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * Standalone HUD factory.
 *
 *   createHud() -> { onPlay, setHealth, setAmmo, setTimer, setScore,
 *                    setMessage, showEnd, hideEnd }
 *
 * Rules baked in here, not in the caller:
 *   · Only the ids that exist in index.html are touched — no invented nodes.
 *   · textContent is written only when the value actually changed (the DOM
 *     diff is what costs frames, not the string build).
 *   · The hitmarker is a 90 ms flash, measured on a monotonic clock.
 *   · Health reads red below 35 HP.
 *   · Every accessor is null-safe: a missing element is a no-op, never a throw,
 *     so the HUD can be built before the DOM or in a headless test.
 * ─────────────────────────────────────────────────────────────────────────── */

const HUD_IDS = {
  root: 'hud',
  crosshair: 'crosshair',
  hitmarker: 'hitmarker',
  healthValue: 'health-value',
  healthBar: 'health-bar',
  healthPanel: 'health-panel',
  ammoWrap: 'ammo',
  ammoMag: 'ammo-mag',
  ammoReserve: 'ammo-reserve',
  ammoSep: 'ammo-sep',
  ammoPanel: 'ammo-panel',
  weaponName: 'weapon-name',
  timerValue: 'timer-value',
  timerPanel: 'timer-panel',
  scoreValue: 'score-value',
  scorePanel: 'score-panel',
  waveValue: 'wave-value',
  wavePanel: 'wave-panel',
  feed: 'feed',
  damage: 'damage',
  overlay: 'overlay',
  overlayTitle: 'overlay-title',
  overlayCopy: 'overlay-copy',
  overlayKicker: 'overlay-kicker',
  overlayKeys: 'overlay-keys',
  overlayFoot: 'overlay-foot',
  play: 'play',
};

const HITMARKER_MS = 90;
const LOW_HEALTH = 35;

/** A detached stub that swallows every property write, used when the DOM is absent. */
function nullNode() {
  const node = {
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    textContent: '',
    children: [],
    appendChild() {},
    removeChild() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return node;
}

export function createHud(options = {}) {
  const doc = typeof document !== 'undefined' ? document : null;
  const nodes = new Map();
  const missing = new Set();
  const textCache = new Map();
  const clsCache = new Map();

  const el = (key) => {
    if (nodes.has(key)) return nodes.get(key);
    const id = HUD_IDS[key];
    let node = null;
    if (doc && id) {
      try {
        node = doc.getElementById(id);
      } catch {
        node = null;
      }
    }
    if (!node) {
      node = nullNode();
      missing.add(key);
    }
    nodes.set(key, node);
    return node;
  };

  /** Write text only when it differs from what this factory last wrote. */
  const setText = (key, value) => {
    const text = value === null || value === undefined ? '' : String(value);
    if (textCache.get(key) === text) return false;
    const node = el(key);
    try {
      node.textContent = text;
    } catch {
      return false;
    }
    textCache.set(key, text);
    return true;
  };

  /** Toggle a class only when the state flips. */
  const setClass = (key, name, on) => {
    const ck = `${key}:${name}`;
    if (clsCache.get(ck) === !!on) return false;
    const node = el(key);
    try {
      node.classList.toggle(name, !!on);
    } catch {
      return false;
    }
    clsCache.set(ck, !!on);
    return true;
  };

  const setStyle = (key, prop, value) => {
    const node = el(key);
    if (!node || !node.style) return false;
    if (node.style[prop] === value) return false;
    try {
      node.style[prop] = value;
    } catch {
      return false;
    }
    return true;
  };

  // ---- play button ------------------------------------------------------
  let playHandler = typeof options.onPlay === 'function' ? options.onPlay : null;
  const button = el('play');
  if (doc && button && typeof button.addEventListener === 'function') {
    button.addEventListener('click', () => {
      if (typeof playHandler === 'function') playHandler();
    });
  }

  // ---- hitmarker --------------------------------------------------------
  // Deadline on performance.now(); update(dt) also advances a mirror countdown
  // so the marker clears even if the clock is faked in a test.
  let hitUntil = 0;
  let hitLeft = 0;
  let clearTimer = 0;

  const clearHit = () => {
    hitLeft = 0;
    hitUntil = 0;
    setClass('hitmarker', 'on', false);
  };

  const hit = (crit = false) => {
    setClass('hitmarker', 'crit', !!crit);
    setClass('hitmarker', 'on', true);
    hitLeft = HITMARKER_MS / 1000;
    const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    hitUntil = now + HITMARKER_MS;
    if (clearTimer) clearTimeout(clearTimer);
    if (typeof setTimeout === 'function') {
      clearTimer = setTimeout(() => {
        clearTimer = 0;
        clearHit();
      }, HITMARKER_MS);
    }
    return true;
  };

  // ---- public setters ---------------------------------------------------
  const setHealth = (hp, max = 100) => {
    const health = Math.max(0, Math.min(max, Number(hp) || 0));
    const rounded = Math.round(health);
    setText('healthValue', rounded);
    const pct = max > 0 ? health / max : 0;
    setStyle('healthBar', 'width', `${(pct * 100).toFixed(1)}%`);
    const critical = rounded < LOW_HEALTH;
    const colour = critical ? '#ff3b30' : pct > 0.6 ? '#57e08a' : '#ffc44d';
    setStyle('healthValue', 'color', colour);
    setClass('healthPanel', 'critical', critical);
    setClass('healthPanel', 'low', !critical && pct <= 0.6);
    const bar = el('healthBar');
    // The bar is a wrapper with an inner span on this page; colour the fill.
    if (bar && bar.firstElementChild && bar.firstElementChild.style) {
      if (bar.firstElementChild.style.background !== colour) bar.firstElementChild.style.background = colour;
    } else {
      setStyle('healthBar', 'background', colour);
    }
    return rounded;
  };

  const setAmmo = (mag, reserve) => {
    const m = Math.max(0, Math.floor(Number(mag) || 0));
    const r = Math.max(0, Math.floor(Number(reserve) || 0));
    setText('ammoMag', m);
    setText('ammoReserve', r);
    setClass('ammoWrap', 'low', m > 0 && m <= 6);
    setClass('ammoWrap', 'empty', m === 0);
    setStyle('ammoSep', 'opacity', m === 0 ? '0.35' : '1');
    return { mag: m, reserve: r };
  };

  const formatTime = (seconds) => {
    const t = Math.max(0, Math.ceil(Number(seconds) || 0));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };

  const setTimer = (seconds) => {
    const text = formatTime(seconds);
    setText('timerValue', text);
    setClass('timerPanel', 'urgent', Math.max(0, Number(seconds) || 0) <= 20);
    return text;
  };

  const setScore = (score) => {
    const n = Math.round(Number(score) || 0);
    setText('scoreValue', n);
    return n;
  };

  const setMessage = (text, kind = '') => {
    // One message slot: replaces the feed contents rather than stacking, so a
    // repeated "TAKING FIRE" cannot grow the DOM node count.
    const msg = text === null || text === undefined ? '' : String(text);
    const feed = el('feed');
    if (missing.has('feed')) {
      if (textCache.get('message') === msg) return false;
      textCache.set('message', msg);
      return true;
    }
    if (textCache.get('message') === msg && textCache.get('messageKind') === kind) return false;
    textCache.set('message', msg);
    textCache.set('messageKind', kind);
    try {
      feed.textContent = '';
      if (!msg) return true;
      const line = doc.createElement('div');
      line.className = kind || '';
      line.textContent = msg;
      feed.appendChild(line);
    } catch {
      return false;
    }
    return true;
  };

  const showEnd = (title, copy = '', opts = {}) => {
    const overlay = el('overlay');
    const lose = opts.win === false || opts.kind === 'loss';
    try {
      overlay.classList.remove('hidden');
      overlay.classList.toggle('result-win', opts.win === true || opts.kind === 'win');
      overlay.classList.toggle('result-loss', lose);
    } catch {
      /* stub node */
    }
    if (title !== undefined) setText('overlayTitle', title);
    if (copy !== undefined && copy !== '') setText('overlayCopy', copy);
    if (opts.kicker !== undefined) setText('overlayKicker', opts.kicker);
    if (opts.button !== undefined) setText('play', opts.button);
    else setText('play', lose ? 'Try Again' : 'Run It Back');
    setClass('overlayKeys', 'hidden', true);
    const keys = el('overlayKeys');
    if (keys && keys.style) keys.style.display = 'none';
    return true;
  };

  const hideEnd = () => {
    const overlay = el('overlay');
    try {
      overlay.classList.add('hidden');
      overlay.classList.remove('result-win');
      overlay.classList.remove('result-loss');
    } catch {
      /* stub node */
    }
    const keys = el('overlayKeys');
    if (keys && keys.style) keys.style.display = '';
    setClass('overlayKeys', 'hidden', false);
    return true;
  };

  /** Time-based housekeeping for the hitmarker. Optional but cheap. */
  const update = (dt) => {
    if (hitLeft > 0) {
      hitLeft -= Math.max(0, dt || 0);
      if (hitLeft <= 0 && clearTimer === 0) clearHit();
    }
  };

  const setWeaponName = (name) => setText('weaponName', name);
  const setWave = (wave, total) => {
    const text = total ? `WAVE ${wave} / ${total}` : `WAVE ${wave}`;
    setText('waveValue', text);
    return text;
  };
  const setVisible = (visible) => {
    setStyle('root', 'opacity', visible ? '1' : '0');
    return true;
  };
  const setDamage = (amount) => setStyle('damage', 'opacity', String(Math.max(0, Math.min(1, amount || 0))));

  const api = {
    // Writable so a rig can attach its handler after construction.
    get onPlay() { return playHandler; },
    set onPlay(fn) { playHandler = typeof fn === 'function' ? fn : null; },
    setHealth,
    setAmmo,
    setTimer,
    setScore,
    setMessage,
    showEnd,
    hideEnd,
    // Extras: feedback + lifecycle helpers used by the render loop.
    hit,
    update,
    setWeaponName,
    setWave,
    setVisible,
    setDamage,
    formatTime,
    ids: HUD_IDS,
    nodes,
  };

  return api;
}
