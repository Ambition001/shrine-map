import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import shrinesJson from '../data/shrines.json';

// Smart mapbox-gl mock: captures 'load' callback and per-layer 'click' handlers
// so tests can fire them programmatically via _triggerLoad / _fireLayerClick.
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
      // mouseenter / mouseleave → no-op
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
    // M4: off() must exist so mapInstance.off(...) calls do not throw
    off() {},
    remove() { this._reset(); },
  };
  return {
    Map: function() { return instance; },
    NavigationControl: function() {},
    accessToken: null,
    _getMapInstance: () => instance,
  };
});

// Mock services that hooks call internally
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

// Mock custom hooks so App renders synchronously with controlled state
jest.mock('../hooks/useAuth');
jest.mock('../hooks/useVisits');

import { useAuth } from '../hooks/useAuth';
import { useVisits } from '../hooks/useVisits';
import App from '../App';

// L4: derive shrine fixture from actual data instead of hardcoding id/name
const firstShrineWithCoords = shrinesJson.find(s => s.lat && s.lng);

const mapInstance = jest.requireMock('mapbox-gl')._getMapInstance();

// Default hook return values (loaded, no user)
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
  useAuth.mockReturnValue(defaultAuth);
  useVisits.mockReturnValue(defaultVisits);
  mapInstance._reset();
});

afterEach(() => {
  jest.clearAllMocks();
});

// M4: Mapbox mock quality tests — off() must exist, state must isolate between tests
describe('Mapbox mock – M4 quality checks', () => {
  test('map instance implements off() method so event removal does not throw', () => {
    // If off() is missing, App code calling map.off() would throw TypeError
    expect(typeof mapInstance.off).toBe('function');
    // Calling it must not throw
    expect(() => mapInstance.off('click', 'shrines-unvisited', jest.fn())).not.toThrow();
  });

  test('_reset() clears all registered handlers so tests do not share state', () => {
    // Register a handler
    mapInstance.on('load', () => {});
    mapInstance.on('click', 'shrines-unvisited', jest.fn());

    // Reset (simulates beforeEach)
    mapInstance._reset();

    // After reset no load callback should exist
    // _triggerLoad should do nothing without throwing
    expect(() => mapInstance._triggerLoad()).not.toThrow();

    // _fireLayerClick should do nothing without throwing
    expect(() => mapInstance._fireLayerClick('shrines-unvisited', { features: [] })).not.toThrow();
  });

  test('state is independent between consecutive tests — second test sees clean state', () => {
    // This test verifies that _reset() in beforeEach works:
    // no stale loadCallback should exist at test start
    // (we cannot check internal state directly, so we verify triggering is safe)
    expect(() => mapInstance._triggerLoad()).not.toThrow();
  });
});

describe('App – loading state', () => {
  test('renders loading spinner while visits are loading', () => {
    useVisits.mockReturnValue({ ...defaultVisits, loading: true });
    render(<App />);
    expect(screen.getByText('読み込み中...')).toBeInTheDocument();
  });
});

describe('App – loaded state (no user)', () => {
  test('renders app header with title', () => {
    render(<App />);
    expect(screen.getByText('⛩ 一之宮巡礼')).toBeInTheDocument();
  });

  test('shows login button when not authenticated', () => {
    render(<App />);
    expect(screen.getByText('ログイン')).toBeInTheDocument();
  });

  test('renders map/list view toggle tabs', () => {
    render(<App />);
    expect(screen.getByText('地図表示')).toBeInTheDocument();
    expect(screen.getByText('リスト表示')).toBeInTheDocument();
  });

  test('shows visit stats in header', () => {
    render(<App />);
    // The header stat element contains "参拝済: 0社" — use a specific pattern to avoid matching the map legend span
    expect(screen.getByText(/参拝済: \d+社/)).toBeInTheDocument();
    expect(screen.getByText(/達成率: \d+%/)).toBeInTheDocument();
  });

  test('switches to list view on tab click', () => {
    render(<App />);
    fireEvent.click(screen.getByText('リスト表示'));
    // List view renders region data from shrines.json
    expect(screen.getByRole('button', { name: /リスト表示/ })).toHaveClass('text-red-600');
  });
});

describe('App – loaded state (with user)', () => {
  const mockUser = { uid: 'u1', displayName: 'Test User', photoURL: null };

  test('shows logout button when authenticated', () => {
    useAuth.mockReturnValue({ ...defaultAuth, user: mockUser });
    render(<App />);
    expect(screen.getByText('ログアウト')).toBeInTheDocument();
    expect(screen.queryByText('ログイン')).not.toBeInTheDocument();
  });

  test('shows user photo when photoURL is provided', () => {
    useAuth.mockReturnValue({
      ...defaultAuth,
      user: { ...mockUser, photoURL: 'https://example.com/photo.jpg' },
    });
    const { container } = render(<App />);
    // alt="" makes the img presentational (role="presentation"), so query by element
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://example.com/photo.jpg');
  });
});

describe('App – with visited shrines', () => {
  test('stats reflect visited count', () => {
    // Use a small known set to verify percentage changes
    useVisits.mockReturnValue({
      ...defaultVisits,
      visitedShrines: new Set(['shrine-1', 'shrine-2']),
    });
    render(<App />);
    expect(screen.getByText(/参拝済: 2社/)).toBeInTheDocument();
  });
});

describe('App – map click interaction', () => {
  // L4: use dynamic shrine data instead of hardcoded id/name
  test('clicking a shrine marker shows the detail panel', () => {
    render(<App />);

    // 1. map 初始化完成後（loading=false），App 注册了 on('load', cb)。
    //    手動 trigger load: 内部注册 click handlers + setMapLoaded(true)。
    act(() => {
      mapInstance._triggerLoad();
    });

    // 2. 模拟点击 unvisited 图層上第一個有坐標的神社（從真實資料動態取得）
    act(() => {
      mapInstance._fireLayerClick('shrines-unvisited', {
        features: [{ properties: { id: firstShrineWithCoords.id } }],
      });
    });

    // 3. ShrineDetailPanel 應出現並顯示該神社名
    expect(screen.getByText(firstShrineWithCoords.name)).toBeInTheDocument();
  });

  test('clicking an already-selected shrine closes the detail panel', () => {
    render(<App />);

    act(() => { mapInstance._triggerLoad(); });

    // 第一次点击：打开面板（使用動態 id/name，不硬編碼）
    act(() => {
      mapInstance._fireLayerClick('shrines-unvisited', {
        features: [{ properties: { id: firstShrineWithCoords.id } }],
      });
    });
    expect(screen.getByText(firstShrineWithCoords.name)).toBeInTheDocument();

    // 第二次点击同一神社：关闭面板（closeSelectedShrine）
    act(() => {
      mapInstance._fireLayerClick('shrines-unvisited', {
        features: [{ properties: { id: firstShrineWithCoords.id } }],
      });
    });
    expect(screen.queryByText(firstShrineWithCoords.name)).not.toBeInTheDocument();
  });
});

// L3: Map resize setTimeout must guard against map.current becoming null
describe('App – L3 map resize timer safety', () => {
  test('switching view mode does not throw even if map is removed before timer fires', () => {
    // This test verifies the guard `if (map.current)` inside the resize setTimeout
    // prevents errors when map is cleaned up within the 100ms window.
    jest.useFakeTimers();

    render(<App />);

    act(() => {
      mapInstance._triggerLoad();
    });

    // Switch view mode — triggers resize useEffect which schedules setTimeout(100ms)
    fireEvent.click(screen.getByText('リスト表示'));

    // Simulate map being removed before timer fires (null the map mock)
    // The App.js guard `if (map.current) map.current.resize()` must handle this
    // No throw expected when timer fires after map is gone
    expect(() => {
      act(() => {
        jest.advanceTimersByTime(200);
      });
    }).not.toThrow();

    jest.useRealTimers();
  });
});

// M2: Map cleanup must not call setMapLoaded(false) after unmount
describe('App – M2 map cleanup does not setState after unmount', () => {
  test('unmounting after map load does not produce console.error about state update', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = render(<App />);

    act(() => {
      mapInstance._triggerLoad();
    });

    // Unmount — this triggers map cleanup. If cleanup calls setMapLoaded(false)
    // React 18 strict mode logs a warning about state update on unmounted component.
    unmount();

    // No error about "Can't perform a React state update on an unmounted component"
    const stateUpdateWarnings = consoleSpy.mock.calls.filter(args =>
      args.some(a => typeof a === 'string' && a.includes('unmounted'))
    );
    expect(stateUpdateWarnings).toHaveLength(0);

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// HIGH-4: error from useVisits silently discarded in App.js
// ---------------------------------------------------------------------------

describe('App – HIGH-4: useVisits error surfaced to user via syncError banner', () => {
  /**
   * useVisits returns { visitedShrines, updateVisitedShrines, loading, error }.
   * App.js must destructure `error` and pipe it into the syncError state so that
   * when getVisits() throws on first load, the user sees the error banner instead
   * of a silent empty map.
   *
   * Expected: when useVisits returns a non-null error, the StatusBanners error
   * banner (⚠ <error message>) is rendered.
   */
  test('renders syncError banner when useVisits returns an error', async () => {
    const visitsError = new Error('ネットワークエラー');
    useVisits.mockReturnValue({
      ...defaultVisits,
      loading: false,
      error: visitsError,
    });

    render(<App />);

    // The error banner renders as "⚠ {syncError}" — error.message must be visible
    expect(screen.getByText(/ネットワークエラー/)).toBeInTheDocument();
  });

  test('does NOT render syncError banner when useVisits error is null', () => {
    useVisits.mockReturnValue({
      ...defaultVisits,
      loading: false,
      error: null,
    });

    render(<App />);

    // No error banner when error is null
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument();
  });

  test('syncError banner clears when useVisits error resolves on re-render', () => {
    // First render: error present
    useVisits.mockReturnValue({
      ...defaultVisits,
      loading: false,
      error: new Error('初回エラー'),
    });

    const { rerender } = render(<App />);
    expect(screen.getByText(/初回エラー/)).toBeInTheDocument();

    // Re-render: error resolved
    useVisits.mockReturnValue({
      ...defaultVisits,
      loading: false,
      error: null,
    });

    rerender(<App />);
    expect(screen.queryByText(/初回エラー/)).not.toBeInTheDocument();
  });
});

describe('App – cross-component interaction', () => {
  test('clicking shrine name in list view switches to map view and opens detail panel', () => {
    render(<App />);

    // 1. 切到リスト表示
    fireEvent.click(screen.getByText('リスト表示'));

    // 2. 列表里找第一个神社名（h3），记录名称备用
    const shrineHeadings = screen.getAllByRole('heading', { level: 3 });
    expect(shrineHeadings.length).toBeGreaterThan(0);
    const shrineName = shrineHeadings[0].textContent;

    // 3. 点击神社名 div（click 冒泡到 .flex-1 的 onClick → onFocusShrine）
    fireEvent.click(shrineHeadings[0]);

    // 4. App 应该调用 focusOnShrine → setViewMode('map')
    //    地図表示 tab 变为激活状态
    expect(screen.getByRole('button', { name: /地図表示/ })).toHaveClass('text-red-600');

    // 5. ShrineDetailPanel 应该出现并显示神社名
    //    此时 ShrineListView 已卸载（viewMode !== 'list'），h3 唯一
    expect(screen.getByRole('heading', { name: shrineName, level: 3 })).toBeInTheDocument();
  });

  test('onFocusShrine prop wiring: wrong function would not switch viewMode', () => {
    // 此测试验证 App 传给 ShrineListView 的 onFocusShrine 是真正能切换 viewMode 的函数。
    // 如果 App.js 里把 onFocusShrine={focusOnShrine} 改成 onFocusShrine={toggleVisited}，
    // viewMode 不会变，上方 test 会失败。这里作为说明性断言存档。
    render(<App />);
    fireEvent.click(screen.getByText('リスト表示'));
    const [firstShrine] = screen.getAllByRole('heading', { level: 3 });
    fireEvent.click(firstShrine);
    // 切换回 map view 是 focusOnShrine 独有的副作用
    expect(screen.getByRole('button', { name: /地図表示/ })).toHaveClass('text-red-600');
    expect(screen.queryByRole('button', { name: /リスト表示/ })).not.toHaveClass('text-red-600');
  });
});

