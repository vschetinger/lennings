// Web Worker for compressed image reconstruction
// MOSAIC APPROACH: Each eaten pixel is a tile that can only be used ONCE
// Uses greedy assignment sorted by luminance for O(n log n) performance

// ============================================================================
// Utility Functions
// ============================================================================

// Calculate luminance (for sorting)
function luminance(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Squared color distance
function colorDistanceSq(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return dr * dr + dg * dg + db * db;
}

// ============================================================================
// SSIM Calculation
// ============================================================================

function calculateSSIM(img1, img2, width, height) {
    const L = 255;
    const k1 = 0.01, k2 = 0.03;
    const c1 = (k1 * L) ** 2;
    const c2 = (k2 * L) ** 2;
    
    let mean1 = 0, mean2 = 0;
    const n = width * height;
    
    const gray1 = new Float32Array(n);
    const gray2 = new Float32Array(n);
    
    for (let i = 0; i < n; i++) {
        const idx = i * 4;
        gray1[i] = 0.299 * img1[idx] + 0.587 * img1[idx + 1] + 0.114 * img1[idx + 2];
        gray2[i] = 0.299 * img2[idx] + 0.587 * img2[idx + 1] + 0.114 * img2[idx + 2];
        mean1 += gray1[i];
        mean2 += gray2[i];
    }
    mean1 /= n;
    mean2 /= n;
    
    let var1 = 0, var2 = 0, covar = 0;
    for (let i = 0; i < n; i++) {
        const d1 = gray1[i] - mean1;
        const d2 = gray2[i] - mean2;
        var1 += d1 * d1;
        var2 += d2 * d2;
        covar += d1 * d2;
    }
    var1 /= n;
    var2 /= n;
    covar /= n;
    
    const numerator = (2 * mean1 * mean2 + c1) * (2 * covar + c2);
    const denominator = (mean1 * mean1 + mean2 * mean2 + c1) * (var1 + var2 + c2);
    
    return Math.max(0, Math.min(1, numerator / denominator));
}

// ============================================================================
// RGB Distance Error
// ============================================================================

function calculateRGBError(img1, img2, width, height) {
    let totalError = 0;
    const n = width * height;
    
    for (let i = 0; i < n; i++) {
        const idx = i * 4;
        const dr = img1[idx] - img2[idx];
        const dg = img1[idx + 1] - img2[idx + 1];
        const db = img1[idx + 2] - img2[idx + 2];
        totalError += dr * dr + dg * dg + db * db;
    }
    
    return totalError;
}

// ============================================================================
// Mosaic Reconstruction - Each pixel used exactly once
// ============================================================================

function reconstructMosaic(eatenPixels, targetImageData, dims) {
    const targetWidth = dims.width;
    const targetHeight = dims.height;
    const targetData = targetImageData.data;
    const numTargetPixels = targetWidth * targetHeight;
    
    // Create result image (initially black)
    const result = new Uint8ClampedArray(numTargetPixels * 4);
    for (let i = 0; i < numTargetPixels * 4; i += 4) {
        result[i + 3] = 255; // Alpha
    }
    
    // If no eaten pixels, return black image
    if (eatenPixels.length === 0) {
        return result;
    }
    
    // Prepare target pixels with their positions and colors
    const targets = [];
    for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
            const idx = (y * targetWidth + x) * 4;
            const r = targetData[idx] / 255;
            const g = targetData[idx + 1] / 255;
            const b = targetData[idx + 2] / 255;
            targets.push({
                x, y,
                r, g, b,
                lum: luminance(r, g, b),
                idx: y * targetWidth + x
            });
        }
    }
    
    // Prepare eaten pixels with colors
    const tiles = eatenPixels.map((p, i) => ({
        r: p.r,
        g: p.g,
        b: p.b,
        lum: luminance(p.r, p.g, p.b),
        originalIdx: i
    }));
    
    // Sort both by luminance - this gives a good greedy assignment
    // Matching dark-to-dark and light-to-light
    targets.sort((a, b) => a.lum - b.lum);
    tiles.sort((a, b) => a.lum - b.lum);
    
    // Greedy assignment: match sorted targets to sorted tiles
    // Each tile used at most once
    const numAssignments = Math.min(targets.length, tiles.length);
    
    for (let i = 0; i < numAssignments; i++) {
        const target = targets[i];
        const tile = tiles[i];
        
        const outIdx = target.idx * 4;
        result[outIdx] = Math.round(tile.r * 255);
        result[outIdx + 1] = Math.round(tile.g * 255);
        result[outIdx + 2] = Math.round(tile.b * 255);
        result[outIdx + 3] = 255;
    }
    
    // Remaining target pixels (if more targets than tiles) stay black
    // This represents "holes" in the reconstruction
    
    return result;
}

// ============================================================================
// Advanced Mosaic - K-D Tree with proper deletion (slower but better quality)
// ============================================================================

class KDNode {
    constructor(tile, depth) {
        this.tile = tile;
        this.depth = depth;
        this.left = null;
        this.right = null;
        this.deleted = false;
    }
    
    getCoord() {
        const dim = this.depth % 3;
        return dim === 0 ? this.tile.r : (dim === 1 ? this.tile.g : this.tile.b);
    }
}

class MosaicKDTree {
    constructor(tiles) {
        this.root = this.build(tiles.slice(), 0);
        this.remaining = tiles.length;
    }
    
    build(tiles, depth) {
        if (tiles.length === 0) return null;
        if (tiles.length === 1) return new KDNode(tiles[0], depth);
        
        const dim = depth % 3;
        tiles.sort((a, b) => {
            const av = dim === 0 ? a.r : (dim === 1 ? a.g : a.b);
            const bv = dim === 0 ? b.r : (dim === 1 ? b.g : b.b);
            return av - bv;
        });
        
        const mid = Math.floor(tiles.length / 2);
        const node = new KDNode(tiles[mid], depth);
        node.left = this.build(tiles.slice(0, mid), depth + 1);
        node.right = this.build(tiles.slice(mid + 1), depth + 1);
        return node;
    }
    
    // Find and remove nearest tile (returns null if tree is empty)
    findAndRemoveNearest(r, g, b) {
        if (this.remaining === 0) return null;
        
        let bestNode = null;
        let bestDist = Infinity;
        
        const search = (node) => {
            if (!node || node.deleted) {
                // Still need to search children even if this node is deleted
                if (node) {
                    search(node.left);
                    search(node.right);
                }
                return;
            }
            
            const dist = colorDistanceSq(r, g, b, node.tile.r, node.tile.g, node.tile.b);
            if (dist < bestDist) {
                bestDist = dist;
                bestNode = node;
            }
            
            const dim = node.depth % 3;
            const targetVal = dim === 0 ? r : (dim === 1 ? g : b);
            const nodeVal = node.getCoord();
            const diff = targetVal - nodeVal;
            
            const first = diff < 0 ? node.left : node.right;
            const second = diff < 0 ? node.right : node.left;
            
            search(first);
            if (diff * diff < bestDist) {
                search(second);
            }
        };
        
        search(this.root);
        
        if (bestNode) {
            bestNode.deleted = true;
            this.remaining--;
            return bestNode.tile;
        }
        return null;
    }
}

function reconstructMosaicKD(eatenPixels, targetImageData, dims) {
    const targetWidth = dims.width;
    const targetHeight = dims.height;
    const targetData = targetImageData.data;
    const numTargetPixels = targetWidth * targetHeight;
    
    // Create result image
    const result = new Uint8ClampedArray(numTargetPixels * 4);
    for (let i = 0; i < numTargetPixels * 4; i += 4) {
        result[i + 3] = 255;
    }
    
    if (eatenPixels.length === 0) return result;
    
    // Prepare tiles
    const tiles = eatenPixels.map(p => ({
        r: p.r, g: p.g, b: p.b
    }));
    
    // Build k-d tree
    const kdTree = new MosaicKDTree(tiles);
    
    // Process target pixels - prioritize by importance (variance from neighbors could help)
    // For now, just process in raster order
    for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
            const srcIdx = (y * targetWidth + x) * 4;
            const tr = targetData[srcIdx] / 255;
            const tg = targetData[srcIdx + 1] / 255;
            const tb = targetData[srcIdx + 2] / 255;
            
            // Find and remove nearest unused tile
            const tile = kdTree.findAndRemoveNearest(tr, tg, tb);
            
            if (tile) {
                result[srcIdx] = Math.round(tile.r * 255);
                result[srcIdx + 1] = Math.round(tile.g * 255);
                result[srcIdx + 2] = Math.round(tile.b * 255);
                result[srcIdx + 3] = 255;
            }
            // else: no more tiles, pixel stays black
        }
    }
    
    return result;
}

// ============================================================================
// Worker Message Handler
// ============================================================================

self.onmessage = function(e) {
    const { id, eatenPixels, targetImageData, originalImageData, dims } = e.data;
    
    try {
        const startTime = performance.now();
        
        // Choose algorithm based on size
        // K-D tree with deletion is better quality but slower
        // Luminance sorting is fast and gives decent results
        let resultData;
        
        if (eatenPixels.length > 10000 || dims.width * dims.height > 10000) {
            // Use fast luminance-based matching for large images
            resultData = reconstructMosaic(eatenPixels, targetImageData, dims);
        } else {
            // Use k-d tree with deletion for better quality on smaller images
            resultData = reconstructMosaicKD(eatenPixels, targetImageData, dims);
        }
        
        const reconstructTime = performance.now() - startTime;
        
        // Scale original to reconstruction size for comparison
        const origWidth = originalImageData.width;
        const origHeight = originalImageData.height;
        const origData = originalImageData.data;
        
        const scaledOriginal = new Uint8ClampedArray(dims.width * dims.height * 4);
        for (let y = 0; y < dims.height; y++) {
            for (let x = 0; x < dims.width; x++) {
                const ox = Math.floor((x / dims.width) * origWidth);
                const oy = Math.floor((y / dims.height) * origHeight);
                const srcIdx = (oy * origWidth + ox) * 4;
                const dstIdx = (y * dims.width + x) * 4;
                
                scaledOriginal[dstIdx] = origData[srcIdx];
                scaledOriginal[dstIdx + 1] = origData[srcIdx + 1];
                scaledOriginal[dstIdx + 2] = origData[srcIdx + 2];
                scaledOriginal[dstIdx + 3] = 255;
            }
        }
        
        // Calculate metrics
        const ssimValue = calculateSSIM(scaledOriginal, resultData, dims.width, dims.height);
        const rgbError = calculateRGBError(scaledOriginal, resultData, dims.width, dims.height);
        
        const maxError = dims.width * dims.height * 3 * 255 * 255;
        const score = Math.max(0, Math.min(100, 100 * (1 - rgbError / maxError)));
        
        const totalTime = performance.now() - startTime;
        
        console.log(`[Worker] Mosaic: ${eatenPixels.length} tiles -> ${dims.width}x${dims.height} in ${totalTime.toFixed(0)}ms, SSIM: ${ssimValue.toFixed(3)}`);
        
        self.postMessage({
            id,
            success: true,
            result: Array.from(resultData),
            rgbdError: rgbError,
            ssimValue: ssimValue,
            ssimDistance: 1 - ssimValue,
            score: score,
            dims: dims
        });
        
    } catch (error) {
        console.error('[Worker] Error:', error);
        self.postMessage({
            id,
            success: false,
            error: error.message
        });
    }
};
