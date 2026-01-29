import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useClerk, useUser, useAuth } from '@clerk/clerk-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapPin, Check, X, List, Map, LogIn, LogOut, User, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import shrineData from './data/shrines.json';
import { getVisits, toggleVisitOptimistic, initLocalStorage, smartMerge, mergeAll, clearLocalStorage, replaceCloudWithLocal, syncPendingOperations } from './services/visits';
import { onAuthChange, loginWithGoogle, logout as clerkLogout, handleRedirectResult, _setClerkInstance, _notifyAuthChange, _setGetToken } from './services/auth';

// ClerkBridge: Connects Clerk hooks to auth.js module
function ClerkBridge() {
  const clerk = useClerk();
  const { user, isLoaded } = useUser();
  const { getToken } = useAuth();

  useEffect(() => {
    _setClerkInstance(clerk);
  }, [clerk]);

  useEffect(() => {
    // Pass getToken function to auth.js
    _setGetToken(getToken);
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    if (user) {
      _notifyAuthChange({
        id: user.id,
        name: user.fullName || user.firstName || 'User',
        email: user.primaryEmailAddress?.emailAddress,
        photoURL: user.imageUrl
      }, true);
    } else {
      _notifyAuthChange(null, true);
    }
  }, [user, isLoaded]);

  return null;
}

// Mapbox token from environment variable
mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN;

// 默认全图视图（日本全境）
const DEFAULT_VIEW = {
  center: [138.5, 36.5],
  zoom: 5.5
};

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
  const [collapsedRegions, setCollapsedRegions] = useState(new Set()); // 折叠的区域
  const [collapsedPrefectures, setCollapsedPrefectures] = useState(new Set()); // 折叠的县
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
  const generateGeoJSON = useCallback((visited) => {
    return {
      type: 'FeatureCollection',
      features: shrines.map(shrine => ({
        type: 'Feature',
        properties: {
          id: shrine.id,
          name: shrine.name,
          prefecture: shrine.prefecture,
          province: shrine.province,
          visited: visited.has(shrine.id)
        },
        geometry: {
          type: 'Point',
          coordinates: [shrine.lng, shrine.lat]
        }
      }))
    };
  }, [shrines]);

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

  // 关闭弹窗并回到日本全图
  const closeSelectedShrine = useCallback(() => {
    setSelectedShrine(null);
    selectedShrineRef.current = null;
    // 回到日本全图，而不是上次位置
    if (map.current) {
      map.current.flyTo({
        center: DEFAULT_VIEW.center,
        zoom: DEFAULT_VIEW.zoom,
        duration: 800
      });
    }
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
      source.setData(generateGeoJSON(visitedShrines));
    }
  }, [mapLoaded, visitedShrines, generateGeoJSON]);

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
      await clerkLogout();
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

  const stats = {
    total: shrines.length,
    visited: visitedShrines.size,
    percentage: Math.round((visitedShrines.size / shrines.length) * 100)
  };

  // 按地区和县分组神社（三层结构：region → prefecture → shrines[]）
  const shrinesByRegionAndPrefecture = shrines.reduce((acc, shrine) => {
    const region = shrine.region || '不明';
    const prefecture = shrine.prefecture || '不明';
    if (!acc[region]) {
      acc[region] = {};
    }
    if (!acc[region][prefecture]) {
      acc[region][prefecture] = [];
    }
    acc[region][prefecture].push(shrine);
    return acc;
  }, {});

  // 地区排序顺序
  const regionOrder = ['北海道・東北', '関東', '甲信越', '東海', '近畿', '中国', '四国', '九州・沖縄'];

  // 按顺序获取地区列表
  const sortedRegions = regionOrder.filter(r => shrinesByRegionAndPrefecture[r]);

  // 计算每个地区的统计（包含县级数据）
  const regionStats = sortedRegions.map(region => {
    const prefectures = shrinesByRegionAndPrefecture[region];
    const prefectureList = Object.keys(prefectures).sort(); // 县按字母顺序排序

    // 计算区域总数
    let regionTotal = 0;
    let regionVisited = 0;

    const prefectureStats = prefectureList.map(prefecture => {
      const shrineList = prefectures[prefecture];
      const visitedCount = shrineList.filter(s => visitedShrines.has(s.id)).length;
      regionTotal += shrineList.length;
      regionVisited += visitedCount;
      return {
        prefecture,
        shrines: shrineList,
        total: shrineList.length,
        visited: visitedCount
      };
    });

    return {
      region,
      total: regionTotal,
      visited: regionVisited,
      percentage: Math.round((regionVisited / regionTotal) * 100),
      prefectures: prefectureStats
    };
  });

  if (loading) {
    return (
      <>
        <ClerkBridge />
        <div className="flex items-center justify-center h-screen bg-gray-50">
          <div className="text-gray-600">読み込み中...</div>
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col bg-gray-50" style={{ height: viewportHeight }}>
      {/* 合并确认对话框（只在真正冲突时显示） */}
      {mergeDialog && mergeDialog.type === 'conflict' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-3">
              データの競合が見つかりました
            </h3>
            <div className="text-sm text-gray-600 mb-4 space-y-1 bg-gray-50 rounded-lg p-3">
              <p>・このデバイスのみ: <span className="font-medium text-gray-900">{mergeDialog.onlyLocalCount}件</span></p>
              <p>・クラウドのみ: <span className="font-medium text-gray-900">{mergeDialog.onlyCloudCount}件</span></p>
              <p>・両方に存在: <span className="font-medium text-gray-900">{mergeDialog.commonCount}件</span></p>
            </div>
            <div className="space-y-3">
              {/* 推奨：すべて合併 */}
              <button
                onClick={handleMergeAll}
                className="w-full py-3 px-4 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
              >
                <div className="font-medium">すべて合併する（推奨）</div>
                <div className="text-xs text-green-100 mt-0.5">
                  合計 {mergeDialog.onlyLocalCount + mergeDialog.onlyCloudCount + mergeDialog.commonCount}件になります
                </div>
              </button>

              {/* クラウドのみ使用 */}
              <button
                onClick={handleUseCloud}
                className="w-full py-3 px-4 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-left"
              >
                <div className="font-medium">クラウドのみ使用</div>
                <div className="text-xs text-red-500 mt-0.5">
                  このデバイスの {mergeDialog.onlyLocalCount}件 は削除されます
                </div>
              </button>

              {/* ローカルのみ使用 */}
              <button
                onClick={handleUseLocal}
                className="w-full py-3 px-4 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-left"
              >
                <div className="font-medium">このデバイスのみ使用</div>
                <div className="text-xs text-red-500 mt-0.5">
                  クラウドの {mergeDialog.onlyCloudCount}件 は削除されます
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 同步成功提示 */}
      {syncMessage && (
        <div className="bg-green-500 text-white px-4 py-2 text-sm text-center">
          ✓ {syncMessage}
        </div>
      )}

      {/* 未登录提示 - 可关闭 */}
      {!user && !authLoading && showLoginPrompt && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-sm text-yellow-800 text-center relative">
          <span>ログインすると記録をクラウドに保存できます</span>
          <button
            onClick={() => setShowLoginPrompt(false)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-yellow-600 hover:text-yellow-800 p-1"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* 同步错误提示 */}
      {syncError && (
        <div className="bg-red-500 text-white px-4 py-2 text-sm text-center">
          ⚠ {syncError}
        </div>
      )}

      {/* 离线状态提示 */}
      {!isOnline && (
        <div className="bg-orange-500 text-white px-4 py-2 text-sm text-center">
          オフラインモード - データは後で同期されます
        </div>
      )}

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

        {/* 选中的神社信息 */}
        {viewMode === 'map' && selectedShrine && (
          <div className="absolute bottom-4 left-4 right-4 bg-white rounded-lg shadow-xl p-4 z-10">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900">{selectedShrine.name}</h3>
                <p className="text-xs text-gray-500">{selectedShrine.reading}</p>
                <p className="text-sm text-gray-600">{selectedShrine.province} ・ {selectedShrine.prefecture}</p>
              </div>
              <button
                onClick={closeSelectedShrine}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => toggleVisited(selectedShrine.id)}
                className={`flex-1 py-2 rounded-lg font-medium transition-colors ${visitedShrines.has(selectedShrine.id)
                  ? 'bg-green-500 text-white hover:bg-green-600'
                  : 'bg-red-500 text-white hover:bg-red-600'
                  }`}
              >
                {visitedShrines.has(selectedShrine.id) ? (
                  <span className="flex items-center justify-center gap-2">
                    <Check size={18} /> 参拝済み
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <MapPin size={18} /> 参拝済みとしてマーク
                  </span>
                )}
              </button>
              <button
                onClick={() => setShowMapChoice(true)}
                className="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors flex items-center gap-2 font-medium"
              >
                <ExternalLink size={18} />
                地図
              </button>
            </div>
          </div>
        )}

        {/* 地图选择 Action Sheet */}
        {showMapChoice && selectedShrine && (
          <>
            {/* 遮罩 */}
            <div
              className="fixed inset-0 bg-black bg-opacity-50 z-40"
              onClick={() => setShowMapChoice(false)}
            />
            {/* 底部面板 */}
            <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl z-50 p-4 pb-8 animate-slide-up">
              <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
              <p className="text-center text-gray-600 mb-4">地図アプリを選択</p>
              <div className="space-y-2">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${selectedShrine.lat},${selectedShrine.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 rounded-lg text-center font-medium transition-colors"
                  onClick={() => setShowMapChoice(false)}
                >
                  Google Maps
                </a>
                <a
                  href={`https://maps.apple.com/?ll=${selectedShrine.lat},${selectedShrine.lng}&q=${encodeURIComponent(selectedShrine.name)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 rounded-lg text-center font-medium transition-colors"
                  onClick={() => setShowMapChoice(false)}
                >
                  Apple Maps
                </a>
              </div>
              <button
                onClick={() => setShowMapChoice(false)}
                className="w-full mt-4 py-3 text-blue-500 font-medium"
              >
                キャンセル
              </button>
            </div>
          </>
        )}

        {/* 列表视图 - 三层结构：区域 → 县 → 神社 */}
        {viewMode === 'list' && (
          <div className="absolute inset-0 overflow-auto p-4 space-y-4 bg-gray-50">
            {regionStats.map(({ region, total, visited, percentage, prefectures }) => {
              const isRegionCollapsed = collapsedRegions.has(region);
              const toggleRegionCollapse = () => {
                setCollapsedRegions(prev => {
                  const next = new Set(prev);
                  if (next.has(region)) {
                    next.delete(region);
                  } else {
                    next.add(region);
                  }
                  return next;
                });
                // 展开区域时，清空该区域下所有县的折叠状态（保持县展开）
                if (isRegionCollapsed) {
                  setCollapsedPrefectures(prev => {
                    const updated = new Set(prev);
                    prefectures.forEach(p => updated.delete(`${region}-${p.prefecture}`));
                    return updated;
                  });
                }
              };

              return (
                <div key={region}>
                  {/* 区域标题 - 可点击折叠 */}
                  <div
                    className="bg-gradient-to-r from-red-600 to-red-700 text-white rounded-lg p-3 mb-3 shadow cursor-pointer"
                    onClick={toggleRegionCollapse}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <div className="flex items-center gap-2">
                        {isRegionCollapsed ? <ChevronRight size={20} /> : <ChevronDown size={20} />}
                        <h2 className="text-lg font-bold">{region}</h2>
                      </div>
                      <div className="text-sm">
                        {visited}/{total}社 ({percentage}%)
                      </div>
                    </div>
                    <div className="w-full bg-red-900 rounded-full h-1.5">
                      <div
                        className="bg-yellow-400 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>

                  {/* 该区域下的县列表 - 区域未折叠时才显示 */}
                  {!isRegionCollapsed && (
                    <div className="space-y-3 ml-2">
                      {prefectures.map(({ prefecture, shrines: prefectureShrines, total, visited }) => {
                        const isCollapsed = collapsedPrefectures.has(`${region}-${prefecture}`);
                        const toggleCollapse = () => {
                          const key = `${region}-${prefecture}`;
                          setCollapsedPrefectures(prev => {
                            const next = new Set(prev);
                            if (next.has(key)) {
                              next.delete(key);
                            } else {
                              next.add(key);
                            }
                            return next;
                          });
                        };

                        return (
                          <div key={prefecture}>
                            {/* 县标题 - 可点击折叠 */}
                            <div
                              className="flex items-center gap-1 text-sm font-semibold text-gray-700 mb-2 pl-1 border-l-2 border-red-400 cursor-pointer hover:text-gray-900"
                              onClick={toggleCollapse}
                            >
                              {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                              <span>{prefecture}</span>
                              <span className="text-gray-500 font-normal">({visited}/{total})</span>
                            </div>

                            {/* 该县下的神社列表 - 可折叠 */}
                            {!isCollapsed && (
                              <div className="space-y-2">
                                {prefectureShrines.map(shrine => {
                                  const isVisited = visitedShrines.has(shrine.id);
                                  return (
                                    <div
                                      key={shrine.id}
                                      className="bg-white rounded-lg shadow p-3 hover:shadow-md transition-shadow ml-4"
                                    >
                                      <div className="flex items-start justify-between">
                                        <div
                                          className="flex-1 cursor-pointer"
                                          onClick={() => focusOnShrine(shrine)}
                                        >
                                          <div className="flex items-center gap-2 mb-1">
                                            <h3 className="font-bold text-gray-900">{shrine.name}</h3>
                                            {isVisited && (
                                              <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">
                                                参拝済
                                              </span>
                                            )}
                                          </div>
                                          <p className="text-xs text-gray-500">{shrine.province}</p>
                                        </div>
                                        <button
                                          onClick={() => toggleVisited(shrine.id)}
                                          className={`p-2 rounded-full ${isVisited ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
                                            }`}
                                        >
                                          <Check size={20} />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
};

export default ShrineMapApp;
