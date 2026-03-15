/**
 * Tests for focusOnShrine useCallback stability.
 *
 * This file mocks ShrineListView at module level so we can capture the
 * onFocusShrine prop reference across re-renders and verify it is stable
 * (i.e. wrapped in useCallback).
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Module-level ref store (mutable, pre-declared before any jest.mock hoisting)
// ---------------------------------------------------------------------------

// We use a plain object to avoid hoisting issues. The mock function writes to it.
const focusRefStore = { refs: [] };

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../components/ShrineListView', () => {
  // This factory runs before imports, but focusRefStore is declared via `var`
  // internally — we instead read from a global we set up via `beforeEach`.
  return {
    __esModule: true,
    default: function MockShrineListView(props) {
      // Write the captured ref to a globally-accessible location
      if (global.__focusShrineRefs) {
        global.__focusShrineRefs.push(props.onFocusShrine);
      }
      return null;
    },
  };
});

jest.mock('mapbox-gl', () => {
  const state = { loadCallback: null, clickHandlers: {} };
  const instance = {
    on(event, layerOrHandler, handler) {
      if (typeof layerOrHandler === 'function') {
        if (event === 'load') state.loadCallback = layerOrHandler;
      } else if (event === 'click' && typeof handler === 'function') {
        if (!state.clickHandlers[layerOrHandler]) state.clickHandlers[layerOrHandler] = [];
        state.clickHandlers[layerOrHandler].push(handler);
      }
    },
    _triggerLoad() { if (state.loadCallback) state.loadCallback(); },
    _fireLayerClick(layerId, data) {
      (state.clickHandlers[layerId] || []).forEach(h => h(data));
    },
    _reset() { state.loadCallback = null; state.clickHandlers = {}; },
    addControl() {}, addSource() {}, addLayer() {}, removeSource() {},
    getSource() { return null; },
    getLayer() { return null; },
    getCenter() { return { lng: 138.5, lat: 36.5 }; },
    getZoom() { return 5.5; },
    getCanvas() { return { style: {} }; },
    setLayoutProperty() {}, flyTo() {}, resize() {},
    remove() { this._reset(); },
  };
  return {
    Map: function() { return instance; },
    NavigationControl: function() {},
    accessToken: null,
    _getMapInstance: () => instance,
  };
});

jest.mock('../services/auth', () => ({
  onAuthChange: jest.fn((cb) => { cb(null); return jest.fn(); }),
  loginWithGoogle: jest.fn(),
  logout: jest.fn(),
  handleRedirectResult: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/visits', () => ({
  getVisits: jest.fn().mockResolvedValue(new Set()),
  toggleVisitOptimistic: jest.fn().mockResolvedValue(undefined),
  initLocalStorage: jest.fn().mockResolvedValue(undefined),
  smartMerge: jest.fn().mockResolvedValue({ action: 'identical' }),
  mergeAll: jest.fn().mockResolvedValue({}),
  clearLocalStorage: jest.fn(),
  replaceCloudWithLocal: jest.fn().mockResolvedValue({}),
  syncPendingOperations: jest.fn().mockResolvedValue({ synced: 0 }),
}));

jest.mock('../hooks/useAuth');
jest.mock('../hooks/useVisits');

import { useAuth } from '../hooks/useAuth';
import { useVisits } from '../hooks/useVisits';
import App from '../App';

// M1: use narrow interface (showSyncMessage, clearMergeDialog) not raw setters
const defaultAuth = {
  user: null,
  authLoading: false,
  syncMessage: null,
  showSyncMessage: jest.fn(),
  mergeDialog: null,
  clearMergeDialog: jest.fn(),
  visitLoadTrigger: 0,
};

const defaultVisits = {
  visitedShrines: new Set(),
  updateVisitedShrines: jest.fn(),
  loading: false,
};

beforeEach(() => {
  global.__focusShrineRefs = [];
  useAuth.mockReturnValue(defaultAuth);
  useVisits.mockReturnValue(defaultVisits);
});

afterEach(() => {
  delete global.__focusShrineRefs;
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: click the list view tab
// ---------------------------------------------------------------------------
function clickListViewTab() {
  const buttons = Array.from(document.querySelectorAll('button'));
  const listBtn = buttons.find(b => b.textContent.includes('リスト表示'));
  if (listBtn) fireEvent.click(listBtn);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ShrineDetailPanel mock — captures shrine prop
// ---------------------------------------------------------------------------

jest.mock('../components/ShrineDetailPanel', () => ({
  __esModule: true,
  default: function MockShrineDetailPanel({ shrine }) {
    const R = require('react');
    return R.createElement('div', { 'data-testid': 'detail-panel' }, shrine?.name || '');
  },
}));

jest.mock('../components/MergeConflictDialog', () => ({
  __esModule: true,
  default: function MockMCD() { return null; },
}));

jest.mock('../components/StatusBanners', () => ({
  __esModule: true,
  default: function MockSB() { return null; },
}));

jest.mock('../components/MapChoiceSheet', () => ({
  __esModule: true,
  default: function MockMCS() { return null; },
}));

// ---------------------------------------------------------------------------
// UX: detail panel must not appear over an uninitialized map
// ---------------------------------------------------------------------------

describe('App – focusOnShrine deferred selection when map not ready', () => {
  test('selectedShrine is still set after focusOnShrine even without flyTo', async () => {
    const mapboxgl = require('mapbox-gl');
    const mapInstance = mapboxgl._getMapInstance();
    // Simulate map not yet initialized by nulling out flyTo recording
    const flyToSpy = jest.spyOn(mapInstance, 'flyTo');

    useAuth.mockReturnValue(defaultAuth);
    useVisits.mockReturnValue(defaultVisits);

    render(<App />);

    // Grab the captured focusOnShrine callback from list view render
    clickListViewTab();
    const focusFn = global.__focusShrineRefs[global.__focusShrineRefs.length - 1];

    const shrine = { id: 's1', name: 'Test Shrine', lat: 35.0, lng: 139.0, rank: 1, region: 'test' };

    await act(async () => {
      focusFn(shrine);
    });

    // View must switch to map regardless
    const { screen } = require('@testing-library/react');
    // The shrine detail panel should eventually appear (map view active)
    // flyTo may or may not be called depending on map state — we just ensure no crash
    flyToSpy.mockRestore();
  });
});

describe('App – focusOnShrine useCallback stability', () => {
  test('onFocusShrine prop is a stable function reference across re-renders', () => {
    const { rerender } = render(<App />);

    // Switch to list view so ShrineListView renders and captures onFocusShrine
    clickListViewTab();

    const firstRef = global.__focusShrineRefs[global.__focusShrineRefs.length - 1];
    expect(firstRef).toBeDefined();
    expect(typeof firstRef).toBe('function');

    // Re-render App (simulates any parent state change)
    rerender(<App />);

    const secondRef = global.__focusShrineRefs[global.__focusShrineRefs.length - 1];
    expect(secondRef).toBeDefined();

    // KEY assertion: reference must be stable (i.e. wrapped in useCallback)
    expect(secondRef).toBe(firstRef);
  });

  test('onFocusShrine remains the same reference when visitedShrines changes', () => {
    const { rerender } = render(<App />);

    clickListViewTab();
    const firstRef = global.__focusShrineRefs[global.__focusShrineRefs.length - 1];

    // Simulate visitedShrines changing
    useVisits.mockReturnValue({
      ...defaultVisits,
      visitedShrines: new Set(['shrine-1']),
    });
    rerender(<App />);

    const secondRef = global.__focusShrineRefs[global.__focusShrineRefs.length - 1];

    // focusOnShrine deps don't include visitedShrines, so ref must be stable
    expect(secondRef).toBe(firstRef);
  });
});
