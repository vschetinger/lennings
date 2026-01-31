// Web Worker for compressed image reconstruction using k-d tree nearest neighbor search
// This prevents blocking the main thread during expensive computations

// ============================================================================
// Error Metric System - Class-based with decorators for extensibility
// ============================================================================

// Base Error Metric Class
class ErrorMetric {
    calculate(targetData, resultData, width, height) {
        throw new Error('Must implement calculate()');
    }
    
    getName() {
        return 'BaseErrorMetric';
    }
}

// RGB Distance Error Metric - Uses raw RGB values (0-255), squared differences
// Compares at original image resolution (scales reconstruction up if needed)
class RGBDistanceErrorMetric extends ErrorMetric {
    calculate(targetData, resultData, resultWidth, resultHeight, originalData, originalWidth, originalHeight) {
        // Scale up reconstruction to original resolution using nearest neighbor (pixel art style)
        const upscaledResult = new Uint8ClampedArray(originalWidth * originalHeight * 4);
        
        for (let oy = 0; oy < originalHeight; oy++) {
            for (let ox = 0; ox < originalWidth; ox++) {
                // Map original pixel to reconstruction pixel (nearest neighbor)
                const rx = Math.floor((ox / originalWidth) * resultWidth);
                const ry = Math.floor((oy / originalHeight) * resultHeight);
                const rIdx = (ry * resultWidth + rx) * 4;
                const oIdx = (oy * originalWidth + ox) * 4;
                
                // Copy pixel from reconstruction (upscaled)
                upscaledResult[oIdx + 0] = resultData[rIdx + 0];
                upscaledResult[oIdx + 1] = resultData[rIdx + 1];
                upscaledResult[oIdx + 2] = resultData[rIdx + 2];
                upscaledResult[oIdx + 3] = resultData[rIdx + 3];
            }
        }
        
        // Now compare upscaled reconstruction to original at full resolution
        let totalError = 0;
        let pixelCount = 0;
        
        for (let i = 0; i < originalWidth * originalHeight; i++) {
            const idx = i * 4;
            // Use raw RGB values (0-255 range), not normalized
            const dr = originalData[idx + 0] - upscaledResult[idx + 0];
            const dg = originalData[idx + 1] - upscaledResult[idx + 1];
            const db = originalData[idx + 2] - upscaledResult[idx + 2];
            
            // Squared differences per channel, summed
            const error = dr * dr + dg * dg + db * db;
            totalError += error;
            pixelCount++;
        }
        
        // Max possible error: if every pixel was completely different (255 diff in each channel)
        // For 512x512: 512*512*3*255*255 = 51,117,158,400 (about 51 billion)
        // JavaScript safe integer limit: 2^53 - 1 = 9,007,199,254,740,991 (9 quadrillion)
        // So we're well within safe integer range, but using Number (not BigInt) is fine
        const maxPossibleError = pixelCount * 3 * 255 * 255;
        
        return {
            error: totalError,  // Large number (e.g., billions) that decreases over time
            metadata: {
                pixelCount,
                averageError: totalError / pixelCount,
                maxPossibleError: maxPossibleError,
                originalResolution: `${originalWidth}x${originalHeight}`,
                reconstructionResolution: `${resultWidth}x${resultHeight}`
            }
        };
    }
    
    getName() {
        return 'RGBd';
    }
}

// SSIM (Structural Similarity Index Measure) Error Metric
// Measures structural similarity between images (luminance, contrast, structure)
// Returns SSIM value (0-1, where 1 = perfect match) and distance (1 - SSIM)
class SSIMErrorMetric extends ErrorMetric {
    calculate(targetData, resultData, resultWidth, resultHeight, originalData, originalWidth, originalHeight) {
        // Scale up reconstruction to original resolution using nearest neighbor (pixel art style)
        const upscaledResult = new Uint8ClampedArray(originalWidth * originalHeight * 4);
        
        for (let oy = 0; oy < originalHeight; oy++) {
            for (let ox = 0; ox < originalWidth; ox++) {
                // Map original pixel to reconstruction pixel (nearest neighbor)
                const rx = Math.floor((ox / originalWidth) * resultWidth);
                const ry = Math.floor((oy / originalHeight) * resultHeight);
                const rIdx = (ry * resultWidth + rx) * 4;
                const oIdx = (oy * originalWidth + ox) * 4;
                
                // Copy pixel from reconstruction (upscaled)
                upscaledResult[oIdx + 0] = resultData[rIdx + 0];
                upscaledResult[oIdx + 1] = resultData[rIdx + 1];
                upscaledResult[oIdx + 2] = resultData[rIdx + 2];
                upscaledResult[oIdx + 3] = resultData[rIdx + 3];
            }
        }
        
        // Convert RGB to luminance (grayscale) for SSIM calculation
        const originalLum = new Float32Array(originalWidth * originalHeight);
        const resultLum = new Float32Array(originalWidth * originalHeight);
        
        for (let i = 0; i < originalWidth * originalHeight; i++) {
            const idx = i * 4;
            // Standard luminance weights: 0.299*R + 0.587*G + 0.114*B
            originalLum[i] = 0.299 * originalData[idx + 0] + 
                            0.587 * originalData[idx + 1] + 
                            0.114 * originalData[idx + 2];
            resultLum[i] = 0.299 * upscaledResult[idx + 0] + 
                          0.587 * upscaledResult[idx + 1] + 
                          0.114 * upscaledResult[idx + 2];
        }
        
        // Calculate mean luminance
        let meanX = 0, meanY = 0;
        for (let i = 0; i < originalLum.length; i++) {
            meanX += originalLum[i];
            meanY += resultLum[i];
        }
        meanX /= originalLum.length;
        meanY /= originalLum.length;
        
        // Calculate variance and covariance
        let varX = 0, varY = 0, covXY = 0;
        for (let i = 0; i < originalLum.length; i++) {
            const diffX = originalLum[i] - meanX;
            const diffY = resultLum[i] - meanY;
            varX += diffX * diffX;
            varY += diffY * diffY;
            covXY += diffX * diffY;
        }
        varX /= originalLum.length;
        varY /= originalLum.length;
        covXY /= originalLum.length;
        
        // SSIM constants (typical values)
        const C1 = (0.01 * 255) * (0.01 * 255);  // Luminance stability constant
        const C2 = (0.03 * 255) * (0.03 * 255);  // Contrast stability constant
        
        // SSIM formula: (2μxμy + C1)(2σxy + C2) / ((μx² + μy² + C1)(σx² + σy² + C2))
        const numerator = (2 * meanX * meanY + C1) * (2 * covXY + C2);
        const denominator = (meanX * meanX + meanY * meanY + C1) * (varX + varY + C2);
        
        const ssim = numerator / denominator;
        const ssimDistance = 1.0 - ssim;  // Distance from perfect (0 = perfect, 1 = worst)
        
        return {
            error: ssimDistance,  // Distance from perfect (0-1, lower is better)
            ssim: ssim,  // SSIM value (0-1, higher is better)
            metadata: {
                pixelCount: originalLum.length,
                meanX: meanX,
                meanY: meanY,
                varX: varX,
                varY: varY,
                covXY: covXY,
                originalResolution: `${originalWidth}x${originalHeight}`,
                reconstructionResolution: `${resultWidth}x${resultHeight}`
            }
        };
    }
    
    getName() {
        return 'SSIM';
    }
}

// Perceptual Error Metric - Luminance-weighted perceptual distance
class PerceptualErrorMetric extends ErrorMetric {
    calculate(targetData, resultData, width, height) {
        function perceptualDistance(r1, g1, b1, r2, g2, b2) {
            const lum1 = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
            const lum2 = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
            const lumDiff = Math.abs(lum1 - lum2);
            
            const dr = r1 - r2;
            const dg = g1 - g2;
            const db = b1 - b2;
            const chromaDist = Math.sqrt(dr * dr + dg * dg + db * db);
            
            return 0.7 * lumDiff + 0.3 * chromaDist;
        }
        
        let totalError = 0;
        let pixelCount = 0;
        
        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            const tr = targetData[idx + 0] / 255.0;
            const tg = targetData[idx + 1] / 255.0;
            const tb = targetData[idx + 2] / 255.0;
            
            const rr = resultData[idx + 0] / 255.0;
            const rg = resultData[idx + 1] / 255.0;
            const rb = resultData[idx + 2] / 255.0;
            
            const error = perceptualDistance(tr, tg, tb, rr, rg, rb);
            totalError += error;
            pixelCount++;
        }
        
        const meanError = totalError / pixelCount;
        const maxPossibleError = pixelCount * 1.0;  // Max perceptual distance is ~1.0
        
        return {
            error: meanError,  // Normalized 0-1 range
            metadata: {
                pixelCount,
                averageError: meanError,
                maxPossibleError: maxPossibleError
            }
        };
    }
    
    getName() {
        return 'Perceptual';
    }
}

// Score Decorator - Transforms error into a normalized score (0-100, higher = better)
class ScoreDecorator {
    constructor(metric, maxError = null) {
        this.metric = metric;
        this.maxError = maxError;  // Optional: override max error for normalization
    }
    
    calculate(targetData, resultData, resultWidth, resultHeight, originalData, originalWidth, originalHeight) {
        const result = this.metric.calculate(targetData, resultData, resultWidth, resultHeight, originalData, originalWidth, originalHeight);
        
        // Transform error into score (0-100, where 100 = perfect match)
        let score = null;
        const maxPossible = this.maxError || result.metadata?.maxPossibleError;
        
        if (maxPossible && maxPossible > 0) {
            // Score = 100 * (1 - error/maxPossible)
            // When error = 0, score = 100 (perfect)
            // When error = maxPossible, score = 0 (worst)
            score = Math.max(0, Math.min(100, 100 * (1 - result.error / maxPossible)));
        }
        
        return {
            ...result,
            score: score,
            scoreFormatted: score !== null ? score.toFixed(1) : 'N/A'
        };
    }
    
    getName() {
        return `${this.metric.getName()}_Score`;
    }
}

// Simple squared Euclidean distance (faster for k-d tree)
function squaredDistance(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return dr * dr + dg * dg + db * db;
}

// k-d Tree Node for RGB color space (3D)
class KDNode {
    constructor(pixel, index, depth) {
        this.pixel = pixel;  // {r, g, b}
        this.index = index; // Original index in eatenPixels array
        this.depth = depth;
        this.left = null;
        this.right = null;
        this.used = false;  // Track if pixel has been used
    }
    
    // Get coordinate for current splitting dimension (0=r, 1=g, 2=b)
    getCoordinate() {
        const dim = this.depth % 3;
        if (dim === 0) return this.pixel.r;
        if (dim === 1) return this.pixel.g;
        return this.pixel.b;
    }
}

// k-d Tree for efficient nearest neighbor search in RGB space
class KDTree {
    constructor(eatenPixels) {
        this.root = this.buildTree(eatenPixels, 0);
    }
    
    // Build k-d tree from eaten pixels
    buildTree(pixels, depth) {
        if (pixels.length === 0) return null;
        if (pixels.length === 1) {
            return new KDNode(pixels[0].pixel, pixels[0].index, depth);
        }
        
        // Find median for current dimension
        const dim = depth % 3;
        pixels.sort((a, b) => {
            const aVal = dim === 0 ? a.pixel.r : (dim === 1 ? a.pixel.g : a.pixel.b);
            const bVal = dim === 0 ? b.pixel.r : (dim === 1 ? b.pixel.g : b.pixel.b);
            return aVal - bVal;
        });
        
        const medianIdx = Math.floor(pixels.length / 2);
        const node = new KDNode(pixels[medianIdx].pixel, pixels[medianIdx].index, depth);
        
        // Recursively build left and right subtrees
        node.left = this.buildTree(pixels.slice(0, medianIdx), depth + 1);
        node.right = this.buildTree(pixels.slice(medianIdx + 1), depth + 1);
        
        return node;
    }
    
    // Find nearest unused neighbor to target color
    findNearestUnused(targetR, targetG, targetB) {
        let bestNode = null;
        let bestDistance = Infinity;
        
        const search = (node, depth) => {
            if (!node) return;
            
            // Skip used nodes
            if (node.used) {
                // Still search both subtrees in case there are unused nodes
                search(node.left, depth + 1);
                search(node.right, depth + 1);
                return;
            }
            
            // Calculate distance to current node
            const dist = squaredDistance(targetR, targetG, targetB, 
                                        node.pixel.r, node.pixel.g, node.pixel.b);
            
            if (dist < bestDistance) {
                bestDistance = dist;
                bestNode = node;
            }
            
            // Determine which side to search first
            const dim = depth % 3;
            const targetVal = dim === 0 ? targetR : (dim === 1 ? targetG : targetB);
            const nodeVal = node.getCoordinate();
            
            const primary = targetVal < nodeVal ? node.left : node.right;
            const secondary = targetVal < nodeVal ? node.right : node.left;
            
            // Search primary side
            search(primary, depth + 1);
            
            // Check if we need to search secondary side
            const dimDiff = targetVal - nodeVal;
            if (dimDiff * dimDiff < bestDistance) {
                search(secondary, depth + 1);
            }
        };
        
        search(this.root, 0);
        return bestNode;
    }
}

// Perform k-d tree based nearest neighbor matching
function performKDTreeMatching(eatenPixels, targetImageData, dims) {
    const startTime = performance.now();
    
    // Handle both ImageData object and plain object with data array
    const targetData = targetImageData.data || targetImageData;
    const targetWidth = targetImageData.width || dims.width;
    const targetHeight = targetImageData.height || dims.height;
    
    // Prepare eaten pixels for tree building (with indices)
    const pixelsWithIndices = eatenPixels.map((pixel, index) => ({
        pixel: pixel,
        index: index
    }));
    
    // Build k-d tree from eaten pixels
    const tree = new KDTree(pixelsWithIndices);
    
    // Create result image data
    const resultImageData = new Uint8ClampedArray(targetData.length);
    
    // For each target pixel, find nearest unused eaten pixel
    for (let ty = 0; ty < dims.height; ty++) {
        for (let tx = 0; tx < dims.width; tx++) {
            const targetIdx = (ty * dims.width + tx) * 4;
            const tr = targetData[targetIdx + 0] / 255.0;
            const tg = targetData[targetIdx + 1] / 255.0;
            const tb = targetData[targetIdx + 2] / 255.0;
            
            // Find nearest unused pixel using k-d tree
            const nearestNode = tree.findNearestUnused(tr, tg, tb);
            
            if (nearestNode && !nearestNode.used) {
                // Use actual eaten pixel color
                resultImageData[targetIdx + 0] = Math.round(nearestNode.pixel.r * 255);
                resultImageData[targetIdx + 1] = Math.round(nearestNode.pixel.g * 255);
                resultImageData[targetIdx + 2] = Math.round(nearestNode.pixel.b * 255);
                resultImageData[targetIdx + 3] = 255;
                nearestNode.used = true;  // Mark as used
            } else {
                // No unused eaten pixel available - leave as black/transparent (only use eaten pixels!)
                resultImageData[targetIdx + 0] = 0;
                resultImageData[targetIdx + 1] = 0;
                resultImageData[targetIdx + 2] = 0;
                resultImageData[targetIdx + 3] = 0;  // Transparent/empty
            }
        }
    }
    
    const endTime = performance.now();
    console.log(`[Worker] k-d tree matching: ${(endTime - startTime).toFixed(2)}ms`);
    
    // Return only the reconstruction result - error calculation happens in onmessage
    return { 
        result: resultImageData
    };
}

// Handle messages from main thread
self.onmessage = function(e) {
    const {eatenPixels, targetImageData, originalImageData, dims, id} = e.data;
    
    try {
        // First, build the reconstruction using k-d tree matching
        const { result } = performKDTreeMatching(eatenPixels, targetImageData, dims);
        
        // Then, calculate error metrics by scaling reconstruction up to original resolution
        // This is O(n) and doesn't need k-d tree - just scale and compare
        const originalData = originalImageData ? new Uint8ClampedArray(originalImageData.data) : null;
        const originalWidth = originalImageData?.width || 512;
        const originalHeight = originalImageData?.height || 512;
        
        let rgbdError = 0;
        let ssimValue = 0;
        let ssimDistance = 0;
        let score = 0;
        
        if (originalData) {
            // Calculate RGB distance (RGBd)
            const rgbdMetric = new RGBDistanceErrorMetric();
            const rgbdResult = rgbdMetric.calculate(
                originalData,  // Original image at full resolution
                result,  // Reconstruction at compressed size
                dims.width,  // Reconstruction width
                dims.height,  // Reconstruction height
                originalData,  // Original data (for comparison)
                originalWidth,  // Original width (512)
                originalHeight  // Original height (512)
            );
            rgbdError = rgbdResult.error;
            
            // Calculate SSIM
            const ssimMetric = new SSIMErrorMetric();
            const ssimResult = ssimMetric.calculate(
                originalData,  // Original image at full resolution
                result,  // Reconstruction at compressed size
                dims.width,  // Reconstruction width
                dims.height,  // Reconstruction height
                originalData,  // Original data (for comparison)
                originalWidth,  // Original width (512)
                originalHeight  // Original height (512)
            );
            ssimValue = ssimResult.ssim || 0;
            ssimDistance = ssimResult.error || 0;
            
            // Calculate score for metadata (not used for display, but available)
            const scoreDecorator = new ScoreDecorator(rgbdMetric);
            const scoreResult = scoreDecorator.calculate(
                originalData, result, dims.width, dims.height,
                originalData, originalWidth, originalHeight
            );
            score = scoreResult.score;
            
            // Debug: log calculated metrics
            console.log(`[Worker] Metrics calculated: RGBd=${rgbdError.toLocaleString()}, SSIM=${ssimValue.toFixed(3)}`);
        } else {
            console.warn('[Worker] No originalData provided, skipping metric calculation');
        }
        
        // Send result back to main thread
        self.postMessage({
            id,
            success: true,
            result,
            rgbdError: rgbdError,  // RGB distance (large number, calculated at original resolution)
            ssimValue: ssimValue,  // SSIM value (0-1, higher is better)
            ssimDistance: ssimDistance,  // SSIM distance (0-1, lower is better)
            score: score,   // Normalized score (0-100, for future use)
            dims
        });
    } catch (error) {
        console.error('[Worker] Error in k-d tree matching:', error);
        self.postMessage({
            id,
            success: false,
            error: error.message
        });
    }
};
