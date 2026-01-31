/**
 * Reusable replay player component for frame-by-frame analysis.
 * Renders controls (seek, play/pause, speed) and calls onFrameChange when the current frame changes.
 * Fits simulation/ architecture: host supplies canvas and render logic; player owns playback state and UI.
 */
(function (global) {
  'use strict';

  const DEFAULT_SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];

  class ReplayPlayer {
    /**
     * @param {HTMLElement} container - Element to mount controls into
     * @param {object} options
     * @param {function(index, frame)} options.onFrameChange - Called when current frame changes (host should pushState and render)
     */
    constructor(container, options = {}) {
      this.container = container;
      this.onFrameChange = typeof options.onFrameChange === 'function' ? options.onFrameChange : () => {};
      this._frames = [];
      this._index = 0;
      this._playing = false;
      this._speed = 1;
      this._intervalId = null;
      this._buildDOM();
    }

    _buildDOM() {
      if (!this.container) return;
      this.container.innerHTML = '';
      this.container.className = 'replay-player';
      const wrap = document.createElement('div');
      wrap.className = 'replay-player__controls';
      const btn = (label, title, cls = '') => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'replay-player__btn secondary' + (cls ? ' ' + cls : '');
        b.textContent = label;
        b.title = title || label;
        return b;
      };
      this._btnFirst = btn('|\u25c0', 'First frame');
      this._btnPrev = btn('\u25c0', 'Previous frame');
      this._btnPlay = btn('Play', 'Play');
      this._btnNext = btn('\u25b6', 'Next frame');
      this._btnLast = btn('\u25b6|', 'Last frame');
      this._status = document.createElement('span');
      this._status.className = 'replay-player__status';
      this._status.textContent = '—';
      const speedLabel = document.createElement('label');
      speedLabel.className = 'replay-player__speed-label';
      speedLabel.textContent = 'Speed';
      this._speedSelect = document.createElement('select');
      this._speedSelect.className = 'replay-player__speed';
      DEFAULT_SPEED_OPTIONS.forEach((s) => {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = s + '\u00d7';
        o.selected = s === 1;
        this._speedSelect.appendChild(o);
      });
      this._slider = document.createElement('input');
      this._slider.type = 'range';
      this._slider.min = 0;
      this._slider.max = 0;
      this._slider.value = 0;
      this._slider.className = 'replay-player__slider';

      wrap.appendChild(this._btnFirst);
      wrap.appendChild(this._btnPrev);
      wrap.appendChild(this._btnPlay);
      wrap.appendChild(this._btnNext);
      wrap.appendChild(this._btnLast);
      wrap.appendChild(this._status);
      wrap.appendChild(speedLabel);
      wrap.appendChild(this._speedSelect);
      this.container.appendChild(wrap);
      this.container.appendChild(this._slider);

      this._btnFirst.addEventListener('click', () => this.goToFrame(0));
      this._btnPrev.addEventListener('click', () => this.goToFrame(Math.max(0, this._index - 1)));
      this._btnPlay.addEventListener('click', () => (this._playing ? this.pause() : this.play()));
      this._btnNext.addEventListener('click', () => this.goToFrame(Math.min(this._frames.length - 1, this._index + 1)));
      this._btnLast.addEventListener('click', () => this.goToFrame(Math.max(0, this._frames.length - 1)));
      this._speedSelect.addEventListener('change', () => {
        this._speed = parseFloat(this._speedSelect.value, 10);
      });
      this._slider.addEventListener('input', () => {
        const i = parseInt(this._slider.value, 10);
        if (i !== this._index) this.goToFrame(i);
      });
    }

    _updateUI() {
      const n = this._frames.length;
      const frame = this._frames[this._index];
      if (this._status) {
        this._status.textContent = n
          ? `Frame ${this._index + 1} / ${n}${frame && frame.step != null ? ` · Step ${frame.step}` : ''}`
          : '—';
      }
      if (this._slider) {
        this._slider.max = Math.max(0, n - 1);
        this._slider.value = this._index;
      }
      if (this._btnPlay) this._btnPlay.textContent = this._playing ? 'Pause' : 'Play';
      if (this._btnFirst) this._btnFirst.disabled = n === 0 || this._index === 0;
      if (this._btnPrev) this._btnPrev.disabled = n === 0 || this._index === 0;
      if (this._btnNext) this._btnNext.disabled = n === 0 || this._index >= n - 1;
      if (this._btnLast) this._btnLast.disabled = n === 0 || this._index >= n - 1;
    }

    _tick() {
      if (!this._playing || this._frames.length === 0) return;
      if (this._index >= this._frames.length - 1) {
        this.pause();
        return;
      }
      this._index++;
      this._updateUI();
      this.onFrameChange(this._index, this._frames[this._index]);
    }

    setFrames(frames) {
      this.pause();
      this._frames = Array.isArray(frames) ? frames : [];
      this._index = 0;
      this._updateUI();
      if (this._frames.length) this.onFrameChange(0, this._frames[0]);
    }

    play() {
      if (this._frames.length === 0) return;
      this._playing = true;
      this._speed = parseFloat(this._speedSelect.value, 10) || 1;
      const ms = Math.max(20, Math.round(50 / this._speed));
      this._intervalId = setInterval(() => this._tick(), ms);
      this._updateUI();
    }

    pause() {
      this._playing = false;
      if (this._intervalId) {
        clearInterval(this._intervalId);
        this._intervalId = null;
      }
      this._updateUI();
    }

    stop() {
      this.pause();
      this._index = 0;
      this._updateUI();
      if (this._frames.length) this.onFrameChange(0, this._frames[0]);
    }

    goToFrame(i) {
      const n = this._frames.length;
      if (n === 0) return;
      this._index = Math.max(0, Math.min(n - 1, i));
      this._updateUI();
      this.onFrameChange(this._index, this._frames[this._index]);
    }

    getCurrentFrame() {
      return this._frames[this._index] || null;
    }

    getFrames() {
      return this._frames.slice();
    }

    getIndex() {
      return this._index;
    }
  }

  global.ReplayPlayer = ReplayPlayer;
})(typeof window !== 'undefined' ? window : globalThis);
