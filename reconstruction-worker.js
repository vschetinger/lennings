// Web Worker for compressed image reconstruction using histogram-based matching
// This prevents blocking the main thread during expensive computations

// Color quantization: 6 bits per channel = 64 levels (reduces from 256³ to 64³ bins)
const QUANT_BITS = 6;
const QUANT_LEVELS = 1 << QUANT_BITS; // 64
const QUANT_SCALE = QUANT_LEVELS - 1; // 63

// Quantize RGB value to bin index (0-63)
function quantizeColor(r, g, b) {
    const qr = Math.floor(r * QUANT_SCALE);
    const qg = Math.floor(g * QUANT_SCALE);
    const qb = Math.floor(b * QUANT_SCALE);
    return qr * QUANT_LEVELS * QUANT_LEVELS + qg * QUANT_LEVELS + qb;
}

// Convert bin index back to RGB (center of bin)
function dequantizeColor(bin) {
    const qb = bin % QUANT_LEVELS;
    const qg = Math.floor((bin / QUANT_LEVELS) % QUANT_LEVELS);
    const qr = Math.floor(bin / (QUANT_LEVELS * QUANT_LEVELS));
    return {
        r: (qr + 0.5) / QUANT_SCALE,
        g: (qg + 0.5) / QUANT_SCALE,
        b: (qb + 0.5) / QUANT_SCALE
    };
}

// Calculate perceptual distance between two colors (luminance-weighted)
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

// Perform histogram-based matching
function performHistogramMatching(eatenPixels, targetImageData, dims) {
    const startTime = performance.now();
    
    // Handle both ImageData object and plain object with data array
    const targetData = targetImageData.data || targetImageData;
    const targetWidth = targetImageData.width || dims.width;
    const targetHeight = targetImageData.height || dims.height;
    
    // Build histogram of eaten pixels
    const eatenHistogram = new Map(); // bin -> array of pixel indices
    for (let i = 0; i < eatenPixels.length; i++) {
        const pixel = eatenPixels[i];
        const bin = quantizeColor(pixel.r, pixel.g, pixel.b);
        if (!eatenHistogram.has(bin)) {
            eatenHistogram.set(bin, []);
        }
        eatenHistogram.get(bin).push(i);
    }
    
    // Build histogram of target pixels
    const targetHistogram = new Map(); // bin -> array of {idx, r, g, b}
    const targetPixels = [];
    for (let ty = 0; ty < dims.height; ty++) {
        for (let tx = 0; tx < dims.width; tx++) {
            const targetIdx = (ty * dims.width + tx) * 4;
            const tr = targetData[targetIdx + 0] / 255.0;
            const tg = targetData[targetIdx + 1] / 255.0;
            const tb = targetData[targetIdx + 2] / 255.0;
            
            const bin = quantizeColor(tr, tg, tb);
            if (!targetHistogram.has(bin)) {
                targetHistogram.set(bin, []);
            }
            targetHistogram.get(bin).push({idx: targetIdx, r: tr, g: tg, b: tb, tx, ty});
            targetPixels.push({idx: targetIdx, r: tr, g: tg, b: tb, tx, ty, bin});
        }
    }
    
    // Create result image data
    const resultImageData = new Uint8ClampedArray(targetData.length);
    const usedPixels = new Set();
    
    // Match bins: for each target bin, find best matching eaten bin
    const binMatches = new Map(); // target bin -> eaten bin
    
    for (const [targetBin, targetPixList] of targetHistogram.entries()) {
        if (targetPixList.length === 0) continue;
        
        // Get representative color for this target bin (average)
        let avgR = 0, avgG = 0, avgB = 0;
        for (const pix of targetPixList) {
            avgR += pix.r;
            avgG += pix.g;
            avgB += pix.b;
        }
        avgR /= targetPixList.length;
        avgG /= targetPixList.length;
        avgB /= targetPixList.length;
        
        // Find best matching eaten bin
        let bestEatenBin = null;
        let bestDistance = Infinity;
        
        for (const [eatenBin, eatenPixList] of eatenHistogram.entries()) {
            if (eatenPixList.length === 0) continue;
            
            // Get representative color for this eaten bin
            let eatenAvgR = 0, eatenAvgG = 0, eatenAvgB = 0;
            for (const pixIdx of eatenPixList) {
                const pix = eatenPixels[pixIdx];
                eatenAvgR += pix.r;
                eatenAvgG += pix.g;
                eatenAvgB += pix.b;
            }
            eatenAvgR /= eatenPixList.length;
            eatenAvgG /= eatenPixList.length;
            eatenAvgB /= eatenPixList.length;
            
            // Calculate distance
            const dist = perceptualDistance(avgR, avgG, avgB, eatenAvgR, eatenAvgG, eatenAvgB);
            if (dist < bestDistance) {
                bestDistance = dist;
                bestEatenBin = eatenBin;
            }
        }
        
        if (bestEatenBin !== null) {
            binMatches.set(targetBin, bestEatenBin);
        }
    }
    
    // Assign pixels: for each target pixel, find best matching eaten pixel from matched bin
    for (const target of targetPixels) {
        const targetBin = target.bin;
        const matchedEatenBin = binMatches.get(targetBin);
        
        if (matchedEatenBin !== undefined && eatenHistogram.has(matchedEatenBin)) {
            const candidateIndices = eatenHistogram.get(matchedEatenBin);
            
            // Find best unused pixel from this bin
            let bestPixel = null;
            let bestIndex = -1;
            let bestDistance = Infinity;
            
            for (const pixIdx of candidateIndices) {
                if (usedPixels.has(pixIdx)) continue;
                
                const pixel = eatenPixels[pixIdx];
                const dist = perceptualDistance(target.r, target.g, target.b, pixel.r, pixel.g, pixel.b);
                
                if (dist < bestDistance) {
                    bestDistance = dist;
                    bestPixel = pixel;
                    bestIndex = pixIdx;
                }
            }
            
            if (bestPixel && bestIndex >= 0) {
                resultImageData[target.idx + 0] = Math.round(bestPixel.r * 255);
                resultImageData[target.idx + 1] = Math.round(bestPixel.g * 255);
                resultImageData[target.idx + 2] = Math.round(bestPixel.b * 255);
                resultImageData[target.idx + 3] = 255;
                usedPixels.add(bestIndex);
            } else {
                // Fallback: use target color
                resultImageData[target.idx + 0] = targetImageData.data[target.idx + 0];
                resultImageData[target.idx + 1] = targetImageData.data[target.idx + 1];
                resultImageData[target.idx + 2] = targetImageData.data[target.idx + 2];
                resultImageData[target.idx + 3] = 255;
            }
            } else {
            // No match found, use target color
            resultImageData[target.idx + 0] = targetData[target.idx + 0];
            resultImageData[target.idx + 1] = targetData[target.idx + 1];
            resultImageData[target.idx + 2] = targetData[target.idx + 2];
            resultImageData[target.idx + 3] = 255;
        }
    }
    
    const endTime = performance.now();
    console.log(`[Worker] Histogram matching: ${(endTime - startTime).toFixed(2)}ms`);
    
    return resultImageData;
}

// Handle messages from main thread
self.onmessage = function(e) {
    const {eatenPixels, targetImageData, dims, id} = e.data;
    
    try {
        const result = performHistogramMatching(eatenPixels, targetImageData, dims);
        
        // Send result back to main thread
        self.postMessage({
            id,
            success: true,
            result,
            dims
        });
    } catch (error) {
        console.error('[Worker] Error in histogram matching:', error);
        self.postMessage({
            id,
            success: false,
            error: error.message
        });
    }
};
