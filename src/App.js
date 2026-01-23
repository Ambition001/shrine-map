import React, { useState, useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapPin, Check, X, List, Map, LogIn, LogOut, User, ExternalLink } from 'lucide-react';
import shrineData from './data/shrines.json';
import { getVisits, toggleVisitOptimistic, initLocalStorage, smartMerge, mergeAll, clearLocalStorage, replaceCloudWithLocal, syncPendingOperations, clearPendingQueue } from './services/visits';
import { onAuthChange, loginWithGoogle, loginWithTwitter, logout as firebaseLogout } from './services/auth';

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
  const [showLoginMenu, setShowLoginMenu] = useState(false); // 登录方式选择菜单

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

  // 点击外部关闭登录菜单
  useEffect(() => {
    const handleClickOutside = () => setShowLoginMenu(false);
    if (showLoginMenu) {
      document.addEventListener('click', handleClickOutside);
    }
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showLoginMenu]);

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
      const result = await initLocalStorage();
      if (result.migrated) {
        console.log(`已从 localStorage 迁移 ${result.count} 条记录到 IndexedDB`);
      }
      // 触发一次后台同步，处理之前未完成的操作
      syncPendingOperations();
    };
    init();
  }, []);

  // 监听网络恢复，自动重试同步
  useEffect(() => {
    const handleOnline = () => {
      console.log('网络恢复，开始同步...');
      syncPendingOperations();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  // 监听认证状态
  useEffect(() => {
    let previousUser = null;
    const unsubscribe = onAuthChange(async (currentUser) => {
      // 检测是否是新登录（之前没用户，现在有用户）
      const isNewLogin = !previousUser && currentUser;
      previousUser = currentUser;

      setUser(currentUser);
      setAuthLoading(false);

      // 用户刚登录时，使用智能合并
      if (isNewLogin) {
        const mergeResult = await smartMerge();

        switch (mergeResult.action) {
          case 'use_cloud':
            // 静默使用云端数据，无需提示
            break;

          case 'use_local':
            // 云端 API 出错，使用本地数据（静默处理）
            console.warn('云端 API 不可用，使用本地数据');
            break;

          case 'pending_synced':
            // 待同步操作已完成，显示提示
            if (mergeResult.count > 0) {
              setSyncMessage(`${mergeResult.count}件の記録を同期しました`);
              setTimeout(() => setSyncMessage(null), 2000);
            }
            break;

          case 'uploaded_local':
            // 自动上传成功，显示简短提示
            setSyncMessage(`${mergeResult.count}件の記録を同期しました`);
            setTimeout(() => setSyncMessage(null), 2000);
            break;

          case 'ask_user':
            // 只有真正冲突时才弹窗
            setMergeDialog({
              type: 'conflict',
              onlyLocalCount: mergeResult.conflict.onlyLocal.length,
              onlyCloudCount: mergeResult.conflict.onlyCloud.length,
              commonCount: mergeResult.conflict.common.length,
              onlyCloud: mergeResult.conflict.onlyCloud // 保存云端独有的ID，用于"本地优先"时删除
            });
            break;

          default:
            break;
        }

        // 重新加载数据
        const visits = await getVisits();
        setVisitedShrines(visits);
      }
    });
    return () => unsubscribe();
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
      } catch (error) {
        console.error('加载参拜记录失败:', error);
      } finally {
        setLoading(false);
      }
    };
    loadVisits();
  }, [user, authLoading]);

  // 关闭弹窗并恢复之前的视图
  const closeSelectedShrine = useCallback(() => {
    setSelectedShrine(null);
    selectedShrineRef.current = null;
    if (previousView.current && map.current) {
      map.current.flyTo({
        center: previousView.current.center,
        zoom: previousView.current.zoom,
        duration: 800
      });
      previousView.current = null;
    }
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
  const toggleVisited = async (shrineId) => {
    // 1. 立即计算新状态
    const newVisited = new Set(visitedShrines);
    if (newVisited.has(shrineId)) {
      newVisited.delete(shrineId);
    } else {
      newVisited.add(shrineId);
    }

    // 2. 立即更新 UI（乐观更新）
    setVisitedShrines(newVisited);

    // 3. 后台写入本地存储并同步云端（不阻塞 UI）
    try {
      await toggleVisitOptimistic(shrineId, visitedShrines);
    } catch (error) {
      console.error('切换参拜状态失败:', error);
      // 可选：回滚 UI 状态（如果写入失败）
      // setVisitedShrines(visitedShrines);
    }
  };

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

  // 登出处理
  const handleLogout = async () => {
    try {
      // 清空待同步队列（避免下次登录时同步到错误的账户）
      await clearPendingQueue();
      await firebaseLogout();
    } catch (error) {
      console.error('登出失败:', error);
    }
  };

  // 合并所有数据（本地 + 云端）
  const handleMergeAll = async () => {
    const result = await mergeAll();
    setMergeDialog(null);
    if (result.merged) {
      setSyncMessage(`${result.count}件の記録を合併しました`);
      setTimeout(() => setSyncMessage(null), 3000);
    }
    // 重新加载数据
    const visits = await getVisits();
    setVisitedShrines(visits);
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

  // 按地区分组神社
  const shrinesByRegion = shrines.reduce((acc, shrine) => {
    const region = shrine.region || '不明';
    if (!acc[region]) {
      acc[region] = [];
    }
    acc[region].push(shrine);
    return acc;
  }, {});

  // 地区排序顺序
  const regionOrder = ['北海道・東北', '関東', '甲信越', '東海', '近畿', '中国', '四国', '九州・沖縄'];

  // 按顺序获取地区列表
  const sortedRegions = regionOrder.filter(r => shrinesByRegion[r]);

  // 计算每个地区的统计
  const regionStats = sortedRegions.map(region => {
    const regionShrines = shrinesByRegion[region];
    const visitedCount = regionShrines.filter(s => visitedShrines.has(s.id)).length;
    return {
      region,
      total: regionShrines.length,
      visited: visitedCount,
      percentage: Math.round((visitedCount / regionShrines.length) * 100)
    };
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-gray-600">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-gray-50" style={{ height: viewportHeight }}>
      {/* 合并确认对话框（只在真正冲突时显示） */}
      {mergeDialog && mergeDialog.type === 'conflict' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              データの競合が見つかりました
            </h3>
            <div className="text-sm text-gray-600 mb-4 space-y-1">
              <p>・ローカルのみ: {mergeDialog.onlyLocalCount}件</p>
              <p>・クラウドのみ: {mergeDialog.onlyCloudCount}件</p>
              <p>・共通: {mergeDialog.commonCount}件</p>
            </div>
            <div className="space-y-2">
              <button
                onClick={handleMergeAll}
                className="w-full py-2 px-4 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium"
              >
                すべて合併する（推奨）
              </button>
              <button
                onClick={handleUseCloud}
                className="w-full py-2 px-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                クラウドを優先
              </button>
              <button
                onClick={handleUseLocal}
                className="w-full py-2 px-4 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                ローカルを優先
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

      {/* 未登录提示 */}
      {!user && !authLoading && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-sm text-yellow-800 text-center">
          ログインすると記録をクラウドに保存できます
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
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowLoginMenu(!showLoginMenu); }}
                className="text-sm bg-white text-red-600 hover:bg-gray-100 px-3 py-1.5 rounded-lg flex items-center gap-2 font-medium"
              >
                <LogIn size={16} />
                ログイン
              </button>
              {showLoginMenu && (
                <div className="absolute right-0 mt-1 bg-white rounded-lg shadow-xl border py-1 min-w-[160px] z-50">
                  <button
                    onClick={() => { loginWithGoogle(); setShowLoginMenu(false); }}
                    className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100 flex items-center gap-2 text-sm"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Google
                  </button>
                  <button
                    onClick={() => { loginWithTwitter(); setShowLoginMenu(false); }}
                    className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100 flex items-center gap-2 text-sm"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#000" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                    X (Twitter)
                  </button>
                </div>
              )}
            </div>
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
          className={`flex-1 py-3 flex items-center justify-center gap-2 ${
            viewMode === 'map'
              ? 'bg-red-50 text-red-600 border-b-2 border-red-600'
              : 'text-gray-600'
          }`}
        >
          <Map size={18} />
          地図表示
        </button>
        <button
          onClick={() => setViewMode('list')}
          className={`flex-1 py-3 flex items-center justify-center gap-2 ${
            viewMode === 'list'
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
                className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                  visitedShrines.has(selectedShrine.id)
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
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${selectedShrine.lat},${selectedShrine.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors flex items-center gap-2 font-medium"
              >
                <ExternalLink size={18} />
                地図
              </a>
            </div>
          </div>
        )}

        {/* 列表视图 */}
        {viewMode === 'list' && (
          <div className="absolute inset-0 overflow-auto p-4 space-y-4 bg-gray-50">
            {regionStats.map(({ region, total, visited, percentage }) => (
              <div key={region}>
                {/* 地区标题 */}
                <div className="bg-gradient-to-r from-red-600 to-red-700 text-white rounded-lg p-3 mb-2 shadow">
                  <div className="flex justify-between items-center mb-1">
                    <h2 className="text-lg font-bold">{region}</h2>
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

                {/* 该地区的神社列表 */}
                <div className="space-y-2">
                  {shrinesByRegion[region].map(shrine => {
                    const isVisited = visitedShrines.has(shrine.id);
                    return (
                      <div
                        key={shrine.id}
                        className="bg-white rounded-lg shadow p-4 hover:shadow-md transition-shadow"
                      >
                        <div className="flex items-start justify-between">
                          <div
                            className="flex-1 cursor-pointer"
                            onClick={() => focusOnShrine(shrine)}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-bold text-gray-900">{shrine.name}</h3>
                              {isVisited && (
                                <span className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded-full">
                                  参拝済
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-600">{shrine.province} ・ {shrine.prefecture}</p>
                          </div>
                          <button
                            onClick={() => toggleVisited(shrine.id)}
                            className={`p-2 rounded-full ${
                              isVisited ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
                            }`}
                          >
                            <Check size={20} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};

export default ShrineMapApp;
