/**
 * Lennings Game Engine - A game wrapper around Particle Lenia
 * 
 * This module provides:
 * - Level management (loading, switching, progress tracking)
 * - Win condition checking (SSIM threshold)
 * - Game state management (playing, won, paused)
 * - Event system for UI updates
 * 
 * Design philosophy:
 * - The game engine wraps the simulation, not replaces it
 * - Reusable for different game modes and prototypes
 * - Levels define parameter overrides, engine handles the rest
 */

class LenningsGameEngine {
    constructor(options = {}) {
        // Configuration
        this.resourcesPath = options.resourcesPath || 'resources';
        this.parametersPath = options.parametersPath || 'parameters.json';
        /** Level pack path (e.g. 'levels/GlassBeadGame'). When set, loads dataset.json + images from pack */
        this.levelPackPath = options.levelPackPath || null;
        
        // Available resources (from level pack manifest or legacy image+json pairs)
        this.availableResources = [];
        this.playedResources = []; // Track which resources have been played this session
        /**
         * Glass Bead Game motif metadata, keyed by motif id.
         * Each entry comes from gbg-motifs.json and typically includes:
         * - id, name, name_pt_br
         * - chapter, description, level
         * - embedding: number[]
         * - tarot_index
         * - iching_hexagram_number (+ optional iching_* name fields)
         */
        this.motifMetadataById = new Map();
        
        // Game state
        this.levels = []; // For compatibility
        this.currentLevelIndex = -1;
        this.currentLevel = null;
        this.currentResource = null; // Current resource being played
        this.gameState = 'idle'; // 'idle', 'loading', 'playing', 'won', 'paused'
        this.winCondition = null;
        
        // Base parameters (loaded from parameters.json)
        this.baseParams = {};
        this.baseParamMap = {};
        
        // References to simulation (set via attachSimulation)
        this.lenia = null;
        this.params = null;
        
        // Event listeners
        this.eventListeners = new Map();
        
        // Digest system (reconstruct from eaten pixels; used pixels are "digested" and unavailable for next)
        this.maxDigests = 3; // Charges per level
        this.digests = []; // Array of taken digests
        this.isAnimatingDigest = false;
        this.digestGeneration = 0;
        /** Set of "x,y" keys of pixels already used in a reconstruction (digested) - excluded from next digest */
        this.digestedPixelKeys = new Set();
        
        // Win condition checking (only used when snapshot is taken now)
        this.winCheckInterval = 15;
        this.framesSinceLastCheck = 0;
        this.ssimHistory = [];
        this.ssimHistorySize = 5;
        
        // Performance metrics
        this.startTime = null;
        this.elapsedTime = 0;
        
        // Glass Bead Game: 7 classical colors (RGB 0-1) for spawn
        this.classicalColors = [
            [1, 0, 0],     // Red
            [1, 0.5, 0],   // Orange
            [1, 1, 0],     // Yellow
            [0, 1, 0],     // Green
            [0, 0, 1],     // Blue
            [0.29, 0, 0.51],  // Indigo
            [0.58, 0, 0.83]   // Violet
        ];
        this.spawnCount = 7;

        // Shared embedding space (multi-layer embedding registry). Created lazily.
        this.embeddingSpace = null;
        
        // Skills: key -> { key, label, cooldownMs, cooldownEndAt, action }
        this.skills = new Map();
        this.skillCooldownEnd = new Map(); // key -> timestamp
        // Speed burst state (W skill)
        this.speedBurstEndAt = null;
        this.baseStepN = null;
        this.baseResourceAttraction = null;
    }
    
    // ============================================================
    // Event System
    // ============================================================
    
    on(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
        return () => this.off(event, callback); // Return unsubscribe function
    }
    
    off(event, callback) {
        if (this.eventListeners.has(event)) {
            const listeners = this.eventListeners.get(event);
            const index = listeners.indexOf(callback);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        }
    }
    
    emit(event, data) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`[GameEngine] Error in event listener for ${event}:`, error);
                }
            });
        }
    }
    
    // ============================================================
    // Initialization
    // ============================================================
    
    /**
     * Load base parameters and discover available resources
     */
    async initialize() {
        this.gameState = 'loading';
        this.emit('stateChange', { state: this.gameState });
        
        try {
            // Load base parameters
            const paramsResponse = await fetch(this.parametersPath);
            const paramsConfig = await paramsResponse.json();
            this.baseParams = paramsConfig;
            
            // Build flat paramMap for easy lookup
            this.baseParamMap = {};
            for (const [category, catData] of Object.entries(paramsConfig)) {
                if (category === 'description' || category === 'version') continue;
                if (catData.params) {
                    for (const [paramName, paramData] of Object.entries(catData.params)) {
                        this.baseParamMap[paramName] = paramData;
                    }
                }
            }
            
            // Discover available resources
            // We'll try to load known resources - in a real setup this could be a manifest
            await this.discoverResources();
            // Optionally enrich resources with Glass Bead Game motif metadata + embeddings
            await this.loadMotifMetadataIfAvailable();
            
            console.log(`[GameEngine] Found ${this.availableResources.length} resources`);
            this.emit('resourcesLoaded', { resources: this.availableResources });
            
            // Default win condition (can be overridden by resource config)
            this.winCondition = { type: 'ssim', threshold: 0.7 };
            
            this.gameState = 'idle';
            this.emit('stateChange', { state: this.gameState });
            
            // Glass Bead Game skills (key-triggered, with cooldowns)
            this.registerSkill({
                key: 'r',
                label: 'Respawn',
                cooldownMs: 5000,
                action: () => this.respawnAtRandom()
            });
            this.registerSkill({
                key: 'w',
                label: 'Speed burst',
                cooldownMs: 100,
                action: () => this.startSpeedBurst()
            });
            this.registerSkill({
                key: 'e',
                label: 'Evolve',
                cooldownMs: 100,
                action: () => this.triggerEvolve()
            });
            this.registerSkill({
                key: 'd',
                label: 'Digest',
                cooldownMs: 0,
                action: () => this.takeDigest()
            });

            // Q - Split: trigger reproduction for all particles above threshold (with cooldown)
            this.registerSkill({
                key: 'q',
                label: 'Split',
                cooldownMs: 200,
                action: () => this.triggerSplitReproduction()
            });
            
            return true;
        } catch (error) {
            console.error('[GameEngine] Failed to initialize:', error);
            this.emit('error', { message: 'Failed to load game configuration', error });
            return false;
        }
    }
    
    /**
     * Discover available resources.
     * If levelPackPath is set: load dataset.json from that path and use motifs[] (id, name, image);
     * images are at levelPackPath/images/<image>. No per-image json.
     * Otherwise: legacy mode with known image+config pairs in resourcesPath.
     */
    async discoverResources() {
        this.availableResources = [];
        let defaultSsimThreshold = 0.7;
        
        if (this.levelPackPath) {
            // Level pack: dataset.json + images folder
            try {
                const manifestUrl = `${this.levelPackPath}/dataset.json`;
                const res = await fetch(manifestUrl);
                if (!res.ok) {
                    throw new Error(`Failed to load ${manifestUrl}: ${res.status}`);
                }
                const dataset = await res.json();
                defaultSsimThreshold = dataset.ssimThreshold ?? 0.7;
                const motifs = dataset.motifs || [];
                const imagesBase = `${this.levelPackPath}/images`;
                
                for (const motif of motifs) {
                    const id = motif.id || (motif.image && motif.image.replace(/\.[^.]+$/, '')) || String(this.availableResources.length);
                    const name = motif.name || id;
                    const imageFile = motif.image || `${id}.jpg`;
                    this.availableResources.push({
                        id,
                        imagePath: `${imagesBase}/${imageFile}`,
                        config: { name, ssimThreshold: motif.ssimThreshold ?? defaultSsimThreshold }
                    });
                }
                console.log(`[GameEngine] Level pack "${dataset.name || this.levelPackPath}": ${this.availableResources.length} motifs`);
            } catch (error) {
                console.error('[GameEngine] Failed to load level pack:', error);
            }
        } else {
            // Legacy: known image + json pairs in resources folder
            const knownResources = [
                { image: 'zenarnie.jpg', config: 'zenarnie.json' },
                { image: 'mandalaw.jpeg', config: 'mandalaw.json' },
                { image: 'height_shade-3.png', config: 'height_shade-3.json' }
            ];
            for (const resource of knownResources) {
                try {
                    const configResponse = await fetch(`${this.resourcesPath}/${resource.config}`);
                    if (!configResponse.ok) continue;
                    const config = await configResponse.json();
                    this.availableResources.push({
                        id: resource.image.replace(/\.[^.]+$/, ''),
                        imagePath: `${this.resourcesPath}/${resource.image}`,
                        configPath: `${this.resourcesPath}/${resource.config}`,
                        config
                    });
                } catch (e) {
                    console.warn(`[GameEngine] Failed to load resource ${resource.image}:`, e);
                }
            }
        }
        
        // Build levels array for compatibility
        this.levels = this.availableResources.map((res) => ({
            id: res.id,
            name: res.config.name || res.id,
            description: res.config.description || '',
            resourceImage: res.imagePath,
            ssimThreshold: res.config.ssimThreshold ?? defaultSsimThreshold,
            overrides: {
                spawn: {
                    spawnCenter: (res.config.spawnCenter || [0, 0]).slice(),
                    spawnCount: res.config.spawnCount ?? 5
                }
            }
        }));
    }
    
    /**
     * Get a random unplayed resource, or reset if all have been played
     */
    getRandomResource() {
        // Get resources that haven't been played yet
        const unplayed = this.availableResources.filter(
            res => !this.playedResources.includes(res.id)
        );
        
        // If all resources have been played, reset the played list
        if (unplayed.length === 0) {
            console.log('[GameEngine] All resources played, resetting...');
            this.playedResources = [];
            return this.availableResources[Math.floor(Math.random() * this.availableResources.length)];
        }
        
        // Return a random unplayed resource
        return unplayed[Math.floor(Math.random() * unplayed.length)];
    }
    
    /**
     * Attach the Particle Lenia simulation instance
     */
    attachSimulation(lenia, params) {
        this.lenia = lenia;
        this.params = params;
        console.log('[GameEngine] Simulation attached');
    }
    
    // ============================================================
    // Level Management
    // ============================================================
    
    /**
     * Get parameter value, checking level overrides first, then base params
     */
    getParamValue(paramName, category = null) {
        // Check level overrides first
        if (this.currentLevel && this.currentLevel.overrides) {
            for (const [cat, catParams] of Object.entries(this.currentLevel.overrides)) {
                if (catParams[paramName] !== undefined) {
                    return catParams[paramName];
                }
            }
        }
        
        // Fall back to base params
        const param = this.baseParamMap[paramName];
        if (param && param.value !== undefined) {
            return param.value;
        }
        
        return undefined;
    }
    
    /**
     * Apply level configuration to the simulation
     */
    applyLevelConfig(level) {
        if (!this.lenia || !this.params) {
            console.error('[GameEngine] Simulation not attached');
            return false;
        }
        
        // Apply spawn overrides
        if (level.overrides && level.overrides.spawn) {
            const spawn = level.overrides.spawn;
            if (spawn.spawnCenter) {
                this.params.spawnCenter = spawn.spawnCenter.slice(); // Copy array
                this.params.viewCenter = spawn.spawnCenter.slice(); // Center view on spawn
            }
            if (spawn.spawnCount !== undefined) {
                this.params.spawnCount = spawn.spawnCount;
            }
        }
        
        // Apply simulation overrides
        if (level.overrides && level.overrides.simulation) {
            const sim = level.overrides.simulation;
            for (const [key, value] of Object.entries(sim)) {
                if (this.lenia.U[key] !== undefined) {
                    this.lenia.U[key] = value;
                } else if (this.params[key] !== undefined) {
                    this.params[key] = value;
                }
            }
        }
        
        // Apply life cycle overrides
        if (level.overrides && level.overrides.lifeCycle) {
            const life = level.overrides.lifeCycle;
            for (const [key, value] of Object.entries(life)) {
                if (this.lenia.U[key] !== undefined) {
                    this.lenia.U[key] = value;
                } else if (this.params[key] !== undefined) {
                    this.params[key] = value;
                }
            }
        }
        
        return true;
    }
    
    /**
     * Start a specific level by index
     */
    async startLevel(levelIndex) {
        if (levelIndex < 0 || levelIndex >= this.levels.length) {
            console.error(`[GameEngine] Invalid level index: ${levelIndex}`);
            return false;
        }
        
        const level = this.levels[levelIndex];
        return this.startLevelWithConfig(level, levelIndex);
    }
    
    /**
     * Start a random level (used on initial game start)
     */
    async startRandomLevel() {
        const resource = this.getRandomResource();
        if (!resource) {
            console.error('[GameEngine] No resources available');
            return false;
        }
        
        // Mark this resource as played
        this.playedResources.push(resource.id);
        
        // Find the level index for this resource
        const levelIndex = this.levels.findIndex(l => l.id === resource.id);
        const level = this.levels[levelIndex] || {
            id: resource.id,
            name: resource.config.name || resource.id,
            description: resource.config.description || '',
            resourceImage: resource.imagePath,
            ssimThreshold: resource.config.ssimThreshold || 0.7,
            overrides: {
                spawn: {
                    spawnCenter: resource.config.spawnCenter || [0, 0],
                    spawnCount: resource.config.spawnCount || 5
                }
            }
        };
        
        return this.startLevelWithConfig(level, levelIndex >= 0 ? levelIndex : 0);
    }
    
    /**
     * Start a level with given configuration
     */
    async startLevelWithConfig(level, levelIndex) {
        this.currentLevelIndex = levelIndex;
        this.currentLevel = level;
        this.currentResource = this.availableResources.find(r => r.id === level.id) || null;
        this.gameState = 'loading';
        this.emit('stateChange', { state: this.gameState, level: level });
        
        console.log(`[GameEngine] Starting level: ${level.name}`);
        
        // Set win condition from level config
        this.winCondition = { 
            type: 'ssim', 
            threshold: level.ssimThreshold || 0.7 
        };
        
        // Apply level configuration
        this.applyLevelConfig(level);
        
        // Load resource image
        if (level.resourceImage) {
            try {
                await this.lenia.loadResourceImage(level.resourceImage);
                console.log(`[GameEngine] Loaded resource: ${level.resourceImage}`);
            } catch (error) {
                console.error('[GameEngine] Failed to load resource image:', error);
            }
        } else {
            // Reload to reset consumed pixels and reconstruction
            this.lenia.reloadResourceImage();
        }
        
        // Reset game-specific frame counter
        this.lenia._gameReconstructionFrame = 0;
        
        // Reset simulation: 7 particles, classical colors, random spawn center
        const spawnCount = this.spawnCount;
        const spawnCenter = this.getRandomSpawnCenter();
        this.params.spawnCenter = spawnCenter.slice();
        this.params.spawnCount = spawnCount;
        this.lenia.resetWithColors(spawnCount, spawnCenter, this.classicalColors);
        this.lenia.clearTrails();
        
        // Reset game metrics
        this.ssimHistory = [];
        this.framesSinceLastCheck = 0;
        this.startTime = Date.now();
        this.elapsedTime = 0;
        
        // Reset snapshot system - cancel any in-progress snapshot first
        if (this.isAnimatingDigest) {
            this.cancelDigest();
        }
        this.digests = [];
        this.isAnimatingDigest = false;
        this.digestGeneration++;
        this.digestedPixelKeys = new Set();
        
        // Emit reset event so UI can clean up
        this.emit('levelReset', {});
        
        // Unpause if paused
        if (this.params) {
            this.params.paused = false;
        }
        
        // Baseline for speed-burst skill (revert to these when burst ends)
        this.baseStepN = this.params.stepN;
        this.baseResourceAttraction = this.lenia.U.resourceAttraction;
        this.speedBurstEndAt = null;
        
        // Start playing
        this.gameState = 'playing';
        this.emit('stateChange', { state: this.gameState, level: level });
        this.emit('levelStart', { levelIndex, level });
        
        // Emit initial progress with zeroed values
        this.emit('progress', {
            ssim: 0,
            smoothedSSIM: 0,
            threshold: this.winCondition.threshold,
            progress: 0,
            cellCount: this.lenia.getAliveCount(),
            elapsedTime: 0
        });
        
        return true;
    }
    
    /**
     * Random spawn center within dish (world radius). Keeps spawn away from edges.
     */
    getRandomSpawnCenter() {
        const dishR = this.lenia ? this.lenia.dishR : 75;
        const margin = dishR * 0.35;
        const x = (Math.random() * 2 - 1) * (dishR - margin);
        const y = (Math.random() * 2 - 1) * (dishR - margin);
        return [x, y];
    }
    
    /**
     * Respawn: restart simulation with 7 particles at a new random location (same level, same image).
     * Used when player is stuck. Eaten/digested pixels and digest charges are preserved.
     */
    respawnAtRandom() {
        if (!this.lenia || !this.params || this.gameState === 'idle' || this.gameState === 'loading') return false;
        const spawnCenter = this.getRandomSpawnCenter();
        this.params.spawnCenter = spawnCenter.slice();
        this.params.spawnCount = this.spawnCount;
        this.lenia.resetWithColors(this.spawnCount, spawnCenter, this.classicalColors);
        this.lenia.clearTrails();
        this.emit('skillUsed', { key: 'r', name: 'respawn' });
        return true;
    }
    
    /**
     * Register a skill (key-triggered action with optional cooldown)
     */
    registerSkill(config) {
        const { key, label, cooldownMs = 0, action } = config;
        this.skills.set(key.toLowerCase(), { key: key.toLowerCase(), label: label || key, cooldownMs, action });
    }
    
    /**
     * Check if skill is on cooldown; return remaining ms or 0
     */
    getSkillCooldownRemaining(key) {
        const endAt = this.skillCooldownEnd.get(key.toLowerCase());
        if (!endAt) return 0;
        const remaining = endAt - Date.now();
        return remaining > 0 ? remaining : 0;
    }
    
    /**
     * Trigger skill by key. Returns true if skill ran, false if on cooldown or not found.
     */
    triggerSkill(key) {
        const k = key.toLowerCase();
        const skill = this.skills.get(k);
        if (!skill || !skill.action) return false;
        if (this.getSkillCooldownRemaining(k) > 0) return false;
        skill.action();
        if (skill.cooldownMs > 0) {
            this.skillCooldownEnd.set(k, Date.now() + skill.cooldownMs);
            this.emit('skillCooldown', { key: k, label: skill.label, cooldownMs: skill.cooldownMs });
        }
        return true;
    }
    
    /**
     * Start speed burst: for 5s add 3 to stepN and boost resourceAttraction
     */
    startSpeedBurst() {
        if (!this.params || !this.lenia) return;
        if (this.speedBurstEndAt && Date.now() < this.speedBurstEndAt) return; // already active
        this.baseStepN = this.baseStepN ?? this.params.stepN;
        this.baseResourceAttraction = this.baseResourceAttraction ?? this.lenia.U.resourceAttraction;
        const durationMs = 3000;
        this.speedBurstEndAt = Date.now() + durationMs;
        this.params.stepN = this.baseStepN + 3;
        this.lenia.U.resourceAttraction = Math.min(50, this.baseResourceAttraction + 8);
        this.emit('skillUsed', { key: 'w', name: 'speedBurst', durationMs });
    }
    
    /**
     * Update speed burst: revert when duration ends. Call each frame.
     */
    updateSpeedBurst() {
        if (this.speedBurstEndAt == null) return;
        if (Date.now() >= this.speedBurstEndAt) {
            this.speedBurstEndAt = null;
            if (this.params && this.baseStepN != null) this.params.stepN = this.baseStepN;
            if (this.lenia && this.baseResourceAttraction != null) this.lenia.U.resourceAttraction = this.baseResourceAttraction;
            this.baseStepN = null;
            this.baseResourceAttraction = null;
            this.emit('skillEnd', { key: 'w', name: 'speedBurst' });
        }
    }
    
    /**
     * Restart current level (full restart, same level config)
     */
    restartLevel() {
        if (this.currentLevel) {
            return this.startLevelWithConfig(this.currentLevel, this.currentLevelIndex);
        }
        return false;
    }

    /**
     * Split skill: immediately perform a reproduction step for all particles
     * whose energy is above the reproduction threshold. Timing is controlled
     * by the skill cooldown, not by simulation step interval.
     */
    triggerSplitReproduction() {
        if (!this.lenia || !this.params) return;

        const maxChildren = this.params.maxChildrenPerParent ?? 2;
        const useCpu = this.params.useCpuRepro ?? true;

        if (useCpu && this.lenia.cpuReproductionStep) {
            this.lenia.cpuReproductionStep(maxChildren);
        } else if (this.lenia.processReproduction) {
            this.lenia.processReproduction();
        }

        this.emit('skillUsed', { key: 'q', name: 'split' });
    }

    /**
     * Evolve skill: adapt particle colors toward their local environment
     * sampled from the resource texture. Each alive particle averages its
     * current preference color with the mean RGB of a small (k=5) neighborhood
     * around its position in the motif image.
     */
    triggerEvolve() {
        if (!this.lenia || !this.lenia.evolveColors) return;
        this.lenia.evolveColors(5);
        this.emit('skillUsed', { key: 'e', name: 'evolve' });
    }
    
    /**
     * Advance to next level - now loads a random new resource
     */
    nextLevel() {
        return this.startRandomLevel();
    }
    
    // ============================================================
    // Win Condition Checking
    // ============================================================
    
    /**
     * Check win condition (called each frame or at interval)
     */
    checkWinCondition() {
        if (this.gameState !== 'playing' || !this.lenia) {
            return false;
        }
        
        // Only check at interval for performance
        this.framesSinceLastCheck++;
        if (this.framesSinceLastCheck < this.winCheckInterval) {
            return false;
        }
        this.framesSinceLastCheck = 0;
        
        // Get current SSIM
        const currentSSIM = this.lenia.reconstructionSSIM || 0;
        
        // Add to history for smoothing
        this.ssimHistory.push(currentSSIM);
        if (this.ssimHistory.length > this.ssimHistorySize) {
            this.ssimHistory.shift();
        }
        
        // Calculate smoothed SSIM (average of recent readings)
        const smoothedSSIM = this.ssimHistory.reduce((a, b) => a + b, 0) / this.ssimHistory.length;
        
        // Emit progress update
        this.emit('progress', {
            ssim: currentSSIM,
            smoothedSSIM: smoothedSSIM,
            threshold: this.winCondition.threshold,
            progress: Math.min(100, (smoothedSSIM / this.winCondition.threshold) * 100),
            cellCount: this.lenia.getAliveCount(),
            elapsedTime: Date.now() - this.startTime
        });
        
        // Win is now triggered by snapshots, not passive monitoring
        // Just emit progress for UI updates
        return false;
    }
    
    /**
     * Trigger win state
     */
    triggerWin(finalSSIM) {
        this.gameState = 'won';
        this.elapsedTime = Date.now() - this.startTime;
        
        const winData = {
            levelIndex: this.currentLevelIndex,
            level: this.currentLevel,
            ssim: finalSSIM,
            elapsedTime: this.elapsedTime,
            cellCount: this.lenia.getAliveCount()
        };
        
        console.log(`[GameEngine] Level won! SSIM: ${finalSSIM.toFixed(3)}, Time: ${(this.elapsedTime / 1000).toFixed(1)}s`);
        
        this.emit('stateChange', { state: this.gameState, ...winData });
        this.emit('levelWon', winData);
    }
    
    // ============================================================
    // Game Loop Integration
    // ============================================================
    
    /**
     * Called each frame to update game state
     */
    update() {
        this.updateSpeedBurst();
        if (this.gameState === 'playing') {
            this.checkWinCondition();
        }
    }
    
    /**
     * Pause the game
     */
    pause() {
        if (this.gameState === 'playing') {
            this.gameState = 'paused';
            if (this.params) {
                this.params.paused = true;
            }
            this.emit('stateChange', { state: this.gameState });
        }
    }
    
    /**
     * Resume the game
     */
    resume() {
        if (this.gameState === 'paused') {
            this.gameState = 'playing';
            if (this.params) {
                this.params.paused = false;
            }
            this.emit('stateChange', { state: this.gameState });
        }
    }
    
    /**
     * Toggle pause state
     */
    togglePause() {
        if (this.gameState === 'playing') {
            this.pause();
        } else if (this.gameState === 'paused') {
            this.resume();
        }
    }
    
    // ============================================================
    // Snapshot System
    // ============================================================
    
    /**
     * Get remaining snapshot charges
     */
    getRemainingCharges() {
        return this.maxDigests - this.digests.length;
    }
    
    canTakeDigest() {
        return this.getRemainingCharges() > 0 && 
               this.gameState === 'playing' && 
               !this.isAnimatingDigest;
    }
    
    /**
     * Take a digest: reconstruct from available eaten pixels (excluding already digested).
     * Pixels used in this reconstruction are marked digested and excluded from the next digest.
     */
    async takeDigest() {
        if (!this.canTakeDigest()) {
            console.log('[GameEngine] Cannot digest - no charges or not playing');
            return null;
        }
        
        if (!this.lenia) {
            console.error('[GameEngine] No lenia instance attached');
            return null;
        }
        
        this.isAnimatingDigest = true;
        const wasPaused = this.params?.paused;
        if (this.params) this.params.paused = true;
        
        const eatenPixels = this.lenia.getEatenPixels(true, this.digestedPixelKeys);
        
        if (eatenPixels.length === 0) {
            console.log('[GameEngine] No available (non-digested) pixels to digest');
            this.isAnimatingDigest = false;
            if (this.params && !wasPaused) this.params.paused = false;
            this.emit('digestFailed', { reason: 'No pixels available (all digested or none eaten)' });
            return null;
        }
        
        const startGeneration = this.digestGeneration;
        
        this.emit('digestStart', { 
            chargesRemaining: this.getRemainingCharges() - 1,
            pixelCount: eatenPixels.length
        });
        
        try {
            this.lenia.eatenPixelsCache = null;
            this.lenia.lastEatenCount = 0;
            this.lenia.lastReconstructionDims = null;
            
            const reconstructionPromise = this.lenia.createCompressedReconstruction(true, this.digestedPixelKeys);
            // Timeout is now generous since the optimized algorithm is much faster
            // Old k-d tree approach: O(n²) - could take 30+ seconds
            // New spatial hash approach: O(n) - should take < 1 second
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Reconstruction timeout')), 15000)
            );
            
            let reconstruction;
            let ssim;
            
            try {
                reconstruction = await Promise.race([reconstructionPromise, timeoutPromise]);
                ssim = this.lenia.reconstructionSSIM || 0;
            } catch (timeoutError) {
                console.warn('[GameEngine] Reconstruction timed out');
                reconstruction = this.lenia.compressedReconstruction || { width: 256, height: 256 };
                ssim = this.lenia.reconstructionSSIM || 0;
            }
            
            if (this.digestGeneration !== startGeneration) return null;
            if (!reconstruction) {
                this.isAnimatingDigest = false;
                if (this.params && !wasPaused) this.params.paused = false;
                this.emit('digestFailed', { reason: 'Reconstruction failed' });
                return null;
            }
            
            const digest = {
                id: `digest-${Date.now()}`,
                index: this.digests.length,
                ssim,
                rgbd: this.lenia.reconstructionRGBd || 0,
                pixelCount: eatenPixels.length,
                width: reconstruction.width || 256,
                height: reconstruction.height || 256,
                timestamp: Date.now(),
                eatenPixels: eatenPixels.slice(0, 3000),
                imageDataURL: null
            };
            
            if (this.digestGeneration !== startGeneration) {
                this.isAnimatingDigest = false;
                return null;
            }
            
            const dataURL = this.lenia.getReconstructionDataURL();
            digest.imageDataURL = dataURL;
            
            this.emit('digestAnimate', { digest, eatenPixels: digest.eatenPixels, reconstruction });
            return digest;
            
        } catch (error) {
            console.error('[GameEngine] Digest error:', error);
            this.isAnimatingDigest = false;
            if (this.params && !wasPaused) this.params.paused = false;
            this.emit('digestFailed', { reason: error.message });
            return null;
        }
    }
    
    completeDigest(digest) {
        if (!digest) return;
        if (!this.isAnimatingDigest) return;
        
        this.digests.push(digest);
        const usedKeys = this.lenia.getLastUsedPixelKeys();
        usedKeys.forEach(k => this.digestedPixelKeys.add(k));
        
        const meetsThreshold = digest.ssim >= this.winCondition.threshold;
        this.isAnimatingDigest = false;
        
        this.emit('digestComplete', { digest, chargesRemaining: this.getRemainingCharges(), meetsThreshold });
        
        if (meetsThreshold) {
            this.triggerWin(digest.ssim);
        } else if (this.params) {
            this.params.paused = false;
        }
        return digest;
    }
    
    cancelDigest() {
        if (this.isAnimatingDigest) {
            this.isAnimatingDigest = false;
            if (this.params) this.params.paused = false;
            this.emit('digestCancelled', {});
        }
    }
    
    // ============================================================
    // Glass Bead Game Motif Metadata & Embeddings
    // ============================================================
    
    /**
     * Attempt to load rich motif metadata (including embeddings and Tarot/I Ching links)
     * from a GBG dataset that lives alongside the level pack.
     * 
     * This is intentionally best-effort and will not break the game if the file is missing.
     */
    async loadMotifMetadataIfAvailable() {
        if (!this.levelPackPath) {
            return;
        }
        
        // Prefer LM Studio–regenerated motifs (768-d, same space as tales); fallback to legacy gbg-motifs.json
        const primaryUrl = `${this.levelPackPath}/gbg-motifs.lmstudio.json`;
        const fallbackUrl = `${this.levelPackPath}/gbg-motifs.json`;
        try {
            let res = await fetch(primaryUrl);
            if (!res.ok) {
                console.info(`[GameEngine] ${primaryUrl} not available (${res.status}), trying ${fallbackUrl}`);
                res = await fetch(fallbackUrl);
            }
            if (!res.ok) {
                console.info(`[GameEngine] No GBG motif metadata found (status ${res.status})`);
                return;
            }
            const motifs = await res.json();
            const map = new Map();
            if (Array.isArray(motifs)) {
                for (const motif of motifs) {
                    if (!motif || !motif.id) continue;
                    map.set(motif.id, motif);
                }
            }
            this.motifMetadataById = map;
            
            // Enrich any already-discovered resources with this metadata
            this.enrichResourcesFromMetadata();

            // Register the motifs layer in the shared embedding space, if helpers are available.
            try {
                if (typeof getGlobalEmbeddingSpace === 'function') {
                    this.embeddingSpace = getGlobalEmbeddingSpace();
                }
                if (typeof createMotifLayerFromGameEngine === 'function' && this.embeddingSpace) {
                    createMotifLayerFromGameEngine(this, this.embeddingSpace);
                }
                console.log(`[GameEngine] Loaded GBG motif metadata with embeddings for ${this.motifMetadataById.size} motifs`);
            } catch (e) {
                console.warn('[GameEngine] Failed to register motifs layer in EmbeddingSpace:', e);
            }
        } catch (error) {
            console.warn('[GameEngine] Failed to load GBG motif metadata:', error);
        }
    }
    
    /**
     * Attach any loaded motif metadata (including embeddings) to available resources
     * so game logic and UI can access it easily.
     */
    enrichResourcesFromMetadata() {
        if (!this.motifMetadataById || this.motifMetadataById.size === 0) {
            return;
        }
        for (const res of this.availableResources) {
            if (!res || !res.id) continue;
            const meta = this.motifMetadataById.get(res.id);
            if (!meta) continue;
            res.metadata = meta;
            if (Array.isArray(meta.embedding)) {
                res.embedding = meta.embedding;
            }
        }
    }
    
    /**
     * Get rich motif metadata by id (if available).
     */
    getMotifById(id) {
        if (!id || !this.motifMetadataById) return null;
        return this.motifMetadataById.get(id) || null;
    }
    
    /**
     * Get an embedding vector for a given motif/resource id, or null if unavailable.
     */
    getEmbeddingForId(id) {
        const motif = this.getMotifById(id);
        if (motif && Array.isArray(motif.embedding)) {
            return motif.embedding;
        }
        return null;
    }

    /**
     * Get the localized display name for a motif id based on language.
     * language: 'en' | 'pt_br'
     */
    getLocalizedMotifName(id, language = 'en') {
        const motif = this.getMotifById(id);
        if (!motif) return null;
        if (language === 'pt_br' && motif.name_pt_br) {
            return motif.name_pt_br;
        }
        return motif.name || motif.id || null;
    }

    /**
     * Get the tarot_index for a motif id, or null if unavailable.
     */
    getTarotIndexForId(id) {
        const motif = this.getMotifById(id);
        if (!motif || typeof motif.tarot_index !== 'number') return null;
        return motif.tarot_index;
    }

    /**
     * Get the I Ching hexagram number for a motif id, or null if unavailable.
     */
    getIChingHexagramNumberForId(id) {
        const motif = this.getMotifById(id);
        if (!motif || typeof motif.iching_hexagram_number !== 'number') return null;
        return motif.iching_hexagram_number;
    }

    /**
     * Accessor for the shared EmbeddingSpace instance so UI code can
     * perform higher-level queries (e.g. nearest tales to a motif).
     */
    getEmbeddingSpace() {
        if (this.embeddingSpace) return this.embeddingSpace;
        if (typeof getGlobalEmbeddingSpace === 'function') {
            this.embeddingSpace = getGlobalEmbeddingSpace();
            return this.embeddingSpace;
        }
        if (typeof EmbeddingSpace === 'function') {
            this.embeddingSpace = new EmbeddingSpace();
            return this.embeddingSpace;
        }
        return null;
    }
    
    /**
     * Compute cosine similarity between two numeric vectors.
     * Returns a value in [-1, 1], or null if inputs are invalid.
     */
    static cosineSimilarity(vecA, vecB) {
        if (!Array.isArray(vecA) || !Array.isArray(vecB)) return null;
        const len = Math.min(vecA.length, vecB.length);
        if (len === 0) return null;
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < len; i++) {
            const a = vecA[i] || 0;
            const b = vecB[i] || 0;
            dot += a * b;
            normA += a * a;
            normB += b * b;
        }
        if (normA === 0 || normB === 0) return null;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }
    
    /**
     * Convenience helper: cosine similarity between two motif/resource ids.
     */
    getCosineSimilarityBetweenIds(idA, idB) {
        const a = this.getEmbeddingForId(idA);
        const b = this.getEmbeddingForId(idB);
        if (!a || !b) return null;
        return LenningsGameEngine.cosineSimilarity(a, b);
    }
    
    getSnapshots() {
        return this.digests;
    }
    
    getBestSnapshot() {
        if (this.digests.length === 0) return null;
        return this.digests.reduce((best, d) => d.ssim > best.ssim ? d : best);
    }
    
    // ============================================================
    // Utility Methods
    // ============================================================
    
    /**
     * Get all available levels/resources
     */
    getLevels() {
        return this.levels;
    }
    
    /**
     * Get available resources
     */
    getAvailableResources() {
        return this.availableResources;
    }
    
    /**
     * Get current game status for display
     */
    getStatus() {
        return {
            gameState: this.gameState,
            currentLevel: this.currentLevel,
            currentLevelIndex: this.currentLevelIndex,
            totalLevels: this.levels.length,
            ssim: this.lenia ? this.lenia.reconstructionSSIM : 0,
            threshold: this.winCondition ? this.winCondition.threshold : 0.7,
            cellCount: this.lenia ? this.lenia.getAliveCount() : 0,
            elapsedTime: this.startTime ? Date.now() - this.startTime : 0
        };
    }
    
    /**
     * Check if currently in play mode (useful for hiding/showing UI)
     */
    isPlayMode() {
        return this.gameState === 'playing' || this.gameState === 'paused' || this.gameState === 'won' || this.gameState === 'loading';
    }
    
    /**
     * Check if simulation should be actively running
     */
    isSimulationActive() {
        return this.gameState === 'playing';
    }
    
    /**
     * Get level by index
     */
    getLevel(index) {
        return this.levels[index] || null;
    }
    
    /**
     * Get all levels
     */
    getLevels() {
        return this.levels;
    }
}

// Export for use in different module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LenningsGameEngine;
}
