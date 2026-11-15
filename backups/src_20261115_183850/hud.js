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
