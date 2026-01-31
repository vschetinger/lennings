/**
 * Simulation page: wires UI to SimulationRunner.
 * Future-friendly: add new modes or libraries by extending run modes and result handlers.
 */

(function () {
  'use strict';

  const Runner = window.SimulationRunner;
  if (!Runner) {
    document.getElementById('runStatus').textContent = 'Runner not loaded.';
    return;
  }

  let paramMap = {};
  let gl = null;
  let lenia = null;
  let imageObjectUrl = null;

  const runBtn = document.getElementById('runBtn');
  const runStatus = document.getElementById('runStatus');
  const imageStatus = document.getElementById('imageStatus');
  const imageFile = document.getElementById('imageFile');
  const runMode = document.getElementById('runMode');
  const sweepOptions = document.getElementById('sweepOptions');
  const sweepGrid = document.getElementById('sweepGrid');
  const resultsEl = document.getElementById('results');
  const progressPanel = document.getElementById('progressPanel');
  const progressBar = document.getElementById('progressBar');
  const progressStats = document.getElementById('progressStats');
  let lastRuns = [];
  let replayPlayer = null;

  function getParamOverridesFromPanel() {
    const overrides = {};
    document.querySelectorAll('[data-param-key]').forEach(el => {
      const key = el.dataset.paramKey;
      const startEl = document.getElementById('param_start_' + key);
      if (startEl && startEl.value !== '') {
        const v = parseFloat(startEl.value);
        if (!Number.isNaN(v)) overrides[key] = v;
      }
    });
    return overrides;
  }

  function getRunOptions() {
    const spawnX = parseFloat(document.getElementById('spawnX').value) || 0;
    const spawnY = parseFloat(document.getElementById('spawnY').value) || 0;
    const spawnCount = Math.min(2048, Math.max(1, parseInt(document.getElementById('spawnCount').value, 10) || 256));
    const numSteps = Math.max(100, parseInt(document.getElementById('numSteps').value, 10) || 500);
    const sampleInterval = Math.max(0, parseInt(document.getElementById('sampleInterval').value, 10) || 100);
    const captureInterval = Math.max(1, parseInt(document.getElementById('captureInterval').value, 10) || 10);
    const seedEl = document.getElementById('seed');
    const seed = seedEl && seedEl.value.trim();
    return {
      spawnCenter: [spawnX, spawnY],
      spawnCount,
      numSteps,
      sampleInterval,
      captureInterval,
      seed: seed || undefined,
      imageUrl: imageObjectUrl || '../zenarnie.jpg',
      runConfig: Runner.RUN_CONFIG_DEFAULTS,
      paramOverrides: getParamOverridesFromPanel(),
    };
  }

  function ensureLenia() {
    if (lenia) return lenia;
    if (!gl) {
      const ctx = Runner.createContext();
      gl = ctx.gl;
    }
    if (!paramMap || Object.keys(paramMap).length === 0) {
      runStatus.textContent = 'Load parameters first.';
      return null;
    }
    lenia = Runner.createLenia(gl, paramMap);
    return lenia;
  }

  /**
   * Compute view center and extent from captured state so the "camera" frames
   * the area of alive cells with padding. Uses state0 (world positions in .xy).
   * @param {{ state0: Float32Array }} state - Captured state from fetchState
   * @param {[number, number]} stateSize - [sx, sy] grid size (default [32, 16])
   * @param {{ padding?: number, minExtent?: number }} options
   * @returns {{ viewCenter: [number, number], viewExtent: number }}
   */
  function getViewFromState(state, stateSize = [32, 16], options = {}) {
    const padding = options.padding != null ? options.padding : 1.75;
    const minExtent = options.minExtent != null ? options.minExtent : 14;
    const state0 = state && state.state0;
    if (!state0 || !state0.length) {
      return { viewCenter: [0, 0], viewExtent: minExtent };
    }
    const [sx, sy] = stateSize;
    const n = sx * sy;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const base = i * 4;
      const x = state0[base];
      if (x <= -10000) continue; // dead slot
      const y = state0[base + 1];
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (count === 0) {
      return { viewCenter: [0, 0], viewExtent: minExtent };
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const halfW = Math.max((maxX - minX) / 2, 0.1);
    const halfH = Math.max((maxY - minY) / 2, 0.1);
    const viewExtent = Math.max(minExtent, Math.max(halfW, halfH) * padding);
    return { viewCenter: [cx, cy], viewExtent };
  }

  function buildSweepRows() {
    const n = Math.min(5, Math.max(2, parseInt(sweepGrid.value, 10) || 2));
    const [sx, sy] = getRunOptions().spawnCenter;
    const step = 15;
    const rows = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const cx = sx + (j - (n - 1) / 2) * step;
        const cy = sy + (i - (n - 1) / 2) * step;
        rows.push({ spawnCenter: [cx, cy] });
      }
    }
    return rows;
  }

  function renderResults(data) {
    const runs = Array.isArray(data) ? data : [data];
    if (runs.length === 0) {
      resultsEl.innerHTML = '<p class="status">No results.</p>';
      return;
    }
    const lastMetrics = runs.map(r => {
      const m = r.metrics && r.metrics.length ? r.metrics[r.metrics.length - 1] : null;
      return m ? { step: m.step, aliveCount: m.aliveCount, eatenCount: m.eatenCount ?? '—' } : { step: 0, aliveCount: 0, eatenCount: '—' };
    });
    const colCount = 6 + (runs[0].sweepRow && Object.keys(runs[0].sweepRow).length ? 1 : 0);
    let html = '<table><thead><tr><th>Run</th><th></th><th>Steps</th><th>Alive (final)</th><th>Eaten (final)</th>';
    if (runs[0].sweepRow && Object.keys(runs[0].sweepRow).length) {
      html += '<th>Sweep</th>';
    }
    html += '</tr></thead><tbody>';
    runs.forEach((r, i) => {
      const lm = lastMetrics[i];
      const hasStates = r.states && r.states.length;
      const playLabel = hasStates ? '▶' : '';
      const playBtn = hasStates
        ? `<button type="button" class="play-run-btn" data-run-index="${i}" title="Expand/collapse replay">${playLabel}</button>`
        : '';
      html += `<tr><td>${r.runIndex != null ? r.runIndex : i}</td><td>${playBtn}</td><td>${r.steps ?? 0}</td><td>${lm.aliveCount}</td><td>${lm.eatenCount}</td>`;
      if (r.sweepRow && Object.keys(r.sweepRow).length) {
        const sc = r.sweepRow.spawnCenter;
        html += `<td>${sc ? `[${sc[0].toFixed(0)}, ${sc[1].toFixed(0)}]` : '-'}</td>`;
      }
      html += '</tr>';
      html += `<tr class="replay-detail-row" data-run-index="${i}" style="display:none"><td colspan="${colCount}"><div class="replay-row-content"></div></td></tr>`;
    });
    html += '</tbody></table>';
    resultsEl.innerHTML = html;
    resultsEl.querySelectorAll('.play-run-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.runIndex, 10);
        const run = lastRuns && lastRuns[idx];
        if (!run || !run.states || !run.states.length) return;
        const detailRow = resultsEl.querySelector(`.replay-detail-row[data-run-index="${idx}"]`);
        const content = detailRow && detailRow.querySelector('.replay-row-content');
        if (!detailRow || !content) return;
        const isVisible = detailRow.style.display !== 'none';
        if (isVisible) {
          detailRow.style.display = 'none';
          btn.textContent = '▶';
          return;
        }
        detailRow.style.display = '';
        btn.textContent = '▼';
        if (content.children.length === 0) {
          buildRowReplayPlayer(content, run, idx);
        }
      });
    });
  }

  function buildRowReplayPlayer(container, run, runIndex) {
    const sim = ensureLenia();
    if (!sim || !gl || !gl.canvas) return;
    const stateSize = sim.state_size || [32, 16];
    const renderW = 512;
    const renderH = 512;
    if (gl.canvas.width !== renderW || gl.canvas.height !== renderH) {
      gl.canvas.width = renderW;
      gl.canvas.height = renderH;
    }
    const canvas2d = document.createElement('canvas');
    canvas2d.width = 400;
    canvas2d.height = 400;
    canvas2d.className = 'replay-row-canvas';
    canvas2d.style.display = 'block';
    canvas2d.style.maxWidth = '100%';
    canvas2d.style.background = '#0a0a12';
    const controlsWrap = document.createElement('div');
    controlsWrap.className = 'replay-row-controls';
    container.appendChild(canvas2d);
    container.appendChild(controlsWrap);
    const ctx2d = canvas2d.getContext('2d');
    const drawFrame = (frame) => {
      if (!frame || !frame.state || !sim) return;
      sim.pushState(frame.state);
      const view = getViewFromState(frame.state, stateSize);
      sim.render(null, { viewCenter: view.viewCenter, viewExtent: view.viewExtent });
      ctx2d.drawImage(gl.canvas, 0, 0, gl.canvas.width, gl.canvas.height, 0, 0, canvas2d.width, canvas2d.height);
    };
    const player = new window.ReplayPlayer(controlsWrap, {
      onFrameChange: (index, frame) => { drawFrame(frame); },
    });
    player.setFrames(run.states);
  }

  function showProgress(show) {
    progressPanel.classList.toggle('running', !!show);
    if (!show) {
      progressBar.style.width = '0%';
      progressStats.textContent = '—';
    }
  }

  function updateProgress(p) {
    const numSteps = p.numSteps || 1;
    const stepProgress = p.step != null ? p.step / numSteps : 0;
    let pct = stepProgress * 100;
    if (p.totalRuns != null && p.totalRuns > 0) {
      const runProgress = (p.runIndex || 0) / p.totalRuns;
      pct = (runProgress + stepProgress / p.totalRuns) * 100;
    }
    progressBar.style.width = Math.min(100, Math.round(pct * 10) / 10) + '%';
    let stats = `Step ${p.step ?? 0} / ${numSteps}`;
    if (p.aliveCount != null) stats += ` · Alive: ${p.aliveCount}`;
    if (p.eatenCount != null) stats += ` · Eaten: ${p.eatenCount}`;
    if (p.totalRuns != null && p.totalRuns > 1) stats += ` · Run ${(p.runIndex ?? 0) + 1} / ${p.totalRuns}`;
    progressStats.textContent = stats;
  }

  async function doRun() {
    runBtn.disabled = true;
    runStatus.textContent = 'Running…';
    runStatus.classList.remove('error');
    showProgress(true);
    try {
      const opts = getRunOptions();
      const sim = ensureLenia();
      if (!sim) {
        runStatus.textContent = 'Failed to create simulation.';
        runStatus.classList.add('error');
        showProgress(false);
        return;
      }
      const optsWithProgress = {
        ...opts,
        onProgress: updateProgress,
        captureStates: true,
      };
      let data;
      if (runMode.value === 'sweep') {
        const sweep = buildSweepRows();
        data = await Runner.runSweep(sim, { ...optsWithProgress, sweep });
      } else {
        data = await Runner.runOne(sim, optsWithProgress);
      }
      lastRuns = Array.isArray(data) ? data : [data];
      renderResults(data);
      runStatus.textContent = 'Done.';
    } catch (err) {
      runStatus.textContent = 'Error: ' + (err.message || String(err));
      runStatus.classList.add('error');
      console.error(err);
    } finally {
      runBtn.disabled = false;
      showProgress(false);
    }
  }

  runMode.addEventListener('change', () => {
    sweepOptions.style.display = runMode.value === 'sweep' ? 'block' : 'none';
  });

  imageFile.addEventListener('change', () => {
    if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
    imageObjectUrl = null;
    const file = imageFile.files[0];
    if (file) {
      imageObjectUrl = URL.createObjectURL(file);
      imageStatus.textContent = 'Loaded: ' + file.name;
    } else {
      imageStatus.textContent = 'Default: zenarnie.jpg (or choose a file).';
    }
  });

  runBtn.addEventListener('click', doRun);

  function exportConfig() {
    const opts = getRunOptions();
    opts.runMode = runMode.value;
    opts.sweepGrid = parseInt(sweepGrid.value, 10) || 2;
    const json = Runner.serializeRunConfig(opts);
    const str = JSON.stringify(json, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).then(() => {
        runStatus.textContent = 'Config copied to clipboard.';
        runStatus.classList.remove('error');
      }).catch(() => {
        runStatus.textContent = 'Copy failed. Config: ' + str.slice(0, 80) + '…';
      });
    } else {
      runStatus.textContent = 'Config (copy manually): ' + str.slice(0, 100) + '…';
    }
  }

  function applyImportedConfig(parsed) {
    if (!parsed) return;
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el && value !== undefined && value !== null) el.value = value;
    };
    set('spawnX', parsed.spawnCenter && parsed.spawnCenter[0]);
    set('spawnY', parsed.spawnCenter && parsed.spawnCenter[1]);
    set('spawnCount', parsed.spawnCount);
    set('numSteps', parsed.numSteps);
    set('sampleInterval', parsed.sampleInterval);
    set('seed', parsed.seed);
    if (parsed.runMode) runMode.value = parsed.runMode;
    if (parsed.sweepGrid != null) sweepGrid.value = parsed.sweepGrid;
    if (parsed.paramOverrides && typeof parsed.paramOverrides === 'object') {
      for (const [key, value] of Object.entries(parsed.paramOverrides)) {
        const startEl = document.getElementById('param_start_' + key);
        if (startEl && typeof value === 'number') startEl.value = value;
      }
    }
    runMode.dispatchEvent(new Event('change'));
  }

  const importConfigArea = document.getElementById('importConfigArea');
  const importConfigPaste = document.getElementById('importConfigPaste');
  const importConfigApply = document.getElementById('importConfigApply');
  const importConfigCancel = document.getElementById('importConfigCancel');
  const exportConfigBtn = document.getElementById('exportConfigBtn');
  const importConfigBtn = document.getElementById('importConfigBtn');

  if (exportConfigBtn) exportConfigBtn.addEventListener('click', exportConfig);
  if (importConfigBtn) {
    importConfigBtn.addEventListener('click', () => {
      if (importConfigArea) importConfigArea.style.display = 'block';
      if (importConfigPaste) { importConfigPaste.value = ''; importConfigPaste.focus(); }
    });
  }
  if (importConfigApply) {
    importConfigApply.addEventListener('click', () => {
      try {
        const str = importConfigPaste && importConfigPaste.value.trim();
        const parsed = str ? Runner.parseRunConfig(JSON.parse(str)) : null;
        applyImportedConfig(parsed);
        runStatus.textContent = parsed ? 'Config applied. Load the same image if needed, then Run.' : 'No valid config.';
        runStatus.classList.remove('error');
      } catch (e) {
        runStatus.textContent = 'Invalid JSON: ' + (e.message || e);
        runStatus.classList.add('error');
      }
      if (importConfigArea) importConfigArea.style.display = 'none';
    });
  }
  if (importConfigCancel) {
    importConfigCancel.addEventListener('click', () => {
      if (importConfigArea) importConfigArea.style.display = 'none';
    });
  }

  const playbackPanel = document.getElementById('playbackPanel');
  const playbackContainer = document.getElementById('playbackContainer');
  const playbackControlsEl = document.getElementById('playbackControls');
  const playbackCloseBtn = document.getElementById('playbackCloseBtn');

  function ensureReplayPlayer() {
    if (replayPlayer) return replayPlayer;
    const sim = ensureLenia();
    if (!sim) return null;
    const renderArgs = { viewCenter: [0, 0], viewExtent: 50 };
    replayPlayer = new window.ReplayPlayer(playbackControlsEl, {
      onFrameChange: (index, frame) => {
        if (!frame || !frame.state || !sim) return;
        sim.pushState(frame.state);
        sim.render(null, renderArgs);
      },
    });
    return replayPlayer;
  }

  function playRunStates(states) {
    if (!states || !states.length || !lenia || !gl) return;
    const sim = ensureLenia();
    if (!sim) return;
    const canvas = gl.canvas;
    if (!canvas) return;
    if (playbackContainer && !playbackContainer.contains(canvas)) {
      playbackContainer.appendChild(canvas);
    }
    canvas.width = 512;
    canvas.height = 512;
    canvas.style.display = 'block';
    canvas.style.maxWidth = '100%';
    if (playbackPanel) playbackPanel.style.display = 'block';
    const player = ensureReplayPlayer();
    if (player) {
      player.setFrames(states);
      player.play();
    }
  }

  if (playbackCloseBtn) {
    playbackCloseBtn.addEventListener('click', () => {
      if (replayPlayer) replayPlayer.pause();
      if (playbackPanel) playbackPanel.style.display = 'none';
    });
  }

  function buildSweepableParamsPanel(config) {
    const container = document.getElementById('sweepableParams');
    if (!container || !config) return;
    container.innerHTML = '';
    const skipCategories = new Set(['description', 'version']);
    for (const [category, catData] of Object.entries(config)) {
      if (skipCategories.has(category) || !catData.params) continue;
      const numeric = [];
      for (const [paramName, paramData] of Object.entries(catData.params)) {
        if (paramData == null || typeof paramData.value !== 'number') continue;
        if (paramData.min == null || paramData.max == null || paramData.step == null) continue;
        numeric.push({ key: paramName, ...paramData });
      }
      if (numeric.length === 0) continue;
      const section = document.createElement('div');
      section.className = 'params-section';
      const folderName = catData.folder || category;
      section.innerHTML = `<h3>${folderName}</h3>`;
      const grid = document.createElement('div');
      grid.className = 'params-grid';
      numeric.forEach(({ key, name, value, min, max, step }) => {
        const defaultWindow = ((max - min) / 2) || step;
        const row = document.createElement('div');
        row.className = 'param-row';
        row.dataset.paramKey = key;
        const label = document.createElement('label');
        label.className = 'param-name';
        label.textContent = name || key;
        label.title = key;
        const startInput = document.createElement('input');
        startInput.type = 'number';
        startInput.id = 'param_start_' + key;
        startInput.className = 'start';
        startInput.value = value;
        startInput.min = min;
        startInput.max = max;
        startInput.step = step;
        const windowInput = document.createElement('input');
        windowInput.type = 'number';
        windowInput.id = 'param_window_' + key;
        windowInput.className = 'window';
        windowInput.placeholder = '±';
        windowInput.value = defaultWindow.toFixed(step < 1 ? 2 : 0);
        windowInput.min = 0;
        windowInput.step = step;
        row.appendChild(label);
        row.appendChild(startInput);
        row.appendChild(windowInput);
        grid.appendChild(row);
      });
      section.appendChild(grid);
      container.appendChild(section);
    }
  }

  (async function init() {
    runStatus.textContent = 'Loading parameters…';
    const { config, paramMap: pm } = await Runner.loadParameters('..');
    paramMap = pm;
    buildSweepableParamsPanel(config);
    runStatus.textContent = 'Ready. Load an image (optional) and click Run.';
  })();
})();
