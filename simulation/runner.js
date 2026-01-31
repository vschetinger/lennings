/**
 * Headless simulation runner for parameter sweeps and batch runs.
 * Uses the same ParticleLenia core without rendering; future-friendly for
 * other backends or libraries (e.g. different metrics, optimizers).
 * With a seed, CPU reproduction uses a seeded PRNG so runs are reproducible.
 */

(function (global) {
  'use strict';

  /** Seeded PRNG (mulberry32). Returns a function that returns 0..1. Same seed => same sequence. */
  function createSeededPRNG(seed) {
    let s = typeof seed === 'string' ? hashString(seed) : (seed >>> 0);
    return function () {
      s = Math.imul(s ^ (s >>> 15), s | 1);
      s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
      return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i);
    return h >>> 0;
  }

  const RUN_CONFIG_DEFAULTS = {
    stepN: 3,
    consumeEnabled: true,
    enableLifeCycle: true,
    enableDeaths: true,
    enableReproduction: true,
    useCpuRepro: true,
    reproInterval: 50,
    maxChildrenPerParent: 2,
  };

  /**
   * Load parameters.json and return flat paramMap (same shape as main app).
   * @param {string} basePath - e.g. '.' or '..' for fetch path to parameters.json
   */
  async function loadParameters(basePath = '..') {
    try {
      const response = await fetch(`${basePath}/parameters.json`);
      const config = await response.json();
      const paramMap = {};
      for (const [category, catData] of Object.entries(config)) {
        if (category === 'description' || category === 'version') continue;
        if (catData.params) {
          for (const [paramName, paramData] of Object.entries(catData.params)) {
            paramMap[paramName] = paramData;
          }
        }
      }
      return { config, paramMap };
    } catch (e) {
      console.warn('Failed to load parameters.json:', e);
      return { config: {}, paramMap: {} };
    }
  }

  /**
   * Build a paramMap suitable for ParticleLenia from config + overrides.
   * Each key in paramMap must be { value } for uniforms.
   */
  function buildParamMap(baseParamMap, overrides = {}) {
    const paramMap = {};
    for (const [name, data] of Object.entries(baseParamMap)) {
      if (data && data.value !== undefined) {
        paramMap[name] = { ...data, value: overrides[name] !== undefined ? overrides[name] : data.value };
      }
    }
    for (const [name, value] of Object.entries(overrides)) {
      if (paramMap[name] == null) paramMap[name] = { value };
    }
    return paramMap;
  }

  /**
   * Create a WebGL2 context (hidden canvas). Call from page that has DOM.
   */
  function createContext() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    canvas.style.display = 'none';
    document.body.appendChild(canvas);
    const gl = canvas.getContext('webgl2', { alpha: false });
    if (!gl) throw new Error('WebGL2 not supported');
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    return { gl, canvas };
  }

  /**
   * Create a ParticleLenia instance for headless use (no GUI).
   */
  function createLenia(gl, paramMap) {
    const ParticleLenia = global.ParticleLenia || (typeof window !== 'undefined' && window.ParticleLenia);
    if (typeof ParticleLenia !== 'function') throw new Error('ParticleLenia not found. Ensure lenia.js is loaded before runner.js.');
    const lenia = new ParticleLenia(gl, null, paramMap);
    return lenia;
  }

  /**
   * Apply parameter overrides to lenia.U and sync w1 if m1/s1 changed.
   */
  function applyParamOverrides(lenia, overrides) {
    if (!overrides || Object.keys(overrides).length === 0) return;
    for (const [key, value] of Object.entries(overrides)) {
      if (lenia.U[key] !== undefined) lenia.U[key] = value;
    }
    if ('m1' in overrides || 's1' in overrides) lenia.syncW1();
  }

  /**
   * Run one simulation: optional image, reset, then N steps with life cycle; sample metrics.
   * @param {ParticleLenia} lenia
   * @param {object} options
   * @param {object} [options.paramOverrides] - override lenia.U for this run
   * @param {string} [options.imageUrl] - URL or object URL to load as resource image
   * @param {[number,number]} options.spawnCenter
   * @param {number} options.spawnCount
   * @param {number} options.numSteps
   * @param {number} [options.sampleInterval=100] - sample metrics every N steps
   * @param {object} [options.runConfig] - stepN, consumeEnabled, enableLifeCycle, etc.
   * @param {function} [options.onProgress] - called on each sample with { step, numSteps, aliveCount, eatenCount }
   * @param {number|string} [options.seed] - if set, use seeded PRNG for CPU reproduction (deterministic re-runs)
   * @param {boolean} [options.captureStates] - if true, save state snapshots for replay
   * @param {number} [options.captureInterval=10] - when captureStates, save every N steps (replay granularity)
   * @returns {Promise<{ steps: number, metrics: Array<...>, states?: Array<{ step, state }> }>}
   */
  async function runOne(lenia, options) {
    const {
      paramOverrides,
      imageUrl,
      spawnCenter = [0, 0],
      spawnCount = 256,
      numSteps = 1000,
      sampleInterval = 100,
      runConfig = {},
      onProgress,
      seed,
      captureStates = false,
      captureInterval = 10,
    } = options;

    const rc = { ...RUN_CONFIG_DEFAULTS, ...runConfig };
    applyParamOverrides(lenia, paramOverrides);

    if (imageUrl) {
      await lenia.loadResourceImage(imageUrl);
    } else if (!lenia.hasLoadedResource?.()) {
      lenia.clearResources();
    }

    lenia.reset(spawnCount, spawnCenter);
    lenia.eatenPixelsCache = null;

    const rng = seed != null && seed !== '' ? createSeededPRNG(seed) : null;
    const metrics = [];
    const states = captureStates ? [] : null;
    const stepN = rc.stepN;
    const runStep = () => {
      for (let i = 0; i < stepN; i++) {
        lenia.step({ clockRate: 0, paused: false, attractPos: [0, 0], attractRadius: 0 });
      }
      if (rc.consumeEnabled) lenia.consumeResources();
      if (rc.enableLifeCycle) {
        if (rc.enableDeaths) lenia.processDeaths();
        if (rc.enableReproduction) {
          if (rc.useCpuRepro && (lenia.stepCount || 0) % rc.reproInterval === 0) {
            lenia.cpuReproductionStep(rc.maxChildrenPerParent, rng);
          } else if (!rc.useCpuRepro) {
            lenia.processReproduction();
          }
        }
      }
    };

    let steps = 0;
    let lastSampled = 0;
    const maxFrames = Math.ceil(numSteps / stepN);
    const capInterval = Math.max(1, captureInterval);
    for (let frame = 0; frame < maxFrames; frame++) {
      runStep();
      steps = lenia.stepCount || 0;

      if (captureStates && states && (steps % capInterval === 0 || frame === maxFrames - 1)) {
        const state = lenia.fetchState();
        const last = states.length ? states[states.length - 1] : null;
        if (!last || last.step !== steps) {
          const snap = {
            state0: state.state0.slice(),
            state1: state.state1.slice(),
            select: state.select.slice(),
          };
          if (lenia.fetchResourceState && lenia.hasLoadedResource?.()) {
            snap.resourceTex = lenia.fetchResourceState().slice();
          }
          states.push({ step: steps, state: snap });
        }
      }

      if (sampleInterval > 0 && steps - lastSampled >= sampleInterval) {
        lastSampled = steps;
        const state = lenia.fetchState();
        let aliveCount = 0;
        for (let i = 0; i < state.state0.length; i += 4) {
          if (state.state0[i] > -10000) aliveCount++;
        }
        let eatenCount = null;
        if (lenia.getEatenPixels && lenia.hasLoadedResource?.()) {
          const eaten = lenia.getEatenPixels(true);
          eatenCount = eaten.length;
        }
        metrics.push({ step: steps, aliveCount, eatenCount });
        if (onProgress) {
          onProgress({ step: steps, numSteps, aliveCount, eatenCount });
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }

    if (onProgress) onProgress({ step: steps, numSteps, aliveCount: metrics.length ? metrics[metrics.length - 1].aliveCount : 0, eatenCount: metrics.length ? metrics[metrics.length - 1].eatenCount : null });

    let finalReconstruction = null;
    if (lenia.hasLoadedResource?.() && lenia.createCompressedReconstruction && lenia.getReconstructionDataURL) {
      try {
        await lenia.createCompressedReconstruction(true);
        const ssim = lenia.reconstructionSSIM;
        const dataURL = lenia.getReconstructionDataURL();
        if (dataURL != null) finalReconstruction = { ssim, dataURL };
      } catch (e) {
        console.warn('[Runner] Final reconstruction failed:', e);
      }
    }

    return { steps, metrics, states: captureStates ? states : undefined, finalReconstruction };
  }

  /**
   * Run a parameter sweep: multiple runs with different paramOverrides and/or spawn.
   * @param {ParticleLenia} lenia
   * @param {object} opts - same as runOne, plus:
   * @param {Array<object>} opts.sweep - list of { paramOverrides?, spawnCenter?, spawnCount? } (merged with opts)
   * @returns {Promise<Array<{ runIndex, steps, metrics, sweepRow }>>}
   */
  async function runSweep(lenia, opts) {
    const { sweep = [], onProgress: outerProgress, ...common } = opts;
    if (sweep.length === 0) {
      const result = await runOne(lenia, common);
      return [{ runIndex: 0, ...result, sweepRow: {} }];
    }
    const results = [];
    const totalRuns = sweep.length;
    for (let i = 0; i < sweep.length; i++) {
      if (outerProgress) outerProgress({ runIndex: i, totalRuns, step: 0, numSteps: common.numSteps || 1000, aliveCount: 0, eatenCount: null });
      await new Promise(r => setTimeout(r, 0));
      const row = sweep[i];
      const runOpts = {
        ...common,
        paramOverrides: { ...common.paramOverrides, ...row.paramOverrides },
        spawnCenter: row.spawnCenter ?? common.spawnCenter,
        spawnCount: row.spawnCount ?? common.spawnCount,
        onProgress: outerProgress
          ? (p) => outerProgress({ ...p, runIndex: i, totalRuns })
          : undefined,
      };
      const result = await runOne(lenia, runOpts);
      results.push({ runIndex: i, ...result, sweepRow: row });
    }
    return results;
  }

  /**
   * Serialize run options + seed to a JSON object for re-running later (same seed + config => same result).
   * Does not include imageUrl; load the same image separately when re-running.
   */
  function serializeRunConfig(options) {
    return {
      version: 1,
      seed: options.seed != null && options.seed !== '' ? options.seed : undefined,
      spawnCenter: options.spawnCenter,
      spawnCount: options.spawnCount,
      numSteps: options.numSteps,
      sampleInterval: options.sampleInterval,
      paramOverrides: options.paramOverrides || {},
      runConfig: options.runConfig,
      runMode: options.runMode,
      sweepGrid: options.sweepGrid,
    };
  }

  /**
   * Parse a previously serialized run config (e.g. from JSON file or paste).
   * Returns an object suitable for filling the UI or passing to runOne/runSweep.
   */
  function parseRunConfig(obj) {
    if (!obj || typeof obj !== 'object') return null;
    return {
      seed: obj.seed,
      spawnCenter: Array.isArray(obj.spawnCenter) ? obj.spawnCenter : [0, 0],
      spawnCount: typeof obj.spawnCount === 'number' ? obj.spawnCount : 256,
      numSteps: typeof obj.numSteps === 'number' ? obj.numSteps : 500,
      sampleInterval: typeof obj.sampleInterval === 'number' ? obj.sampleInterval : 100,
      paramOverrides: obj.paramOverrides && typeof obj.paramOverrides === 'object' ? obj.paramOverrides : {},
      runConfig: obj.runConfig && typeof obj.runConfig === 'object' ? obj.runConfig : {},
      runMode: obj.runMode,
      sweepGrid: obj.sweepGrid,
    };
  }

  global.SimulationRunner = {
    loadParameters,
    buildParamMap,
    createContext,
    createLenia,
    applyParamOverrides,
    runOne,
    runSweep,
    createSeededPRNG,
    serializeRunConfig,
    parseRunConfig,
    RUN_CONFIG_DEFAULTS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
