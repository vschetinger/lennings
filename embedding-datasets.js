// Helper functions for registering datasets (layers) into the shared
// EmbeddingSpace instance. This is the bridge between concrete data
// formats (motif metadata, JSON tales, CSV exports from LM Studio, etc.)
// and the generic EmbeddingSpace class.

(function (global) {
  'use strict';

  function getSpace(explicitSpace) {
    if (explicitSpace) return explicitSpace;
    if (typeof global.getGlobalEmbeddingSpace === 'function') {
      return global.getGlobalEmbeddingSpace();
    }
    if (typeof global.EmbeddingSpace === 'function') {
      return new global.EmbeddingSpace();
    }
    throw new Error('EmbeddingSpace is not available');
  }

  /**
   * Build the \"motifs\" layer from LenningsGameEngine.motifMetadataById.
   * This keeps the raw motif metadata attached so callers can access
   * tarot / I Ching fields and other annotations.
   */
  function createMotifLayerFromGameEngine(gameEngine, space) {
    if (!gameEngine || !gameEngine.motifMetadataById) {
      return null;
    }
    var embeddingSpace = getSpace(space);
    var items = [];
    gameEngine.motifMetadataById.forEach(function (motif, id) {
      if (!motif || !motif.embedding) return;
      items.push({
        id: id,
        embedding: motif.embedding,
        label: motif.name || id,
        metadata: motif
      });
    });
    if (!items.length) return null;
    return embeddingSpace.addLayer('motifs', items, {
      dims: items[0].embedding.length,
      description: 'Glass Bead Game motifs with embeddings'
    });
  }

  /**
   * Load a JSON dataset of embedding items and register it as a layer.
   * Expected JSON shape (one element per item):
   *   {
   *     id: string,
   *     embedding: number[],
   *     title?: string,
   *     name?: string,
   *     ...any other metadata fields
   *   }
   */
  async function createJsonDatasetLayer(url, layerName, options, space) {
    var embeddingSpace = getSpace(space);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error('Failed to load embedding dataset from ' + url + ' (status ' + res.status + ')');
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error('Expected JSON array at ' + url);
    }
    const items = data.map(function (row, idx) {
      if (!row || !row.embedding) {
        return null;
      }
      const id = row.id != null ? String(row.id) : String(idx);
      const label = row.title || row.name || id;
      return {
        id: id,
        embedding: row.embedding,
        label: label,
        metadata: row
      };
    }).filter(Boolean);
    if (!items.length) {
      throw new Error('No valid embedding items found in ' + url);
    }
    const first = items[0];
    return embeddingSpace.addLayer(layerName, items, {
      dims: first.embedding.length,
      model: options && options.model,
      description: options && options.description
    });
  }

  /**
   * Placeholder for future CSV-based datasets (e.g. exports from
   * build_embeddings_with_LMStudio.py). The expected flow is:
   *   - Fetch the CSV
   *   - Parse rows into { id, embedding: number[], label?, ... }
   *   - Call embeddingSpace.addLayer(...)
   *
   * This is intentionally left unimplemented until we lock in the
   * exact CSV schema.
   */
  async function createCsvDatasetLayer(url, layerName, options, space) {
    console.warn('createCsvDatasetLayer is not implemented yet. Expected to load CSV from', url, 'and register layer', layerName);
    throw new Error('createCsvDatasetLayer not implemented');
  }

  /**
   * Load the AFT motifs dataset (produced by build_embeddings_with_LMStudio.py)
   * into the EmbeddingSpace as the 'aft_motifs' layer.
   * This dataset contains folk tale motifs with embeddings.
   */
  async function loadAftMotifsLayer(space) {
    try {
      return await createJsonDatasetLayer('datasets/aft_motifs.json', 'aft_motifs', {
        model: 'lmstudio-embedding',
        description: 'AFT folk tale motifs with embeddings (from build_embeddings_with_LMStudio.py)'
      }, space);
    } catch (e) {
      console.warn('[EmbeddingDatasets] Failed to load aft_motifs layer:', e);
      return null;
    }
  }

  // Export helpers to the global namespace
  global.createMotifLayerFromGameEngine = createMotifLayerFromGameEngine;
  global.createJsonDatasetLayer = createJsonDatasetLayer;
  global.createCsvDatasetLayer = createCsvDatasetLayer;
  global.loadAftMotifsLayer = loadAftMotifsLayer;

})(typeof window !== 'undefined' ? window : this);

