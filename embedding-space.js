// EmbeddingSpace - lightweight multi-layer embedding registry and search.
// Works entirely in the browser and is designed to be extended later
// (e.g. by plugging in a backend or approximate-NN index) without
// changing callers.

(function (global) {
  'use strict';

  /**
   * @typedef {Object} EmbeddingItem
   * @property {string} id
   * @property {number[]|Float32Array} embedding
   * @property {string=} label
   * @property {any=} metadata
   */

  /**
   * @typedef {Object} LayerOptions
   * @property {number=} dims           - Embedding dimensionality
   * @property {string=} model         - Optional model name / version
   * @property {string=} description   - Human-readable description
   */

  /**
   * @typedef {Object} Layer
   * @property {string} name
   * @property {EmbeddingItem[]} items
   * @property {Map<string, EmbeddingItem>} index
   * @property {LayerOptions} options
   */

  function cosineSimilarity(vecA, vecB) {
    if (!Array.isArray(vecA) && !(vecA instanceof Float32Array)) return null;
    if (!Array.isArray(vecB) && !(vecB instanceof Float32Array)) return null;
    var len = Math.min(vecA.length, vecB.length);
    if (!len) return null;
    var dot = 0;
    var normA = 0;
    var normB = 0;
    for (var i = 0; i < len; i++) {
      var a = vecA[i] || 0;
      var b = vecB[i] || 0;
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }
    if (!normA || !normB) return null;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  function EmbeddingSpace() {
    /** @type {Map<string, Layer>} */
    this.layers = new Map();
  }

  /**
   * Register a new layer of embedding-backed items.
   * @param {string} name
   * @param {EmbeddingItem[]} items
   * @param {LayerOptions=} options
   */
  EmbeddingSpace.prototype.addLayer = function (name, items, options) {
    if (!name) throw new Error('EmbeddingSpace.addLayer: name is required');
    if (!Array.isArray(items)) throw new Error('EmbeddingSpace.addLayer: items must be an array');
    var index = new Map();
    var dims = (options && options.dims) || (items[0] && items[0].embedding && items[0].embedding.length) || undefined;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.id || !it.embedding) continue;
      index.set(String(it.id), it);
    }
    /** @type {Layer} */
    var layer = {
      name: name,
      items: items,
      index: index,
      options: {
        dims: dims,
        model: options && options.model,
        description: options && options.description
      }
    };
    this.layers.set(name, layer);
    return layer;
  };

  EmbeddingSpace.prototype.hasLayer = function (name) {
    return this.layers.has(name);
  };

  EmbeddingSpace.prototype.getLayer = function (name) {
    return this.layers.get(name) || null;
  };

  EmbeddingSpace.prototype.getItem = function (layerName, id) {
    var layer = this.layers.get(layerName);
    if (!layer || !id) return null;
    return layer.index.get(String(id)) || null;
  };

  /**
   * Find k nearest items in a layer to a query vector using cosine similarity.
   * Returns an array of { item, score } sorted by descending score.
   */
  EmbeddingSpace.prototype.nearestToVector = function (layerName, vector, k, filterFn) {
    if (k === void 0) k = 1;
    var layer = this.layers.get(layerName);
    if (!layer || !vector) return [];
    var best = [];
    for (var i = 0; i < layer.items.length; i++) {
      var item = layer.items[i];
      if (!item.embedding) continue;
      if (filterFn && !filterFn(item)) continue;
      var score = cosineSimilarity(vector, item.embedding);
      if (score == null) continue;
      // Insert into best (simple k-small array since k is tiny)
      if (best.length < k) {
        best.push({ item: item, score: score });
      } else if (score > best[best.length - 1].score) {
        best[best.length - 1] = { item: item, score: score };
      }
      best.sort(function (a, b) { return b.score - a.score; });
    }
    return best;
  };

  /**
   * Find k nearest items in targetLayer to the embedding of sourceId in sourceLayer.
   * Returns an array of { item, score }.
   */
  EmbeddingSpace.prototype.nearestToItem = function (targetLayer, sourceLayer, sourceId, k, filterFn) {
    if (k === void 0) k = 1;
    var srcLayer = this.layers.get(sourceLayer);
    if (!srcLayer) return [];
    var sourceItem = srcLayer.index.get(String(sourceId));
    if (!sourceItem || !sourceItem.embedding) return [];
    return this.nearestToVector(targetLayer, sourceItem.embedding, k, filterFn);
  };

  // Simple global singleton so different parts of the app can share the same space.
  var globalKey = '__lenningsEmbeddingSpace';

  function getGlobalEmbeddingSpace() {
    if (!global[globalKey]) {
      global[globalKey] = new EmbeddingSpace();
    }
    return global[globalKey];
  }

  // Export to global namespace
  global.EmbeddingSpace = EmbeddingSpace;
  global.getGlobalEmbeddingSpace = getGlobalEmbeddingSpace;

})(typeof window !== 'undefined' ? window : this);

