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
        
        // Available resources (image + json pairs)
        this.availableResources = [];
        this.playedResources = []; // Track which resources have been played this session
        
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
        
        // Snapshot system
        this.maxSnapshots = 3; // Number of snapshot charges per level
        this.snapshots = []; // Array of taken snapshots
        this.isAnimatingSnapshot = false; // True during snapshot animation
        this.snapshotGeneration = 0; // Incremented on reset to invalidate pending operations
        
        // Win condition checking (only used when snapshot is taken now)
        this.winCheckInterval = 15;
        this.framesSinceLastCheck = 0;
        this.ssimHistory = [];
        this.ssimHistorySize = 5;
        
        // Performance metrics
        this.startTime = null;
        this.elapsedTime = 0;
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
            
            console.log(`[GameEngine] Found ${this.availableResources.length} resources`);
            this.emit('resourcesLoaded', { resources: this.availableResources });
            
            // Default win condition (can be overridden by resource config)
            this.winCondition = { type: 'ssim', threshold: 0.5 };
            
            this.gameState = 'idle';
            this.emit('stateChange', { state: this.gameState });
            
            return true;
        } catch (error) {
            console.error('[GameEngine] Failed to initialize:', error);
            this.emit('error', { message: 'Failed to load game configuration', error });
            return false;
        }
    }
    
    /**
     * Discover available resources in the resources folder
     * Each resource is an image file with a matching .json config
     */
    async discoverResources() {
        // Known resource files - in production this could be a manifest or directory listing
        const knownResources = [
            { image: 'zenarnie.jpg', config: 'zenarnie.json' },
            { image: 'mandalaw.jpeg', config: 'mandalaw.json' },
            { image: 'height_shade-3.png', config: 'height_shade-3.json' }
        ];
        
        this.availableResources = [];
        
        for (const resource of knownResources) {
            try {
                const configResponse = await fetch(`${this.resourcesPath}/${resource.config}`);
                if (!configResponse.ok) {
                    console.warn(`[GameEngine] Could not load config for ${resource.image}`);
                    continue;
                }
                
                const config = await configResponse.json();
                
                this.availableResources.push({
                    id: resource.image.replace(/\.[^.]+$/, ''), // Remove extension for ID
                    imagePath: `${this.resourcesPath}/${resource.image}`,
                    configPath: `${this.resourcesPath}/${resource.config}`,
                    config: config
                });
                
                console.log(`[GameEngine] Loaded resource: ${config.name || resource.image}`);
            } catch (error) {
                console.warn(`[GameEngine] Failed to load resource ${resource.image}:`, error);
            }
        }
        
        // For compatibility, create levels array from resources
        this.levels = this.availableResources.map((res, index) => ({
            id: res.id,
            name: res.config.name || res.id,
            description: res.config.description || '',
            resourceImage: res.imagePath,
            ssimThreshold: res.config.ssimThreshold || 0.5,
            overrides: {
                spawn: {
                    spawnCenter: res.config.spawnCenter || [0, 0],
                    spawnCount: res.config.spawnCount || 5
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
            ssimThreshold: resource.config.ssimThreshold || 0.5,
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
            threshold: level.ssimThreshold || 0.5 
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
        
        // Reset simulation with level's spawn configuration
        const spawnCount = this.getParamValue('spawnCount') || 3;
        const spawnCenter = this.getParamValue('spawnCenter') || [0, 0];
        this.lenia.reset(spawnCount, spawnCenter);
        this.lenia.clearTrails();
        
        // Reset game metrics
        this.ssimHistory = [];
        this.framesSinceLastCheck = 0;
        this.startTime = Date.now();
        this.elapsedTime = 0;
        
        // Reset snapshot system - cancel any in-progress snapshot first
        if (this.isAnimatingSnapshot) {
            this.cancelSnapshot();
        }
        this.snapshots = [];
        this.isAnimatingSnapshot = false;
        this.snapshotGeneration++; // Invalidate any pending snapshot operations
        
        // Emit reset event so UI can clean up
        this.emit('levelReset', {});
        
        // Unpause if paused
        if (this.params) {
            this.params.paused = false;
        }
        
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
     * Restart current level
     */
    restartLevel() {
        if (this.currentLevel) {
            return this.startLevelWithConfig(this.currentLevel, this.currentLevelIndex);
        }
        return false;
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
        return this.maxSnapshots - this.snapshots.length;
    }
    
    /**
     * Check if player can take a snapshot
     */
    canTakeSnapshot() {
        return this.getRemainingCharges() > 0 && 
               this.gameState === 'playing' && 
               !this.isAnimatingSnapshot;
    }
    
    /**
     * Take a snapshot of current reconstruction
     * Returns a promise that resolves when animation completes
     */
    async takeSnapshot() {
        if (!this.canTakeSnapshot()) {
            console.log('[GameEngine] Cannot take snapshot - no charges or not playing');
            return null;
        }
        
        if (!this.lenia) {
            console.error('[GameEngine] No lenia instance attached');
            return null;
        }
        
        // Pause the game during snapshot
        this.isAnimatingSnapshot = true;
        const wasPaused = this.params?.paused;
        if (this.params) {
            this.params.paused = true;
        }
        
        // Get eaten pixels first (fast operation)
        const eatenPixels = this.lenia.getEatenPixels(true);
        
        if (eatenPixels.length === 0) {
            console.log('[GameEngine] No eaten pixels to snapshot');
            this.isAnimatingSnapshot = false;
            if (this.params && !wasPaused) {
                this.params.paused = false;
            }
            this.emit('snapshotFailed', { reason: 'No pixels eaten yet' });
            return null;
        }
        
        // Store generation at start to detect resets
        const startGeneration = this.snapshotGeneration;
        
        // Emit start event immediately with pixel count for UI feedback
        this.emit('snapshotStart', { 
            chargesRemaining: this.getRemainingCharges() - 1,
            pixelCount: eatenPixels.length
        });
        
        try {
            // Always calculate fresh reconstruction on snapshot
            // Since we don't do periodic updates anymore, we must recalculate each time
            console.log('[GameEngine] Computing fresh reconstruction...');
            console.log('[GameEngine] Eaten pixels before refresh:', eatenPixels.length);
            
            // Clear ALL caches to force completely fresh calculation
            this.lenia.eatenPixelsCache = null;
            this.lenia.lastEatenCount = 0; // Force recalculation even if count matches
            this.lenia.lastReconstructionDims = null; // Force dimension recalculation
            
            // Get fresh eaten pixel count
            const freshPixels = this.lenia.getEatenPixels(true);
            console.log('[GameEngine] Fresh eaten pixels:', freshPixels.length);
            
            const reconstructionPromise = this.lenia.createCompressedReconstruction(true);
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
                console.log('[GameEngine] Reconstruction complete, SSIM:', ssim, 'dims:', reconstruction?.width, 'x', reconstruction?.height);
            } catch (timeoutError) {
                console.warn('[GameEngine] Reconstruction timed out, using last known state');
                // Use whatever we have
                reconstruction = this.lenia.compressedReconstruction || { width: 256, height: 256 };
                ssim = this.lenia.reconstructionSSIM || 0;
            }
            
            // Check if reset happened during reconstruction
            if (this.snapshotGeneration !== startGeneration) {
                console.log('[GameEngine] Snapshot cancelled due to reset');
                return null;
            }
            
            if (!reconstruction) {
                console.log('[GameEngine] Failed to create reconstruction');
                this.isAnimatingSnapshot = false;
                if (this.params && !wasPaused) {
                    this.params.paused = false;
                }
                this.emit('snapshotFailed', { reason: 'Reconstruction failed' });
                return null;
            }
            
            // Create snapshot object
            const snapshot = {
                id: `snapshot-${Date.now()}`,
                index: this.snapshots.length,
                ssim: ssim,
                rgbd: this.lenia.reconstructionRGBd || 0,
                pixelCount: eatenPixels.length,
                width: reconstruction.width || 256,
                height: reconstruction.height || 256,
                timestamp: Date.now(),
                eatenPixels: eatenPixels.slice(0, 3000), // Limit pixels for animation performance
                imageDataURL: null // Will be set after getting the image
            };
            
            // Check again if reset happened
            if (this.snapshotGeneration !== startGeneration) {
                console.log('[GameEngine] Snapshot cancelled due to reset (before animation)');
                this.isAnimatingSnapshot = false;
                return null;
            }
            
            // Get the reconstruction as a data URL for thumbnail
            const dataURL = this.lenia.getReconstructionDataURL();
            snapshot.imageDataURL = dataURL;
            console.log('[GameEngine] Got data URL, length:', dataURL?.length || 0);
            
            // Emit animation start event with pixel data
            this.emit('snapshotAnimate', { 
                snapshot,
                eatenPixels: snapshot.eatenPixels, // Use limited set
                reconstruction
            });
            
            // Wait for animation to complete (UI will call completeSnapshot)
            // The animation duration is handled by the UI
            return snapshot;
            
        } catch (error) {
            console.error('[GameEngine] Snapshot error:', error);
            this.isAnimatingSnapshot = false;
            if (this.params && !wasPaused) {
                this.params.paused = false;
            }
            this.emit('snapshotFailed', { reason: error.message });
            return null;
        }
    }
    
    /**
     * Complete a snapshot (called after animation finishes)
     */
    completeSnapshot(snapshot) {
        if (!snapshot) return;
        
        // Check if we've been reset since this snapshot was taken
        if (!this.isAnimatingSnapshot) {
            console.log('[GameEngine] Ignoring stale snapshot completion');
            return;
        }
        
        // Add to inventory
        this.snapshots.push(snapshot);
        
        // Check win condition based on snapshot
        const meetsThreshold = snapshot.ssim >= this.winCondition.threshold;
        
        this.isAnimatingSnapshot = false;
        
        // Emit snapshot complete event
        this.emit('snapshotComplete', { 
            snapshot,
            chargesRemaining: this.getRemainingCharges(),
            meetsThreshold
        });
        
        // Check for win
        if (meetsThreshold) {
            this.triggerWin(snapshot.ssim);
        } else if (this.params) {
            // Resume game if not won
            this.params.paused = false;
        }
        
        return snapshot;
    }
    
    /**
     * Cancel ongoing snapshot animation
     */
    cancelSnapshot() {
        if (this.isAnimatingSnapshot) {
            this.isAnimatingSnapshot = false;
            if (this.params) {
                this.params.paused = false;
            }
            this.emit('snapshotCancelled', {});
        }
    }
    
    /**
     * Get all snapshots taken this level
     */
    getSnapshots() {
        return this.snapshots;
    }
    
    /**
     * Get best snapshot (highest SSIM)
     */
    getBestSnapshot() {
        if (this.snapshots.length === 0) return null;
        return this.snapshots.reduce((best, snap) => 
            snap.ssim > best.ssim ? snap : best
        );
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
