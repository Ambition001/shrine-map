'use strict';

/**
 * Manual mock for mapbox-gl (v3 incompatible with mapbox-gl-js-mock).
 *
 * Captures the 'load' callback and per-layer 'click' handlers so tests can
 * fire them programmatically via _triggerLoad() / _fireLayerClick().
 */

const state = {
  loadCallback: null,
  clickHandlers: {}, // { layerId: [handler, ...] }
};

const mapInstance = {
  on(event, layerOrHandler, handler) {
    if (typeof layerOrHandler === 'function') {
      // map.on('load', fn) — direct (no layer id)
      if (event === 'load') state.loadCallback = layerOrHandler;
    } else if (event === 'click' && typeof handler === 'function') {
      // map.on('click', 'layer-id', fn)
      if (!state.clickHandlers[layerOrHandler]) {
        state.clickHandlers[layerOrHandler] = [];
      }
      state.clickHandlers[layerOrHandler].push(handler);
    }
    // mouseenter / mouseleave and all other events: no-op
  },

  // ── Test helpers ──────────────────────────────────────────────────────────

  /** Fire the 'load' callback — registers click handlers and sets mapLoaded. */
  _triggerLoad() {
    if (state.loadCallback) state.loadCallback();
  },

  /** Fire a layer click with synthetic feature data. */
  _fireLayerClick(layerId, eventData) {
    (state.clickHandlers[layerId] || []).forEach(h => h(eventData));
  },

  /** Clear captured state between tests (called by remove() on unmount). */
  _reset() {
    state.loadCallback = null;
    state.clickHandlers = {};
  },

  // ── Stubs used by App.js ──────────────────────────────────────────────────
  addControl() {},
  addSource() {},
  addLayer() {},
  removeSource() {},
  getSource() { return null; },
  getLayer() { return null; },
  getCenter() { return { lng: 138.5, lat: 36.5 }; },
  getZoom() { return 5.5; },
  getCanvas() { return { style: {} }; },
  setLayoutProperty() {},
  flyTo() {},
  resize() {},
  remove() { this._reset(); },
};

function MockMap() { return mapInstance; }
function MockNavigationControl() {}

module.exports = {
  Map: MockMap,
  NavigationControl: MockNavigationControl,
  accessToken: null,
  /** Expose the singleton so tests can call _triggerLoad / _fireLayerClick. */
  _getMapInstance: () => mapInstance,
};
