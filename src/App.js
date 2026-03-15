import React, { useState, useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { List, Map, LogIn, LogOut, User } from 'lucide-react';
import shrineData from './data/shrines.json';
import { toggleVisitOptimistic, mergeAll, clearLocalStorage, replaceCloudWithLocal, getVisits } from './services/visits';
import { loginWithGoogle, logout } from './services/auth';
import { generateGeoJSON, computeRegionStats, computeStats } from './utils/shrineUtils';
import MergeConflictDialog from './components/MergeConflictDialog';
import StatusBanners from './components/StatusBanners';
import ShrineDetailPanel from './components/ShrineDetailPanel';
import MapChoiceSheet from './components/MapChoiceSheet';
import ShrineListView from './components/ShrineListView';
import { useAuth } from './hooks/useAuth';
import { useVisits } from './hooks/useVisits';

// Mapbox token from environment variable
mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN;

const ShrineMapApp = () => {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const previousView = useRef(null); // 保存之前的地图视图
  const selectedShrineRef = useRef(null); // 用于事件处理中访问当前选中状态
  const isMounted = useRef(false); // track mount state for timer cleanup
  const errorTimersRef = useRef([]); // track error-display timer IDs for cleanup
  const pendingFocusRef = useRef(null); // shrine to focus once map initializes

  // 过滤有经纬度的神社用于地图显示
  const [shrines] = useState(shrineData.filter(s => s.lat && s.lng));
  const [selectedShrine, setSelectedShrine] = useState(null);
  const [viewMode, setViewMode] = useState('map');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight); // 真实视口高度
  const [showMapChoice, setShowMapChoice] = useState(false); // 地图选择菜单
  const [syncError, setSyncError] = useState(null);
  const [showLoginPrompt, setShowLoginPrompt] = useState(true); // 同步错误消息
  const [isOnline, setIsOnline] = useState(navigator.onLine); // 网络状态

  // M1: use narrow interface functions (showSyncMessage, clearMergeDialog) instead of raw setters
  const { user, authLoading, syncMessage, showSyncMessage, mergeDialog, clearMergeDialog, visitLoadTrigger } = useAuth();
  const { visitedShrines, updateVisitedShrines, loading, error: visitsError } = useVisits(user, authLoading, visitLoadTrigger);

  // HIGH-4: surface useVisits load errors via the existing syncError state so the
  // error banner shows when getVisits() throws on first load.
  // When visitsError resolves to null (retry succeeded), clear the banner.
  useEffect(() => {
    if (visitsError) {
      setSyncError(visitsError.message || String(visitsError));
    } else {
      setSyncError(null);
    }
  }, [visitsError]);

  // Track mount state so async callbacks can skip setState after unmount.
  // React Strict Mode runs effects twice (mount→unmount→mount), so the effect
  // body re-setting true is the correct guard; useRef(false) is the initial value.
  useEffect(() => {
    isMounted.current = true;
    const timers = errorTimersRef.current;
    return () => {
      isMounted.current = false;
      timers.forEach(clearTimeout);
    };
  }, []);

  // Schedule a 3-second auto-clear of syncError, tracking the timer for cleanup
  const scheduleErrorClear = useCallback((delayMs = 3000) => {
    const timerId = setTimeout(() => {
      if (isMounted.current) setSyncError(null);
    }, delayMs);
    errorTimersRef.current.push(timerId);
  }, []);

  // 监听视口高度变化（处理移动端地址栏）
  useEffect(() => {
    const updateViewportHeight = () => {
      // 使用 visualViewport（如果可用）获取真实可见高度
      const height = window.visualViewport?.height || window.innerHeight;
      setViewportHeight(height);
    };

    // 初始设置
    updateViewportHeight();

    // 监听 visualViewport 变化
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateViewportHeight);
      window.visualViewport.addEventListener('scroll', updateViewportHeight);
    }
    // fallback: 监听 window resize
    window.addEventListener('resize', updateViewportHeight);

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateViewportHeight);
        window.visualViewport.removeEventListener('scroll', updateViewportHeight);
      }
      window.removeEventListener('resize', updateViewportHeight);
    };
  }, []);

  // 监听网络状态变化
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setSyncError(null);
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);


  // 生成 GeoJSON 数据
  const buildGeoJSON = useCallback(
    (visited) => generateGeoJSON(shrines, visited),
    [shrines]
  );


  // 关闭弹窗（保持当前地图位置）
  const closeSelectedShrine = useCallback(() => {
    setSelectedShrine(null);
    selectedShrineRef.current = null;
    previousView.current = null;
  }, []);

  // 初始化地图 - 只在 loading 完成后执行一次
  useEffect(() => {
    if (loading || !mapContainer.current || map.current) return;

    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [138.5, 36.5],
      zoom: 5.5,
      language: 'ja'
    });

    mapInstance.addControl(new mapboxgl.NavigationControl(), 'top-left');

    mapInstance.on('load', () => {
      // 设置地图语言为日语 - 逐个检查图层是否存在
      const labelLayers = ['country-label', 'state-label', 'settlement-label', 'settlement-subdivision-label'];
      labelLayers.forEach(layerId => {
        if (mapInstance.getLayer(layerId)) {
          try {
            mapInstance.setLayoutProperty(layerId, 'text-field', ['get', 'name_ja']);
          } catch (e) {
            // 忽略单个图层的错误
          }
        }
      });

      // 添加神社数据源（初始为空，后续通过另一个 useEffect 更新）
      mapInstance.addSource('shrines', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // 添加未参拜的神社图层（红色）- 根据缩放级别调整大小
      mapInstance.addLayer({
        id: 'shrines-unvisited',
        type: 'circle',
        source: 'shrines',
        filter: ['==', ['get', 'visited'], false],
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            5, 6,    // 缩放级别5时，半径6
            8, 8,    // 缩放级别8时，半径8
            12, 10   // 缩放级别12时，半径10
          ],
          'circle-color': '#ef4444',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9
        }
      });

      // 添加已参拜的神社图层（绿色）
      mapInstance.addLayer({
        id: 'shrines-visited',
        type: 'circle',
        source: 'shrines',
        filter: ['==', ['get', 'visited'], true],
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            5, 6,
            8, 8,
            12, 10
          ],
          'circle-color': '#22c55e',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9
        }
      });

      setMapLoaded(true);
    });

    // 点击事件处理函数
    const handleShrineClick = (e) => {
      const feature = e.features[0];
      const shrine = shrines.find(s => s.id === feature.properties.id);
      if (!shrine) return;

      // 如果点击的是已选中的神社，关闭弹窗
      if (selectedShrineRef.current?.id === shrine.id) {
        closeSelectedShrine();
        return;
      }

      // 保存当前视图状态（仅在未选中状态时）
      if (!selectedShrineRef.current) {
        previousView.current = {
          center: mapInstance.getCenter(),
          zoom: mapInstance.getZoom()
        };
      }
      setSelectedShrine(shrine);
      selectedShrineRef.current = shrine;
      mapInstance.flyTo({
        center: [shrine.lng, shrine.lat],
        zoom: 10,
        duration: 1000
      });
    };

    mapInstance.on('click', 'shrines-unvisited', handleShrineClick);
    mapInstance.on('click', 'shrines-visited', handleShrineClick);

    // 鼠标样式
    mapInstance.on('mouseenter', 'shrines-unvisited', () => {
      mapInstance.getCanvas().style.cursor = 'pointer';
    });
    mapInstance.on('mouseleave', 'shrines-unvisited', () => {
      mapInstance.getCanvas().style.cursor = '';
    });
    mapInstance.on('mouseenter', 'shrines-visited', () => {
      mapInstance.getCanvas().style.cursor = 'pointer';
    });
    mapInstance.on('mouseleave', 'shrines-visited', () => {
      mapInstance.getCanvas().style.cursor = '';
    });

    map.current = mapInstance;

    return () => {
      if (map.current) {
        // M2: Do NOT call setMapLoaded(false) here — component is unmounting,
        // calling setState after unmount causes React 18 strict-mode warnings.
        map.current.remove();
        map.current = null;
      }
    };
  }, [loading, shrines, closeSelectedShrine]); // 移除 visitedShrines 依赖

  // 更新神社数据
  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    const source = map.current.getSource('shrines');
    if (source) {
      source.setData(buildGeoJSON(visitedShrines));
    }
  }, [mapLoaded, visitedShrines, buildGeoJSON]);

  // 当UI布局变化（如关闭登录提示）时，调整地图大小
  useEffect(() => {
    if (!map.current) return;
    // 给予少量延迟以确保 DOM 布局已更新
    const resizeTimer = setTimeout(() => {
      if (map.current) map.current.resize();
    }, 100);
    return () => clearTimeout(resizeTimer);
  }, [showLoginPrompt, viewMode]);

  // 切换参拜状态（乐观更新：先更新 UI，再写入本地/同步云端）
  const toggleVisited = useCallback(async (shrineId) => {
    // 使用函数式更新避免 Race Condition
    updateVisitedShrines(prev => {
      const newVisited = new Set(prev);
      if (newVisited.has(shrineId)) {
        newVisited.delete(shrineId);
      } else {
        newVisited.add(shrineId);
      }

      // 后台写入本地存储并同步云端（不阻塞 UI）
      toggleVisitOptimistic(shrineId, prev).catch(() => {
        if (!isMounted.current) return;
        // 显示错误提示
        if (!navigator.onLine) {
          setSyncError('オフラインです。オンラインになったら自動的に同期されます。');
        } else {
          setSyncError('同期に失敗しました。後で再試行されます。');
        }
        scheduleErrorClear(3000);
      });

      return newVisited;
    });
  }, [scheduleErrorClear, updateVisitedShrines]);

  // 点击列表项时移动地图
  const focusOnShrine = useCallback((shrine) => {
    setViewMode('map');
    if (map.current) {
      previousView.current = {
        center: map.current.getCenter(),
        zoom: map.current.getZoom()
      };
      map.current.flyTo({
        center: [shrine.lng, shrine.lat],
        zoom: 10,
        duration: 1000
      });
      setSelectedShrine(shrine);
    } else {
      // Map not initialized yet: defer flyTo + selection until map loads
      pendingFocusRef.current = shrine;
    }
  }, []);

  // Execute deferred focus once map becomes ready
  useEffect(() => {
    if (!mapLoaded || !map.current || !pendingFocusRef.current) return;
    const shrine = pendingFocusRef.current;
    pendingFocusRef.current = null;
    previousView.current = {
      center: map.current.getCenter(),
      zoom: map.current.getZoom()
    };
    map.current.flyTo({ center: [shrine.lng, shrine.lat], zoom: 10, duration: 1000 });
    setSelectedShrine(shrine);
  }, [mapLoaded]);

  // 登录处理（打开 Google 登录弹窗）
  const handleLogin = async () => {
    try {
      await loginWithGoogle();
    } catch {
      if (!isMounted.current) return;
      setSyncError('ログインに失敗しました。もう一度お試しください。');
      scheduleErrorClear(3000);
    }
  };

  // 登出处理
  const handleLogout = async () => {
    try {
      // 清空所有本地数据（包括 visits 表和待同步队列）
      // 确保登出后不会残留任何该账户的数据
      await clearLocalStorage();
      await logout();
      // 清空内存中的状态
      updateVisitedShrines(new Set());
    } catch {
      if (!isMounted.current) return;
      setSyncError('ログアウトに失敗しました。もう一度お試しください。');
      scheduleErrorClear(3000);
    }
  };

  // 合并所有数据（本地 + 云端）
  const handleMergeAll = async () => {
    try {
      const result = await mergeAll();
      if (!isMounted.current) return;
      clearMergeDialog();
      if (result.merged) {
        showSyncMessage(`${result.count}件の記録を合併しました`, 3000);
        // 直接使用返回的合并数据，避免 Cosmos DB 一致性延迟
        updateVisitedShrines(result.finalVisits);
      } else {
        // 合并失败时，重新从云端获取
        const visits = await getVisits();
        if (isMounted.current) updateVisitedShrines(visits);
      }
    } catch {
      if (!isMounted.current) return;
      setSyncError('合併に失敗しました。後で再試行してください。');
      scheduleErrorClear(3000);
    }
  };

  // 使用云端数据（丢弃本地）
  const handleUseCloud = async () => {
    try {
      await clearLocalStorage();
      if (!isMounted.current) return;
      clearMergeDialog();
      showSyncMessage('クラウドの記録を使用します', 3000);
      // 重新加载云端数据
      const visits = await getVisits();
      if (isMounted.current) updateVisitedShrines(visits);
    } catch {
      if (!isMounted.current) return;
      setSyncError('クラウドデータの取得に失敗しました。後で再試行してください。');
      scheduleErrorClear(3000);
    }
  };

  // 使用本地数据（完全覆盖云端：删除云端独有的，上传本地的）
  const handleUseLocal = async () => {
    try {
      const onlyCloudIds = mergeDialog?.onlyCloud || [];
      const result = await replaceCloudWithLocal(onlyCloudIds);
      if (!isMounted.current) return;
      clearMergeDialog();
      if (result.replaced) {
        showSyncMessage(`ローカルを優先しました（${result.deleted}件削除、${result.uploaded}件アップロード）`, 3000);
        // 直接使用返回的本地数据，避免 Cosmos DB 一致性延迟
        updateVisitedShrines(result.finalVisits);
      } else {
        // replaced=false: reload from server to keep UI consistent
        const visits = await getVisits();
        if (isMounted.current) updateVisitedShrines(visits);
      }
    } catch {
      if (!isMounted.current) return;
      setSyncError('ローカルデータの同期に失敗しました。後で再試行してください。');
      scheduleErrorClear(3000);
    }
  };

  const stats = computeStats(shrines, visitedShrines);
  const regionStats = computeRegionStats(shrines, visitedShrines);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-gray-600">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-gray-50" style={{ height: viewportHeight }}>
      <MergeConflictDialog
        dialog={mergeDialog}
        onMergeAll={handleMergeAll}
        onUseCloud={handleUseCloud}
        onUseLocal={handleUseLocal}
      />

      <StatusBanners
        syncMessage={syncMessage}
        user={user}
        authLoading={authLoading}
        showLoginPrompt={showLoginPrompt}
        onDismissLoginPrompt={() => setShowLoginPrompt(false)}
        syncError={syncError}
        isOnline={isOnline}
      />

      {/* 头部 */}
      <div className="bg-gradient-to-r from-red-600 to-red-700 text-white p-4 shadow-lg">
        <div className="flex justify-between items-start mb-2">
          <h1 className="text-2xl font-bold">⛩ 一之宮巡礼</h1>
          {/* 用户登录区域 */}
          {authLoading ? null : user ? (
            <div className="flex items-center gap-2">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full" />
              ) : (
                <User size={20} />
              )}
              <button
                onClick={handleLogout}
                className="text-xs bg-red-800 hover:bg-red-900 px-2 py-1 rounded flex items-center gap-1"
              >
                <LogOut size={14} />
                ログアウト
              </button>
            </div>
          ) : (
            <button
              onClick={handleLogin}
              className="text-sm bg-white text-red-600 hover:bg-gray-100 px-3 py-1.5 rounded-lg flex items-center gap-2 font-medium"
            >
              <LogIn size={16} />
              ログイン
            </button>
          )}
        </div>
        <div className="flex gap-4 text-sm">
          <div>全{stats.total}社</div>
          <div>参拝済: {stats.visited}社</div>
          <div>達成率: {stats.percentage}%</div>
        </div>
        <div className="w-full bg-red-900 rounded-full h-2 mt-2">
          <div
            className="bg-yellow-400 h-2 rounded-full transition-all duration-500"
            style={{ width: `${stats.percentage}%` }}
          />
        </div>
      </div>

      {/* 视图切换 */}
      <div className="flex border-b bg-white">
        <button
          onClick={() => setViewMode('map')}
          className={`flex-1 py-3 flex items-center justify-center gap-2 ${viewMode === 'map'
            ? 'bg-red-50 text-red-600 border-b-2 border-red-600'
            : 'text-gray-600'
            }`}
        >
          <Map size={18} />
          地図表示
        </button>
        <button
          onClick={() => setViewMode('list')}
          className={`flex-1 py-3 flex items-center justify-center gap-2 ${viewMode === 'list'
            ? 'bg-red-50 text-red-600 border-b-2 border-red-600'
            : 'text-gray-600'
            }`}
        >
          <List size={18} />
          リスト表示
        </button>
      </div>

      {/* 主要内容 */}
      <div className="flex-1 overflow-hidden relative">
        {/* 地图容器 */}
        <div
          ref={mapContainer}
          className="absolute inset-0"
          style={{
            visibility: viewMode === 'map' ? 'visible' : 'hidden',
            width: '100%',
            height: '100%'
          }}
        />

        {/* 地图图例 - 紧凑半透明样式 */}
        {viewMode === 'map' && (
          <div className="absolute top-2 right-2 bg-white/80 backdrop-blur-sm rounded-lg shadow-sm px-2 py-1.5 text-xs z-10 flex items-center gap-3">
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
              <span className="text-gray-600">未参拜</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
              <span className="text-gray-600">参拝済</span>
            </div>
          </div>
        )}

        {viewMode === 'map' && selectedShrine && (
          <ShrineDetailPanel
            shrine={selectedShrine}
            isVisited={visitedShrines.has(selectedShrine.id)}
            onToggle={toggleVisited}
            onClose={closeSelectedShrine}
            onMapChoice={() => setShowMapChoice(true)}
          />
        )}

        {showMapChoice && selectedShrine && (
          <MapChoiceSheet
            shrine={selectedShrine}
            onClose={() => setShowMapChoice(false)}
          />
        )}

        {viewMode === 'list' && (
          <ShrineListView
            regionStats={regionStats}
            visitedShrines={visitedShrines}
            onToggleVisit={toggleVisited}
            onFocusShrine={focusOnShrine}
          />
        )}
      </div>

    </div>
  );
};

export default ShrineMapApp;
