import React, { useState, useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { List, Map, LogIn, LogOut, User } from 'lucide-react';
import shrineData from './data/shrines.json';
import { getVisits, toggleVisitOptimistic, initLocalStorage, smartMerge, mergeAll, clearLocalStorage, replaceCloudWithLocal, syncPendingOperations } from './services/visits';
import { onAuthChange, loginWithGoogle, logout, handleRedirectResult } from './services/auth';
import { generateGeoJSON, computeRegionStats, computeStats } from './utils/shrineUtils';
import MergeConflictDialog from './components/MergeConflictDialog';
import StatusBanners from './components/StatusBanners';
import ShrineDetailPanel from './components/ShrineDetailPanel';
import MapChoiceSheet from './components/MapChoiceSheet';
import ShrineListView from './components/ShrineListView';

// Mapbox token from environment variable
mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN;

const ShrineMapApp = () => {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const previousView = useRef(null); // 保存之前的地图视图
  const selectedShrineRef = useRef(null); // 用于事件处理中访问当前选中状态

  // 过滤有经纬度的神社用于地图显示
  const [shrines] = useState(shrineData.filter(s => s.lat && s.lng));
  const [visitedShrines, setVisitedShrines] = useState(new Set());
  const [selectedShrine, setSelectedShrine] = useState(null);
  const [viewMode, setViewMode] = useState('map');
  const [loading, setLoading] = useState(true);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [syncMessage, setSyncMessage] = useState(null); // 同步提示消息
  const [mergeDialog, setMergeDialog] = useState(null); // 合并确认对话框 { localCount, onMerge, onDiscard }
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight); // 真实视口高度
  const [showMapChoice, setShowMapChoice] = useState(false); // 地图选择菜单
  const [syncError, setSyncError] = useState(null);
  const [showLoginPrompt, setShowLoginPrompt] = useState(true); // 同步错误消息
  const [isOnline, setIsOnline] = useState(navigator.onLine); // 网络状态

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

  // 初始化 IndexedDB（应用启动时）
  useEffect(() => {
    const init = async () => {
      await initLocalStorage();
      // 触发一次后台同步，处理之前未完成的操作
      syncPendingOperations();
    };
    init();
  }, []);

  // 监听网络恢复，自动重试同步
  useEffect(() => {
    const handleOnline = () => syncPendingOperations();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  // 处理登录重定向结果 + 监听认证状态
  // 重要：必须先处理 redirect 结果，再设置 auth 监听器
  useEffect(() => {
    let previousUser = null;
    let authUnsubscribe = null;
    let isMounted = true;

    const initAuth = async () => {
      // 1. 先处理登录重定向结果（从 Google/Twitter 登录页面返回后）
      try {
        const redirectUser = await handleRedirectResult();
        if (redirectUser && isMounted) {
          setUser(redirectUser);
          // 这里不需要重复调用 smartMerge，因为下方的 onAuthChange 会捕捉到用户变化
        }
      } catch {
        // ignore redirect errors
      }

      // 2. 然后设置认证状态监听器
      if (!isMounted) return;

      authUnsubscribe = onAuthChange(async (currentUser) => {
        if (!isMounted) return;

        // 检测是否是新登录（之前没用户，现在有用户）
        const isNewLogin = !previousUser && currentUser;
        previousUser = currentUser;

        setUser(currentUser);
        setAuthLoading(false);

        // 用户刚登录时，使用智能合并
        if (isNewLogin) {
          const mergeResult = await smartMerge();
          switch (mergeResult.action) {
            case 'use_cloud': break;
            case 'use_local': break;
            case 'pending_synced':
              if (mergeResult.count > 0) {
                setSyncMessage(`${mergeResult.count}件の記録を同期しました`);
                setTimeout(() => setSyncMessage(null), 2000);
              }
              break;
            case 'partial_sync':
              setSyncMessage(`${mergeResult.count}件を同期しました（${mergeResult.failed}件失败）`);
              setTimeout(() => setSyncMessage(null), 3000);
              break;
            case 'uploaded_local':
              setSyncMessage(`${mergeResult.count}件の記録を同期しました`);
              setTimeout(() => setSyncMessage(null), 2000);
              break;
            case 'ask_user':
              setMergeDialog({
                type: 'conflict',
                onlyLocalCount: mergeResult.conflict.onlyLocal.length,
                onlyCloudCount: mergeResult.conflict.onlyCloud.length,
                commonCount: mergeResult.conflict.common.length,
                onlyCloud: mergeResult.conflict.onlyCloud
              });
              break;
            default: break;
          }

          // 重新加载数据
          const visits = await getVisits();
          setVisitedShrines(visits);
        }
      });
    };

    initAuth();

    return () => {
      isMounted = false;
      if (authUnsubscribe) {
        authUnsubscribe();
      }
    };
  }, []);

  // 加载参拜记录 - 在用户状态变化时重新加载
  useEffect(() => {
    const loadVisits = async () => {
      // 还在加载认证状态时等待
      if (authLoading) {
        return;
      }

      // 无论登录与否都加载记录（未登录用 localStorage，已登录用 API）
      try {
        const visits = await getVisits();
        setVisitedShrines(visits);
      } catch {
        // ignore load errors
      } finally {
        setLoading(false);
      }
    };
    loadVisits();
  }, [user, authLoading]);

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
        map.current.remove();
        map.current = null;
        setMapLoaded(false);
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
    if (map.current) {
      // 给予少量延迟以确保 DOM 布局已更新
      setTimeout(() => {
        map.current.resize();
      }, 100);
    }
  }, [showLoginPrompt, viewMode]);

  // 切换参拜状态（乐观更新：先更新 UI，再写入本地/同步云端）
  const toggleVisited = useCallback(async (shrineId) => {
    // 使用函数式更新避免 Race Condition
    setVisitedShrines(prev => {
      const newVisited = new Set(prev);
      if (newVisited.has(shrineId)) {
        newVisited.delete(shrineId);
      } else {
        newVisited.add(shrineId);
      }

      // 后台写入本地存储并同步云端（不阻塞 UI）
      toggleVisitOptimistic(shrineId, prev).catch(() => {
        // 显示错误提示
        if (!navigator.onLine) {
          setSyncError('オフラインです。オンラインになったら自動的に同期されます。');
        } else {
          setSyncError('同期に失敗しました。後で再試行されます。');
        }
        // 3秒后清除错误提示
        setTimeout(() => setSyncError(null), 3000);
      });

      return newVisited;
    });
  }, []);

  // 点击列表项时移动地图
  const focusOnShrine = (shrine) => {
    // 保存当前视图状态
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
    }
    setSelectedShrine(shrine);
    setViewMode('map');
  };

  // 登录处理（打开 Clerk 登录弹窗）
  const handleLogin = async () => {
    try {
      await loginWithGoogle(); // Opens Clerk sign-in modal
    } catch {
      // ignore login errors
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
      setVisitedShrines(new Set());
    } catch {
      // ignore logout errors
    }
  };

  // 合并所有数据（本地 + 云端）
  const handleMergeAll = async () => {
    const result = await mergeAll();
    setMergeDialog(null);
    if (result.merged) {
      setSyncMessage(`${result.count}件の記録を合併しました`);
      setTimeout(() => setSyncMessage(null), 3000);
      // 直接使用返回的合并数据，避免 Cosmos DB 一致性延迟
      setVisitedShrines(result.finalVisits);
    } else {
      // 合并失败时，重新从云端获取
      const visits = await getVisits();
      setVisitedShrines(visits);
    }
  };

  // 使用云端数据（丢弃本地）
  const handleUseCloud = async () => {
    await clearLocalStorage();
    setMergeDialog(null);
    setSyncMessage('クラウドの記録を使用します');
    setTimeout(() => setSyncMessage(null), 3000);
    // 重新加载云端数据
    const visits = await getVisits();
    setVisitedShrines(visits);
  };

  // 使用本地数据（完全覆盖云端：删除云端独有的，上传本地的）
  const handleUseLocal = async () => {
    const onlyCloudIds = mergeDialog?.onlyCloud || [];
    const result = await replaceCloudWithLocal(onlyCloudIds);
    setMergeDialog(null);
    if (result.replaced) {
      setSyncMessage(`ローカルを優先しました（${result.deleted}件削除、${result.uploaded}件アップロード）`);
      setTimeout(() => setSyncMessage(null), 3000);
      // 直接使用返回的本地数据，避免 Cosmos DB 一致性延迟
      setVisitedShrines(result.finalVisits);
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
              <span className="text-gray-600">未参拝</span>
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
