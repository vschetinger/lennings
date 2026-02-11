// Play mode entry point - migrated from play.html inline script

import { initStrudel, sound, hush, samples } from '@strudel/web';

// Legacy globals from script tags (lenia.js, game-engine.js, etc.)
const ParticleLenia = (window as any).ParticleLenia;
const LenningsGameEngine = (window as any).LenningsGameEngine;

const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { alpha: false })!;
gl.getExtension('EXT_color_buffer_float');
gl.getExtension('OES_texture_float_linear');

function calcNormCoef(m: number, s: number) {
  const dr = 0.1 * s;
  let acc = 0.0, prev: number | null = null;
  for (let r = Math.max(m - s * 3.0, 0.0); r < m + s * 3.0; r += dr) {
    const y = (r - m) / s;
    const v = r * Math.exp(-y * y);
    if (prev != null) acc += (prev + v) * 0.5;
    prev = v;
  }
  return 1.0 / (acc * dr * 2.0 * Math.PI);
}

// Global state
let lenia: any = null;
let params: any = null;
let gameEngine: any = null;
let prevGamepadButtons: Record<number, boolean> = {
  0: false, 2: false, 3: false, 4: false, 5: false, 6: false, 7: false,
  12: false, 13: false, 14: false, 15: false
};

function getParamValue(paramMap: Record<string, any>, paramName: string, defaultValue: any) {
  const param = paramMap[paramName];
  if (param && param.value !== undefined) return param.value;
  return defaultValue;
}

// UI Elements
const levelSelectEl = $('#levelSelect');
const gameHUDEl = $('#gameHUD');
const winOverlayEl = $('#winOverlay');
const pauseOverlayEl = $('#pauseOverlay');
const galleryOverlayEl = $('#galleryOverlay');
const similarityGraphOverlayEl = $('#similarityGraphOverlay');
const beatSetupOverlayEl = $('#beatSetupOverlay');

// Rhythm / beat pattern state
const BEAT_PATTERN_LENGTH = 4;
let beatSetupActive = false;
let beatPatternIds: string[] = [];
let beatLoopBpm = 120;
let skillBeatLoopEnabled = false;

const beatPatternBarEl = $('#beatPatternBar');
const beatPatternSlots = beatPatternBarEl ? Array.from(beatPatternBarEl.querySelectorAll('.beat-slot')) : [];
const beatSetupSlots = beatSetupOverlayEl ? Array.from(beatSetupOverlayEl.querySelectorAll('.beat-setup-slot')) : [];

let currentBeatPattern: any = null;
let strudelReady = false;
let strudelWarmed = false;
let strudelRepl: any = null; // repl from initStrudel, has setcpm
let beatUIRafId: number | null = null;
const STRUDEL_SAMPLES_URL = 'https://raw.githubusercontent.com/tidalcycles/Dirt-Samples/master/strudel.json';

/**
 * Sound design config: edit this to change the audio for each skill.
 * - pattern: Strudel mini-notation fragment (e.g. 'bd', '[sd sd sd]', '[hh hh]')
 * - bank: optional; use .bank("808bd") for different kits (808bd, 808sd, 808hc, glitch, feel, etc.)
 */
const SKILL_SOUNDS: Record<string, { pattern: string; bank?: string }> = {
  split: { pattern: 'bd' },
  burst: { pattern: '[hh hh hh hh]' },
  evolve: { pattern: 'sd' },
};

function initStrudelOnce(cb?: () => void) {
  if (strudelReady) { if (cb) cb(); return; }
  const prebake = async () => {
    try {
      await samples(STRUDEL_SAMPLES_URL);
    } catch (e) {
      console.warn('[Strudel] prebake samples:', e);
    }
  };
  const p = initStrudel({ prebake });
  const done = (repl?: any) => {
    strudelRepl = repl ?? strudelRepl;
    strudelReady = true;
    if (!strudelWarmed) {
      strudelWarmed = true;
      // Skip audible warmup (bd sd hh) to avoid ghost bass drum; user's pattern starts clean
    }
    if (cb) cb();
  };
  if (p && typeof (p as Promise<any>).then === 'function') (p as Promise<any>).then(done).catch(() => done());
  else done();
}

function patternFragmentForSkillId(id: string) {
  const cfg = SKILL_SOUNDS[id];
  return cfg?.pattern ?? '~';
}

function buildSoundPattern(patternString: string, bank?: string) {
  let pat = sound(patternString);
  if (bank) pat = (pat as any).bank(bank);
  return pat;
}

/**
 * Preload samples used by our skills so the first play is instant.
 * Plays a silent pattern to trigger loading, then hushes.
 */
async function preloadSkillSamples() {
  if (!strudelRepl) return;
  const fragments = Object.values(SKILL_SOUNDS).map((c) => c.pattern);
  const uniqueSounds = new Set<string>();
  fragments.forEach((f) => {
    f.replace(/~|-|\s|\[|\]|,/g, ' ').split(/\s+/).filter(Boolean).forEach((s) => uniqueSounds.add(s));
  });
  const preloadPattern = [...uniqueSounds].filter((s) => s.length > 0).join(' ');
  if (!preloadPattern) return;
  try {
    const pat = buildSoundPattern(preloadPattern).gain(0);
    if (pat?.play) pat.play();
    await new Promise((r) => setTimeout(r, 300));
    hush();
  } catch (e) {
    console.warn('[Strudel] preload samples:', e);
  }
}

/**
 * Preview a single skill's sound. Call from console: LenningsPreviewSound('split')
 * Or preview all: LenningsPreviewSound('split'), LenningsPreviewSound('burst'), etc.
 */
function previewSkillSound(skillId: string) {
  initStrudelOnce(() => {
    const cfg = SKILL_SOUNDS[skillId];
    if (!cfg) {
      console.warn(`[Strudel] No sound config for skill: ${skillId}`);
      return;
    }
    try {
      hush();
      const pat = buildSoundPattern(cfg.pattern, cfg.bank);
      if (pat?.play) pat.play();
      console.log(`[Strudel] Playing ${skillId}:`, cfg);
      setTimeout(() => hush(), 1500);
    } catch (e) {
      console.warn('[Strudel] preview error:', e);
    }
  });
}

// Expose for console testing
(window as any).LenningsPreviewSound = previewSkillSound;
(window as any).LenningsSkillSounds = SKILL_SOUNDS;

function buildBeatPatternString(patternIds: string[]) {
  const steps = (patternIds && patternIds.length ? patternIds : []).map(id => patternFragmentForSkillId(id));
  if (!steps.length) return '';
  // Use [ ] for 1-cycle sequence so all 4 steps play in one cycle.
  // Angle brackets < > would use polymeter_slowcat = 1 event per cycle (wrong).
  const pattern = `[ ${steps.join(' ')} ]`;
  console.log('[Strudel] beat pattern:', pattern);
  return pattern;
}

function resetBeatPatternState() {
  beatSetupActive = false;
  skillBeatLoopEnabled = false;
  beatPatternIds = [];
  stopSkillBeatLoop();
  if (beatPatternBarEl) beatPatternBarEl.classList.add('hidden');
  if (beatPatternSlots?.length) {
    beatPatternSlots.forEach(slot => {
      slot.textContent = '·';
      slot.classList.remove('filled', 'active');
      (slot as HTMLElement).dataset.skillId = '';
    });
  }
  if (beatSetupOverlayEl) beatSetupOverlayEl.classList.add('hidden');
  if (beatSetupSlots?.length) {
    beatSetupSlots.forEach(slot => {
      slot.textContent = '·';
      slot.classList.remove('filled');
    });
  }
}

function labelForSkillId(id: string) {
  switch (id) {
    case 'split': return 'Q';
    case 'burst': return 'W';
    case 'evolve': return 'E';
    default: return '?';
  }
}

function setBeatSlot(index: number, skillId: string) {
  if (!beatPatternSlots || index < 0 || index >= beatPatternSlots.length) return;
  const slot = beatPatternSlots[index];
  slot.textContent = labelForSkillId(skillId);
  slot.classList.add('filled');
  (slot as HTMLElement).dataset.skillId = skillId;
  if (beatSetupSlots?.[index]) {
    beatSetupSlots[index].textContent = labelForSkillId(skillId);
    beatSetupSlots[index].classList.add('filled');
  }
}

function highlightActiveBeatSlot(index: number) {
  if (!beatPatternSlots?.length) return;
  beatPatternSlots.forEach((slot, i) => {
    if (i === index) slot.classList.add('active');
    else slot.classList.remove('active');
  });
}

function enterBeatSetup() {
  resetBeatPatternState();
  beatSetupActive = true;
  if (beatPatternBarEl) beatPatternBarEl.classList.remove('hidden');
  if (beatSetupOverlayEl) beatSetupOverlayEl.classList.remove('hidden');
}

function handleBeatSkillInput(skillId: string) {
  if (!beatSetupActive || !skillId || beatPatternIds.length >= BEAT_PATTERN_LENGTH) return;
  beatPatternIds.push(skillId);
  setBeatSlot(beatPatternIds.length - 1, skillId);
  if (beatPatternIds.length >= BEAT_PATTERN_LENGTH) finalizeBeatPattern();
}

function getSkillIdForKey(key: string) {
  const k = String(key || '').toLowerCase();
  if (k === 'q') return 'split';
  if (k === 'w') return 'burst';
  if (k === 'e') return 'evolve';
  return null;
}

function finalizeBeatPattern() {
  beatSetupActive = false;
  if (!beatPatternIds.length) return;
  skillBeatLoopEnabled = true;
  if (beatSetupOverlayEl) beatSetupOverlayEl.classList.add('hidden');
  startSkillBeatLoop();
}

function startBeatUILoop() {
  if (beatUIRafId != null) return;
  const tick = () => {
    if (!skillBeatLoopEnabled || !strudelRepl?.scheduler || !beatPatternIds.length) {
      beatUIRafId = null;
      return;
    }
    const now = strudelRepl.scheduler.now();
    const beatIndex = Math.min(BEAT_PATTERN_LENGTH - 1, Math.floor((now % 1) * BEAT_PATTERN_LENGTH + 1e-9));
    highlightActiveBeatSlot(beatIndex);
    beatUIRafId = requestAnimationFrame(tick);
  };
  beatUIRafId = requestAnimationFrame(tick);
}

function stopBeatUILoop() {
  if (beatUIRafId != null) {
    cancelAnimationFrame(beatUIRafId);
    beatUIRafId = null;
  }
}

function startSkillBeatLoop() {
  if (!beatPatternIds.length) return;
  initStrudelOnce(async () => {
    const patternString = buildBeatPatternString(beatPatternIds);
    if (!patternString) return;
    try {
      const cyclesPerMinute = beatLoopBpm / 4;
      if (cyclesPerMinute > 0 && strudelRepl?.setcpm) strudelRepl.setcpm(cyclesPerMinute);
      gameEngine?.setBeatDurationMs?.(60000 / beatLoopBpm);
      try { hush(); } catch (_e) {}
      // Preload samples so first play is instant (no fetch delay)
      await preloadSkillSamples();
      // Small delay after preload so scheduler is ready before new pattern
      setTimeout(() => {
        try {
          // Track last triggered beat: fire skill only once per beat slot (e.g. [sd sd sd] = 3 events but 1 skill)
          let lastTriggeredCycle = -1;
          let lastTriggeredBeatIndex = -1;
          const pat = sound(patternString).onTrigger(
            (hap: { whole: { begin: number } }) => {
              if (!skillBeatLoopEnabled || !gameEngine?.isPlayMode() || !beatPatternIds.length) return;
              const begin = hap.whole?.begin ?? 0;
              const cycle = Math.floor(begin);
              const beatIndex = Math.min(BEAT_PATTERN_LENGTH - 1, Math.floor((begin % 1) * BEAT_PATTERN_LENGTH + 1e-9));
              if (cycle !== lastTriggeredCycle) {
                lastTriggeredCycle = cycle;
                lastTriggeredBeatIndex = -1;
              }
              if (beatIndex !== lastTriggeredBeatIndex) {
                lastTriggeredBeatIndex = beatIndex;
                const skillId = beatPatternIds[beatIndex];
                if (skillId && typeof gameEngine.triggerSkillById === 'function') {
                  gameEngine.triggerSkillById(skillId);
                }
              }
            },
            false // dominantTrigger: false so audio still plays
          );
          if (pat && typeof pat.play === 'function') {
            currentBeatPattern = pat.play();
            startBeatUILoop();
          } else {
            currentBeatPattern = null;
          }
        } catch (err) {
          console.warn('[Strudel] beat pattern play error', err);
        }
      }, 50);
    } catch (err) {
      console.warn('[Strudel] beat pattern play error', err);
    }
  });
}

function stopSkillBeatLoop() {
  stopBeatUILoop();
  highlightActiveBeatSlot(-1);
  try { hush(); } catch (_e) {}
  currentBeatPattern = null;
}

// Collection system
let collection: any[] = [];
let latestWinData: any = null;
let lastAddedCollectionId: string | null = null;

function addToCollection(levelName: string, ssim: number, time: number, imageDataURL: string, motifId: string | null = null) {
  const item = {
    id: `recon-${Date.now()}`,
    levelName,
    ssim,
    time,
    imageDataURL,
    timestamp: Date.now(),
    motifId
  };
  collection.push(item);
  updateCollectionCounter();
  saveCollection();
  return item;
}

function updateCollectionCounter() {
  const hudCount = $('#collectionCount');
  if (hudCount) hudCount.textContent = String(collection.length);
  const startCount = $('#startCollectionCount');
  if (startCount) startCount.textContent = String(collection.length);
}

function saveCollection() {
  if ((window as any).LenningsStorage) {
    (window as any).LenningsStorage.saveCollection(collection).catch((e: any) => console.warn('Could not save collection:', e));
  }
}

function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function showGallery(highlightLatest = false) {
  const grid = $('#galleryGrid');
  const empty = $('#galleryEmpty');
  if (!grid || !empty) return;
  grid.innerHTML = '';
  if (collection.length === 0) {
    empty.style.display = 'block';
    grid.style.display = 'none';
  } else {
    empty.style.display = 'none';
    grid.style.display = 'grid';
    const sorted = [...collection].reverse();
    sorted.forEach((item, index) => {
      const div = document.createElement('div');
      div.className = 'gallery-item' + (highlightLatest && index === 0 ? ' new' : '');
      div.innerHTML = `
        <img src="${item.imageDataURL}" alt="${item.levelName}">
        <div class="gallery-item-info">
          <div class="gallery-item-name">${item.levelName}</div>
          <div class="gallery-item-ssim">SSIM: ${item.ssim.toFixed(3)}</div>
          <div class="gallery-item-time">${formatTime(item.time)}</div>
        </div>
      `;
      grid.appendChild(div);
    });
  }
  if (galleryOverlayEl) galleryOverlayEl.classList.add('visible');
  if (similarityGraphOverlayEl) similarityGraphOverlayEl.classList.remove('visible');
}

function hideGallery() {
  if (galleryOverlayEl) galleryOverlayEl.classList.remove('visible');
}

const LANGUAGE_STORAGE_KEY = 'gbg-language-preference';

function getCurrentLanguage() {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'en' || stored === 'pt_br') return stored;
  } catch (_e) {}
  return 'en';
}

function setCurrentLanguage(lang: string) {
  const normalized = lang === 'pt_br' ? 'pt_br' : 'en';
  try { localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized); } catch (_e) {}
  document.dispatchEvent(new CustomEvent('gbg-language-changed', { detail: { language: normalized } }));
}

function updateCurrentLevelNameForLanguage() {
  if (!gameEngine?.currentLevel) return;
  const lang = getCurrentLanguage();
  const level = gameEngine.currentLevel;
  let name = level.name || level.id || '';
  if (level.id && typeof gameEngine.getLocalizedMotifName === 'function') {
    const localized = gameEngine.getLocalizedMotifName(level.id, lang);
    if (localized) name = localized;
  }
  const el = $('#levelName');
  if (el) el.textContent = name;
}

// Snapshot UI refs (defined after DOM refs used above)
const skillsBarEl = $('#skillsBar');
const snapshotOverlayEl = $('#snapshotOverlay');
let wasPausedBeforeSnapshot = false;
const snapshotCanvasEl = $('#snapshotCanvas') as HTMLCanvasElement | null;
const snapshotCtx = snapshotCanvasEl?.getContext('2d') ?? null;

async function initGame() {
  const response = await fetch('parameters.json');
  const config = await response.json();
  const paramMap: Record<string, any> = {};
  for (const [category, catData] of Object.entries(config) as [string, any][]) {
    if (category === 'description' || category === 'version') continue;
    if (catData.params) {
      for (const [paramName, paramData] of Object.entries(catData.params)) {
        paramMap[paramName] = paramData;
      }
    }
  }

  params = {
    stepN: getParamValue(paramMap, 'stepN', 1),
    targetFPS: getParamValue(paramMap, 'targetFPS', 60),
    renderMode: 1,
    showCellGraph: false,
    showTrailsOverlay: true,
    spawnCount: getParamValue(paramMap, 'spawnCount', 3),
    spawnCenter: getParamValue(paramMap, 'spawnCenter', [0.0, 0.0]),
    viewCenter: [0.0, 0.0],
    viewExtent: getParamValue(paramMap, 'viewExtent', 50.0),
    mousePos: [-10000.0, 0.0],
    mouseDown: false,
    touchRadius: getParamValue(paramMap, 'touchRadius', 0.05),
    paused: false,
    shiftKey: false,
    pointAddI: 0,
    enableLifeCycle: getParamValue(paramMap, 'enableLifeCycle', true),
    enableDeaths: getParamValue(paramMap, 'enableDeaths', true),
    enableReproduction: false,
    consumeEnabled: getParamValue(paramMap, 'consumeEnabled', true),
    useCpuRepro: getParamValue(paramMap, 'useCpuRepro', true),
    maxChildrenPerParent: getParamValue(paramMap, 'maxChildrenPerParent', 2),
    reproInterval: getParamValue(paramMap, 'reproInterval', 85),
  };

  lenia = new ParticleLenia(gl, null, paramMap);
  gameEngine = new LenningsGameEngine({ levelPackPath: 'levels/GlassBeadGame' });
  await gameEngine.initialize();
  gameEngine.attachSimulation(lenia, params);

  setupGameEvents();

  $('#startGameBtn')?.addEventListener('click', () => {
    const playId = new URLSearchParams(window.location.search).get('play');
    if (playId && gameEngine) {
      const idx = gameEngine.getLevels().findIndex((l: any) => l.id === playId);
      if (idx >= 0) startLevel(idx);
      else startRandomGame();
    } else {
      startRandomGame();
    }
  });

  const helpOverlayEl = $('#helpOverlay');
  $('#helpBtn')?.addEventListener('click', () => helpOverlayEl?.classList.add('visible'));
  $('#helpCloseBtn')?.addEventListener('click', () => helpOverlayEl?.classList.remove('visible'));
  helpOverlayEl?.addEventListener('click', (e) => { if (e.target === helpOverlayEl) helpOverlayEl.classList.remove('visible'); });

  $('#viewCollectionStartBtn')?.addEventListener('click', () => showGallery(false));

  if ((window as any).LenningsStorage) {
    (window as any).LenningsStorage.loadCollection().then((c: any[]) => {
      collection = c;
      updateCollectionCounter();
    });
  }

  const langEnBtn = $('#langEnBtn');
  const langPtBrBtn = $('#langPtBrBtn');
  function updateLanguageFlagButtons(current: string) {
    if (langEnBtn) langEnBtn.classList.toggle('active', current === 'en');
    if (langPtBrBtn) langPtBrBtn.classList.toggle('active', current === 'pt_br');
  }
  updateLanguageFlagButtons(getCurrentLanguage());
  langEnBtn?.addEventListener('click', () => {
    setCurrentLanguage('en');
    updateLanguageFlagButtons('en');
    updateCurrentLevelNameForLanguage();
  });
  langPtBrBtn?.addEventListener('click', () => {
    setCurrentLanguage('pt_br');
    updateLanguageFlagButtons('pt_br');
    updateCurrentLevelNameForLanguage();
  });

  const playId = new URLSearchParams(window.location.search).get('play');
  if (playId && gameEngine) {
    const idx = gameEngine.getLevels().findIndex((l: any) => l.id === playId);
    if (idx >= 0) setTimeout(() => startLevel(idx), 0);
  }

  requestAnimationFrame(animate);
}

function startRandomGame() {
  levelSelectEl?.classList.add('hidden');
  gameHUDEl?.classList.remove('hidden');
  skillsBarEl?.classList.remove('hidden');
  hideSnapshotOverlay();
  resetSnapshotUI();
  gameEngine.startRandomLevel();
}

function setupGameEvents() {
  gameEngine.on('stateChange', ({ state }: { state: string }) => {
    updateUIForState(state);
    if (state === 'playing') {
      if (!beatSetupActive && beatPatternIds.length === BEAT_PATTERN_LENGTH) {
        startSkillBeatLoop();
      }
    } else {
      stopSkillBeatLoop();
    }
  });

  gameEngine.on('progress', ({ ssim, smoothedSSIM, threshold, progress, cellCount, elapsedTime }: any) => {
    updateProgress(ssim, smoothedSSIM, threshold, progress, cellCount, elapsedTime);
  });

  gameEngine.on('levelWon', ({ ssim, elapsedTime, cellCount, levelIndex }: any) => {
    latestWinData = { ssim, elapsedTime, cellCount, levelIndex, imageDataURL: null };
  });

  gameEngine.on('levelStart', ({ level }: any) => {
    updateCurrentLevelNameForLanguage();
    pauseOverlayEl?.classList.remove('visible');
    winOverlayEl?.classList.remove('visible');
    resetSnapshotUI();
    hideSnapshotOverlay();
    resetCameraToSpawn();
    enterBeatSetup();
  });

  document.addEventListener('gbg-language-changed', () => updateCurrentLevelNameForLanguage());

  ['q', 'w', 'e', 'd', 'r'].forEach(key => {
    const btn = $(`#skill${key.toUpperCase()}`);
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (!gameEngine.isPlayMode() || gameEngine.gameState === 'won') return;
      if (key === 'q' || key === 'w' || key === 'e') {
        const skillId = key === 'q' ? 'split' : key === 'w' ? 'burst' : 'evolve';
        if (beatSetupActive) handleBeatSkillInput(skillId);
        return;
      } else if (key === 'r') {
        if (gameEngine.triggerSkill('r')) resetCameraToSpawn();
      } else if (key === 'd') {
        if (gameEngine.canTakeDigest()) gameEngine.triggerSkill('d');
      }
    });
  });

  gameEngine.on('levelReset', () => {
    hideSnapshotOverlay();
    pauseOverlayEl?.classList.remove('visible');
    winOverlayEl?.classList.remove('visible');
    enterBeatSetup();
  });

  gameEngine.on('digestStart', ({ pixelCount }: any) => showSnapshotLoading(pixelCount));
  gameEngine.on('digestAnimate', ({ digest, eatenPixels, reconstruction }: any) => {
    setTimeout(() => playSnapshotAnimation(digest, eatenPixels, reconstruction), 300);
  });
  gameEngine.on('digestComplete', ({ digest, chargesRemaining, meetsThreshold }: any) => {
    addSnapshotToInventory(digest, meetsThreshold);
    updateChargeDisplay(chargesRemaining);
  });
  gameEngine.on('digestFailed', () => hideSnapshotOverlay());
  gameEngine.on('digestCancelled', () => hideSnapshotOverlay());
  gameEngine.on('skillUsed', ({ key }: any) => { if (key === 'w') $('#skillW')?.classList.add('active-burst'); });
  gameEngine.on('skillEnd', ({ key }: any) => { if (key === 'w') $('#skillW')?.classList.remove('active-burst'); });

  $('#nextMotifBtn')?.addEventListener('click', () => {
    hideSnapshotOverlay();
    resetSnapshotUI();
    gameEngine.nextLevel();
  });

  $('#continueBtn')?.addEventListener('click', () => hideSnapshotOverlay());

  $('#nextLevelBtn')?.addEventListener('click', () => {
    winOverlayEl?.classList.remove('visible');
    resetSnapshotUI();
    gameEngine.nextLevel();
  });

  $('#viewCollectionBtn')?.addEventListener('click', () => {
    winOverlayEl?.classList.remove('visible');
    showGallery(true);
  });

  $('#menuBtn')?.addEventListener('click', () => showLevelSelect());

  $('#galleryContinueBtn')?.addEventListener('click', () => {
    hideGallery();
    resetSnapshotUI();
    gameEngine.nextLevel();
  });

  $('#galleryBackBtn')?.addEventListener('click', () => {
    hideGallery();
    if (latestWinData) winOverlayEl?.classList.add('visible');
    else if (gameEngine.gameState === 'paused') pauseOverlayEl?.classList.add('visible');
  });

  const similarityGraphBackBtn = $('#similarityGraphBackBtn');
  if (similarityGraphBackBtn) {
    similarityGraphBackBtn.addEventListener('click', () => {
      similarityGraphOverlayEl?.classList.remove('visible');
      galleryOverlayEl?.classList.add('visible');
    });
  }

  $('#galleryGraphBtn')?.addEventListener('click', () => { window.location.href = 'graph.html'; });

  const similarityThresholdSlider = $('#similarityThresholdSlider');
  if (similarityThresholdSlider) {
    similarityThresholdSlider.addEventListener('input', () => {
      if (similarityGraphOverlayEl?.classList.contains('visible')) showSimilarityGraph();
    });
  }

  const collectionBtn = $('#collectionBtn');
  if (collectionBtn) {
    collectionBtn.addEventListener('click', () => {
      if (gameEngine.gameState === 'playing') {
        gameEngine.pause();
        pauseOverlayEl?.classList.add('visible');
      }
      showGallery(false);
    });
  }

  window.addEventListener('keydown', handleKeyDown);
  setupCanvasControls();
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === ' ') {
    e.preventDefault();
    if (gameEngine?.gameState === 'playing' || gameEngine?.gameState === 'paused') {
      gameEngine.togglePause();
      pauseOverlayEl?.classList.toggle('visible', gameEngine.gameState === 'paused');
    }
  }

  if (beatSetupActive) {
    const skillId = getSkillIdForKey(e.key);
    if (skillId) {
      e.preventDefault();
      handleBeatSkillInput(skillId);
      return;
    }
  }

  if (e.key === 'r' || e.key === 'R') {
    if (gameEngine?.isPlayMode() && gameEngine.gameState !== 'won') {
      hideSnapshotOverlay();
      if (gameEngine.triggerSkill('r')) resetCameraToSpawn();
    }
  }

  if (e.key === 'd' || e.key === 'D') {
    if (gameEngine?.canTakeDigest()) gameEngine.triggerSkill('d');
  }

  if (e.key === 'Escape') {
    if (galleryOverlayEl?.classList.contains('visible')) hideGallery();
    else if (gameEngine?.gameState === 'won') {
      winOverlayEl?.classList.remove('visible');
      showLevelSelect();
    } else {
      showLevelSelect();
    }
  }
}

function getMotifIdForCollectionItem(item: any) {
  if (item.motifId) return item.motifId;
  if (!gameEngine) return null;
  const name = (item.levelName || '').trim();
  if (!name) return null;
  const levels = gameEngine.getLevels();
  const match = levels.find((l: any) => (l.name || '').trim() === name);
  return match ? match.id : null;
}

function showSimilarityGraph() {
  if (!similarityGraphOverlayEl) return;
  const items = collection?.length ? [...collection].reverse() : [];
  const svg = document.getElementById('similarityGraphSvg');
  if (!svg) return;

  while (svg.firstChild) svg.removeChild(svg.firstChild);

  if (!gameEngine || items.length === 0) {
    similarityGraphOverlayEl.classList.add('visible');
    return;
  }

  const width = svg.clientWidth || (svg.parentElement?.clientWidth ?? 800);
  const height = svg.clientHeight || (svg.parentElement?.clientHeight ?? 600);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const nodes = items.map((item, index) => {
    const motifId = getMotifIdForCollectionItem(item);
    const angle = (index / Math.max(1, items.length)) * Math.PI * 2;
    return {
      id: item.id,
      motifId,
      label: item.levelName,
      imageDataURL: item.imageDataURL,
      x: width / 2 + Math.cos(angle) * width * 0.25,
      y: height / 2 + Math.sin(angle) * height * 0.25,
      group: null as SVGGElement | null
    };
  });

  const links: { source: string; target: string; similarity: number; element: SVGLineElement }[] = [];
  const slider = document.getElementById('similarityThresholdSlider');
  let threshold = 0.7;
  if (slider) {
    const parsed = parseFloat((slider as HTMLInputElement).value);
    if (!Number.isNaN(parsed)) threshold = parsed;
  }
  const thresholdLabelEl = document.getElementById('similarityThresholdValue');
  if (thresholdLabelEl) thresholdLabelEl.textContent = threshold.toFixed(2);

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      if (!a.motifId || !b.motifId) continue;
      const sim = gameEngine.getCosineSimilarityBetweenIds(a.motifId, b.motifId);
      if (sim == null) continue;
      if (sim >= threshold) links.push({ source: a.id, target: b.id, similarity: sim, element: document.createElementNS('http://www.w3.org/2000/svg', 'line') });
    }
  }

  const d3 = (window as any).d3;
  let simulation: any = null;
  if (d3?.forceSimulation) {
    simulation = d3.forceSimulation(nodes)
      .force('charge', d3.forceManyBody().strength(-120))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance((l: any) => 200 - 80 * Math.min(1, l.similarity)))
      .force('collision', d3.forceCollide().radius(48))
      .on('tick', ticked);
  }

  const linkGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(linkGroup);
  svg.appendChild(nodeGroup);

  links.forEach(link => {
    link.element.classList.add('similarity-link');
    linkGroup.appendChild(link.element);
  });

  const nodeRadius = 36;
  nodes.forEach(node => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    nodeGroup.appendChild(group);
    node.group = group;

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', String(nodeRadius));
    circle.classList.add('similarity-node-circle');
    group.appendChild(circle);

    if (node.imageDataURL) {
      const clipId = `clip-${node.id}`;
      let defs = svg.querySelector('defs');
      if (!defs) {
        defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        svg.insertBefore(defs, svg.firstChild);
      }
      const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
      clipPath.setAttribute('id', clipId);
      const clipCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      clipCircle.setAttribute('r', String(nodeRadius));
      clipCircle.setAttribute('cx', '0');
      clipCircle.setAttribute('cy', '0');
      clipPath.appendChild(clipCircle);
      defs.appendChild(clipPath);

      const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', node.imageDataURL);
      image.setAttribute('x', String(-nodeRadius));
      image.setAttribute('y', String(-nodeRadius));
      image.setAttribute('width', String(nodeRadius * 2));
      image.setAttribute('height', String(nodeRadius * 2));
      image.setAttribute('clip-path', `url(#${clipId})`);
      group.appendChild(image);
    }

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dy', String(nodeRadius + 14));
    label.setAttribute('fill', '#ddd');
    label.setAttribute('font-size', '10');
    label.textContent = node.label;
    group.appendChild(label);
  });

  function ticked() {
    nodes.forEach(n => {
      if (n.group) n.group.setAttribute('transform', `translate(${n.x}, ${n.y})`);
    });
    links.forEach(l => {
      const source = nodes.find(n => n.id === l.source);
      const target = nodes.find(n => n.id === l.target);
      if (!source || !target) return;
      l.element.setAttribute('x1', String(source.x));
      l.element.setAttribute('y1', String(source.y));
      l.element.setAttribute('x2', String(target.x));
      l.element.setAttribute('y2', String(target.y));
    });
  }

  if (!simulation) ticked();
  similarityGraphOverlayEl.classList.add('visible');
  galleryOverlayEl?.classList.remove('visible');
}

let cameraState = {
  targetCenterX: 0, targetCenterY: 0, targetExtent: 50,
  currentCenterX: 0, currentCenterY: 0, currentExtent: 50,
  smoothing: 0.08, padding: 2.5, minExtent: 20, maxExtent: 200,
  lastBoundsCheck: 0, boundsCheckInterval: 5
};

let cameraFrameCount = 0;

function updateAutoCamera() {
  if (!lenia) return;
  cameraFrameCount++;
  if (cameraFrameCount % cameraState.boundsCheckInterval === 0) {
    const bounds = lenia.getParticleBounds();
    if (bounds?.count > 0) {
      const size = Math.max(bounds.width, bounds.height, 10);
      cameraState.targetExtent = Math.min(cameraState.maxExtent, Math.max(cameraState.minExtent, size * cameraState.padding));
      cameraState.targetCenterX = bounds.centerX;
      cameraState.targetCenterY = bounds.centerY;
    }
  }
  const s = cameraState.smoothing;
  cameraState.currentCenterX += (cameraState.targetCenterX - cameraState.currentCenterX) * s;
  cameraState.currentCenterY += (cameraState.targetCenterY - cameraState.currentCenterY) * s;
  cameraState.currentExtent += (cameraState.targetExtent - cameraState.currentExtent) * s;
  params.viewCenter = [cameraState.currentCenterX, cameraState.currentCenterY];
  params.viewExtent = cameraState.currentExtent;
}

function resetCameraToSpawn() {
  const spawnCenter = params.spawnCenter || [0, 0];
  cameraState.currentCenterX = spawnCenter[0];
  cameraState.currentCenterY = spawnCenter[1];
  cameraState.targetCenterX = spawnCenter[0];
  cameraState.targetCenterY = spawnCenter[1];
  cameraState.currentExtent = 50;
  cameraState.targetExtent = 50;
  params.viewCenter = [spawnCenter[0], spawnCenter[1]];
  params.viewExtent = 50;
}

function setupCanvasControls() {
  canvas.addEventListener('wheel', e => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
}

function startLevel(index: number) {
  levelSelectEl?.classList.add('hidden');
  gameHUDEl?.classList.remove('hidden');
  winOverlayEl?.classList.remove('visible');
  skillsBarEl?.classList.remove('hidden');
  hideSnapshotOverlay();
  resetSnapshotUI();
  gameEngine.startLevel(index);
}

function showLevelSelect() {
  gameEngine.gameState = 'idle';
  params.paused = true;
  levelSelectEl?.classList.remove('hidden');
  gameHUDEl?.classList.add('hidden');
  winOverlayEl?.classList.remove('visible');
  pauseOverlayEl?.classList.remove('visible');
  skillsBarEl?.classList.add('hidden');
  resetBeatPatternState();
  hideSnapshotOverlay();
  hideGallery();
  latestWinData = null;
}

function updateUIForState(state: string) {
  pauseOverlayEl?.classList.toggle('visible', state === 'paused');
}

function updateProgress(ssim: number, smoothedSSIM: number, threshold: number, progress: number, cellCount: number, elapsedTime: number) {
  $('#cellCount')!.textContent = String(cellCount);
  const seconds = Math.floor(elapsedTime / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  $('#timeDisplay')!.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

function showWinScreen(ssim: number, elapsedTime: number, cellCount: number, levelIndex: number) {
  const seconds = Math.floor(elapsedTime / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  $('#winSSIM')!.textContent = ssim.toFixed(3);
  $('#winTime')!.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  $('#winCells')!.textContent = String(cellCount);
  const bestSnapshot = gameEngine.getBestSnapshot();
  const imageDataURL = bestSnapshot?.imageDataURL || lenia.getReconstructionDataURL();
  const previewImg = $('#winPreviewImg') as HTMLImageElement | null;
  if (imageDataURL && previewImg) {
    previewImg.src = imageDataURL;
    previewImg.style.display = 'block';
  } else if (previewImg) {
    previewImg.style.display = 'none';
  }
  const levelName = gameEngine.currentLevel?.name || 'Unknown';
  const motifId = gameEngine.currentLevel?.id || gameEngine.currentResource?.id || null;
  if (imageDataURL) addToCollection(levelName, ssim, elapsedTime, imageDataURL, motifId);
  latestWinData = { ssim, elapsedTime, cellCount, levelIndex, imageDataURL };
  $('#nextLevelBtn')!.style.display = 'block';
  winOverlayEl?.classList.add('visible');
}

// Load D3
(function loadD3Force() {
  if ((window as any).d3?.forceSimulation) return;
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js';
  script.async = true;
  document.head.appendChild(script);
})();

function initSkillCharges() {
  const digestCharges = $('#charges-d');
  if (digestCharges && digestCharges.children.length === 0) {
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.className = 'charge-dot available';
      digestCharges.appendChild(dot);
    }
  }
}

function resetSnapshotUI() {
  cancelSnapshotAnimation();
  initSkillCharges();
  const container = $('#charges-d');
  if (container) {
    Array.from(container.querySelectorAll('.charge-dot')).forEach(dot => dot.classList.add('available'));
  }
  const slotsContainer = $('#snapshotSlots');
  if (slotsContainer) slotsContainer.innerHTML = '';
}

function tickSkillCooldowns() {
  if (!gameEngine?.skills) return;
  for (const [key] of gameEngine.skills) {
    const remaining = gameEngine.getSkillCooldownRemaining(key);
    const btn = $(`#skill${key.toUpperCase()}`);
    const cooldownEl = $(`#cooldown${key.toUpperCase()}`);
    if (!btn || !cooldownEl) continue;
    if (remaining > 0) {
      btn.classList.add('on-cooldown');
      const skill = gameEngine.skills.get(key);
      cooldownEl.style.height = skill ? (remaining / skill.cooldownMs) * 100 + '%' : '0%';
    } else {
      btn.classList.remove('on-cooldown');
      cooldownEl.style.height = '0%';
    }
  }
  const wActive = (gameEngine.getBurstStackCount?.() ?? 0) > 0;
  $('#skillW')?.classList.toggle('active-burst', wActive);
}

function updateChargeDisplay(chargesRemaining: number) {
  const container = $('#charges-d');
  if (!container) return;
  const dots = Array.from(container.querySelectorAll('.charge-dot'));
  dots.forEach((dot, i) => {
    if (i < chargesRemaining) dot.classList.add('available');
    else dot.classList.remove('available');
  });
}

function addSnapshotToInventory(snapshot: any, meetsThreshold: boolean) {
  const slotsContainer = $('#snapshotSlots');
  if (!slotsContainer || !snapshot.imageDataURL) return;
  const slot = document.createElement('div');
  slot.className = `snapshot-slot filled ${meetsThreshold ? 'winner' : ''}`;
  const ssimClass = snapshot.ssim >= 0.7 ? 'high' : snapshot.ssim >= 0.4 ? 'medium' : 'low';
  slot.innerHTML = `
    <img class="snapshot-image" src="${snapshot.imageDataURL}" alt="Snapshot">
    <div class="snapshot-info">
      <div class="snapshot-ssim ${ssimClass}">${snapshot.ssim.toFixed(3)}</div>
    </div>
  `;
  slotsContainer.prepend(slot);
}

function showSnapshotOverlay() {
  if (gameEngine) {
    wasPausedBeforeSnapshot = gameEngine.gameState === 'paused';
    if (gameEngine.gameState === 'playing') gameEngine.pause();
  }
  snapshotOverlayEl?.classList.add('visible');
  $('#snapshotResult')?.classList.remove('visible');
}

function showSnapshotLoading(pixelCount: number) {
  showSnapshotOverlay();
  $('#snapshotTitle')!.textContent = 'Digesting...';
  $('#loadingContainer')?.classList.remove('hidden');
  $('#canvasContainer')?.classList.add('hidden');
  $('#snapshotResult')?.classList.remove('visible');
  $('#loadingPixels')!.textContent = `${pixelCount.toLocaleString()} pixels`;
}

function hideSnapshotOverlay() {
  cancelSnapshotAnimation();
  snapshotOverlayEl?.classList.remove('visible');
  $('#loadingContainer')?.classList.remove('hidden');
  $('#canvasContainer')?.classList.add('hidden');
  $('#nextMotifBtn')?.classList.add('hidden');
  if (gameEngine?.gameState === 'paused' && !wasPausedBeforeSnapshot) gameEngine.resume();
}

function showSnapshotResult(ssim: number, meetsThreshold: boolean, chargesLeft: number) {
  const resultEl = $('#snapshotResult');
  const ssimEl = $('#snapshotSSIM');
  const messageEl = $('#resultMessage');
  const nextMotifBtn = $('#nextMotifBtn');
  const continueBtn = $('#continueBtn');
  const target = ssim;
  const duration = 800;
  const startTime = performance.now();
  function animateSSIM(now: number) {
    const t = Math.min(1, (now - startTime) / duration);
    ssimEl!.textContent = (target * t).toFixed(3);
    if (t < 1) requestAnimationFrame(animateSSIM);
  }
  requestAnimationFrame(animateSSIM);
  $('#viewInGraphBtn')?.classList.add('hidden');
  continueBtn?.classList.add('hidden');
  nextMotifBtn?.classList.add('hidden');
  if (meetsThreshold) {
    ssimEl!.style.color = '#4af2a1';
    messageEl!.className = 'result-message success';
    messageEl!.textContent = 'Target reached! Level complete!';
    nextMotifBtn?.classList.remove('hidden');
    const viewInGraphBtn = $('#viewInGraphBtn');
    if (viewInGraphBtn && lastAddedCollectionId) {
      viewInGraphBtn.setAttribute('href', 'graph.html?focus=' + encodeURIComponent(lastAddedCollectionId));
      viewInGraphBtn.classList.remove('hidden');
    }
  } else {
    ssimEl!.style.color = ssim >= 0.4 ? '#ffd93d' : '#ff6b6b';
    if (chargesLeft > 0) {
      messageEl!.className = 'result-message continue';
      messageEl!.textContent = `Keep going! ${chargesLeft} digest${chargesLeft > 1 ? 's' : ''} remaining`;
      continueBtn?.classList.remove('hidden');
    } else {
      messageEl!.className = 'result-message motif-failed';
      messageEl!.textContent = 'Motif failed.';
      nextMotifBtn?.classList.remove('hidden');
    }
  }
  resultEl?.classList.add('visible');
}

let animationFrameId: number | null = null;
let currentSnapshot: any = null;

function cancelSnapshotAnimation() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  currentSnapshot = null;
}

async function playSnapshotAnimation(snapshot: any, eatenPixels: any, reconstruction: any) {
  cancelSnapshotAnimation();
  currentSnapshot = snapshot;
  $('#snapshotTitle')!.textContent = 'Reconstructing...';
  $('#loadingContainer')?.classList.add('hidden');
  $('#canvasContainer')?.classList.remove('hidden');

  const ctx = snapshotCtx;
  const displayWidth = snapshotCanvasEl!.width;
  const displayHeight = snapshotCanvasEl!.height;
  const reconWidth = reconstruction.width || 256;
  const reconHeight = reconstruction.height || 256;
  const totalPixels = reconWidth * reconHeight;

  if (!snapshot.imageDataURL) {
    finishSnapshotAnimation(snapshot, reconstruction);
    return;
  }

  const img = new Image();
  img.onerror = () => finishSnapshotAnimation(snapshot, reconstruction);
  img.onload = () => {
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = reconWidth;
    srcCanvas.height = reconHeight;
    const srcCtx = srcCanvas.getContext('2d')!;
    srcCtx.drawImage(img, 0, 0, reconWidth, reconHeight);
    const sourceData = srcCtx.getImageData(0, 0, reconWidth, reconHeight);
    const src = sourceData.data;
    const buffer = new Uint8ClampedArray(reconWidth * reconHeight * 4);
    for (let i = 0; i < buffer.length; i += 4) {
      buffer[i] = Math.floor(Math.random() * 256);
      buffer[i + 1] = Math.floor(Math.random() * 256);
      buffer[i + 2] = Math.floor(Math.random() * 256);
      buffer[i + 3] = 255;
    }
    const bufferImageData = new ImageData(buffer, reconWidth, reconHeight);
    const offscreen = document.createElement('canvas');
    offscreen.width = reconWidth;
    offscreen.height = reconHeight;
    const offCtx = offscreen.getContext('2d')!;
    const animDuration = 1500;
    const startTime = performance.now();
    let lastFilled = 0;

    function animateFrame(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(1, elapsed / animDuration);
      const nextIndex = Math.min(totalPixels, Math.floor(progress * (totalPixels + 1)));
      for (let i = lastFilled; i < nextIndex; i++) {
        const idx = i * 4;
        buffer[idx] = src[idx];
        buffer[idx + 1] = src[idx + 1];
        buffer[idx + 2] = src[idx + 2];
        buffer[idx + 3] = 255;
      }
      lastFilled = nextIndex;
      offCtx.putImageData(bufferImageData, 0, 0);
      ctx!.fillStyle = '#000';
      ctx!.fillRect(0, 0, displayWidth, displayHeight);
      const scale = Math.min(displayWidth / reconWidth, displayHeight / reconHeight) * 0.9;
      const dx = (displayWidth - reconWidth * scale) / 2;
      const dy = (displayHeight - reconHeight * scale) / 2;
      ctx!.drawImage(offscreen, 0, 0, reconWidth, reconHeight, dx, dy, reconWidth * scale, reconHeight * scale);
      if (progress < 1) animationFrameId = requestAnimationFrame(animateFrame);
      else finishSnapshotAnimation(snapshot, reconstruction);
    }
    animationFrameId = requestAnimationFrame(animateFrame);
  };
  img.src = snapshot.imageDataURL;
}

function finishSnapshotAnimation(snapshot: any, reconstruction: any) {
  const completeWithResult = () => {
    gameEngine.completeDigest(snapshot);
    const meetsThreshold = snapshot.ssim >= gameEngine.winCondition.threshold;
    const chargesLeft = gameEngine.getRemainingCharges();
    if (meetsThreshold && snapshot.imageDataURL) {
      const levelName = gameEngine.currentLevel?.name || 'Unknown';
      const motifId = gameEngine.currentLevel?.id || gameEngine.currentResource?.id || null;
      const elapsedTime = gameEngine.startTime != null ? Date.now() - gameEngine.startTime : 0;
      const idx = collection.findIndex((i: any) => i.motifId === motifId && i.suggested);
      if (idx >= 0) {
        const existing = collection[idx];
        existing.levelName = levelName;
        existing.ssim = snapshot.ssim;
        existing.time = elapsedTime;
        existing.imageDataURL = snapshot.imageDataURL;
        delete existing.suggested;
        lastAddedCollectionId = existing.id;
        updateCollectionCounter();
        saveCollection();
      } else {
        const item = addToCollection(levelName, snapshot.ssim, elapsedTime, snapshot.imageDataURL, motifId);
        lastAddedCollectionId = item?.id ?? null;
      }
    } else {
      lastAddedCollectionId = null;
    }
    showSnapshotResult(snapshot.ssim, meetsThreshold, chargesLeft);
  };

  if (snapshot.imageDataURL) {
    const img = new Image();
    img.onload = () => {
      const canvas = snapshotCanvasEl!;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height) * 0.9;
      const x = (canvas.width - img.width * scale) / 2;
      const y = (canvas.height - img.height * scale) / 2;
      ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
      completeWithResult();
    };
    img.onerror = () => completeWithResult();
    img.src = snapshot.imageDataURL;
  } else {
    completeWithResult();
  }
}

let eatenRingsFrameCount = 0;
const EATEN_RINGS_THROTTLE = 15;

function updateEatenRings() {
  const canvasEl = $('#eatenRingsCanvas') as HTMLCanvasElement | null;
  if (!canvasEl || !lenia?.getEatenPixels) return;
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return;
  const width = canvasEl.width;
  const height = canvasEl.height;
  const d = Math.min(width, height);
  const cx = width / 2;
  const cy = height / 2;
  const margin = 6;
  const maxRadius = d / 2 - margin;
  const excludeKeys = gameEngine?.digestedPixelKeys ?? null;
  const eaten = lenia.getEatenPixels(true, excludeKeys);
  const totalImagePixels = lenia.originalResourceData ? lenia.originalResourceData.length / 4 : (lenia.resourceTexSize || 512) ** 2;

  ctx.clearRect(0, 0, width, height);
  if (!eaten?.length) return;

  const n = eaten.length;
  $('#eatenPixelsCount')!.textContent = n.toLocaleString();
  const coverage = Math.min(1, n / totalImagePixels);
  const eased = Math.pow(coverage, 0.4);
  const filledRadius = Math.max(0, eased * maxRadius);
  const maxRings = 36;
  let ringCount = Math.max(1, Math.min(maxRings, Math.floor(eased * maxRings) || 1));
  const perRing = Math.max(1, Math.floor(n / ringCount));

  for (let ring = 0; ring < ringCount; ring++) {
    const startIdx = ring * perRing;
    const endIdx = ring === ringCount - 1 ? n : Math.min(n, (ring + 1) * perRing);
    if (startIdx >= endIdx) continue;
    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    for (let i = startIdx; i < endIdx; i++) {
      const p = eaten[i];
      sumR += p.r != null ? p.r : 0;
      sumG += p.g != null ? p.g : 0;
      sumB += p.b != null ? p.b : 0;
      count++;
    }
    if (count === 0) continue;
    const avgR = Math.round((sumR / count) * 255);
    const avgG = Math.round((sumG / count) * 255);
    const avgB = Math.round((sumB / count) * 255);
    const innerT = ring / ringCount;
    const outerT = (ring + 1) / ringCount;
    const innerRadius = innerT * filledRadius;
    const outerRadius = outerT * filledRadius;
    ctx.fillStyle = `rgb(${avgR},${avgG},${avgB})`;
    ctx.beginPath();
    ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
    ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();
  }
}

let lastFrameTime = 0;

function animate(currentTime: number) {
  requestAnimationFrame(animate);
  const targetInterval = 1000 / params.targetFPS;
  if (currentTime - lastFrameTime < targetInterval) return;
  lastFrameTime = currentTime;

  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  if (canvas.width < 768) {
    canvas.width = canvas.clientWidth * window.devicePixelRatio;
    canvas.height = canvas.clientHeight * window.devicePixelRatio;
  }

  // Gamepad
  if (gameEngine?.isPlayMode() && (gameEngine.gameState === 'playing' || gameEngine.gameState === 'paused')) {
    const pads = navigator.getGamepads?.() ?? [];
    let gp: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]?.connected) { gp = pads[i]; break; }
    }
    if (gp?.connected) {
      const pressed = (i: number) => {
        const b = gp!.buttons[i];
        return b && (b.pressed || (typeof b.value === 'number' && b.value > 0.5));
      };
      const idx = [0, 2, 3, 4, 5, 6, 7, 12, 13, 14, 15];
      for (const i of idx) {
        const now = pressed(i);
        if (now && !prevGamepadButtons[i]) {
          const isBurst = (i === 5 || i === 4);
          const isSplit = (i === 7 || i === 6);
          const isEvolve = (i === 0 || i === 15 || i === 13);
          const isDigest = (i === 2 || i === 14);
          const isRespawn = (i === 3 || i === 12);
          if (beatSetupActive) {
            if (isBurst) handleBeatSkillInput('burst');
            else if (isSplit) handleBeatSkillInput('split');
            else if (isEvolve) handleBeatSkillInput('evolve');
          } else {
            if (isDigest && gameEngine.canTakeDigest()) gameEngine.triggerSkill('d');
            else if (isRespawn && gameEngine.gameState !== 'won') {
              hideSnapshotOverlay();
              if (gameEngine.triggerSkill('r')) resetCameraToSpawn();
            }
          }
        }
        prevGamepadButtons[i] = now;
      }
    }
  } else {
    [0, 2, 3, 4, 5, 6, 7, 12, 13, 14, 15].forEach(k => { prevGamepadButtons[k] = false; });
  }

  const burstAngularSpeed = gameEngine?.getBurstAngularSpeed?.() ?? 0;

  if (params.paused || !gameEngine?.isSimulationActive()) {
    if (lenia) {
      const touchRadius = params.touchRadius * params.viewExtent;
      const renderArgs = { touchPos: params.mousePos, touchRadius, viewCenter: params.viewCenter, viewExtent: params.viewExtent, burstAngularSpeed };
      if (params.renderMode === 3) lenia.renderCompressedReconstruction(null, renderArgs);
      else {
        lenia.render(null, renderArgs);
        if (params.showTrailsOverlay) lenia.renderTrailsOverlay(null, renderArgs);
      }
    }
    return;
  }

  const touchRadius = params.touchRadius * params.viewExtent;
  const renderArgs = {
    touchPos: params.mousePos,
    touchRadius,
    viewCenter: params.viewCenter,
    viewExtent: params.viewExtent,
    burstAngularSpeed
  };

  for (let i = 0; i < params.stepN; i++) {
    lenia.step({ attractPos: params.mousePos, attractRadius: 0, stepN: 1 });
  }
  if (params.consumeEnabled) lenia.consumeResources();
  if (params.enableLifeCycle && params.enableDeaths) lenia.processDeaths();
  lenia.accumulateTrails();

  updateAutoCamera();
  renderArgs.viewCenter = params.viewCenter;
  renderArgs.viewExtent = params.viewExtent;

  if (params.renderMode === 3) lenia.renderCompressedReconstruction(null, renderArgs);
  else {
    lenia.render(null, renderArgs);
    if (params.showTrailsOverlay) lenia.renderTrailsOverlay(null, renderArgs);
  }

  gameEngine.update();
  tickSkillCooldowns();
  if (gameEngine.isPlayMode() && lenia) {
    eatenRingsFrameCount++;
    if (eatenRingsFrameCount % EATEN_RINGS_THROTTLE === 0) updateEatenRings();
  }
}

initGame();
