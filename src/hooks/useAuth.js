import { useState, useEffect, useRef, useCallback } from 'react';
import { handleRedirectResult, onAuthChange } from '../services/auth';
import { initLocalStorage, smartMerge, syncPendingOperations } from '../services/visits';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [syncMessage, setSyncMessage] = useState(null);
  const [mergeDialog, setMergeDialog] = useState(null);
  const [visitLoadTrigger, setVisitLoadTrigger] = useState(0);
  const isMountedRef = useRef(false);
  const timerIdsRef = useRef([]);

  // Track mount state for timer guards.
  // Initialize to false and set to true inside the effect body so that
  // React Strict Mode's mount→cleanup→mount cycle resets the flag correctly.
  useEffect(() => {
    isMountedRef.current = true;
    const timerIds = timerIdsRef.current;
    return () => {
      isMountedRef.current = false;
      timerIds.forEach(clearTimeout);
    };
  }, []);

  // 初始化 IndexedDB + 触发后台同步
  useEffect(() => {
    const init = async () => {
      await initLocalStorage();
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
  useEffect(() => {
    let previousUser = null;
    let authUnsubscribe = null;
    const clearTimers = [];

    const scheduleMessageClear = (delayMs) => {
      const timerId = setTimeout(() => {
        if (isMountedRef.current) setSyncMessage(null);
      }, delayMs);
      clearTimers.push(timerId);
    };

    const initAuth = async () => {
      try {
        const redirectUser = await handleRedirectResult();
        if (redirectUser && isMountedRef.current) {
          setUser(redirectUser);
        }
      } catch {
        // ignore redirect errors
      }

      if (!isMountedRef.current) return;

      authUnsubscribe = onAuthChange(async (currentUser) => {
        if (!isMountedRef.current) return;

        const isNewLogin = !previousUser && currentUser;
        previousUser = currentUser;

        setUser(currentUser);
        setAuthLoading(false);

        if (isNewLogin) {
          const mergeResult = await smartMerge();
          if (!isMountedRef.current) return;
          switch (mergeResult.action) {
            case 'use_cloud':
              if (mergeResult.reason === 'pending_synced' && mergeResult.count > 0) {
                setSyncMessage(`${mergeResult.count}件の記録を同期しました`);
                scheduleMessageClear(2000);
              }
              break;
            case 'partial_sync':
              setSyncMessage(`${mergeResult.count}件を同期しました（${mergeResult.failed}件失敗）`);
              scheduleMessageClear(3000);
              break;
            case 'uploaded_local':
              setSyncMessage(`${mergeResult.count}件の記録を同期しました`);
              scheduleMessageClear(2000);
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

          // 合并完成后触发 visit 重新加载
          setVisitLoadTrigger(t => t + 1);
        }
      });
    };

    initAuth();

    return () => {
      clearTimers.forEach(id => clearTimeout(id));
      if (authUnsubscribe) authUnsubscribe();
    };
  }, []);

  // M1: expose narrow interface functions with stable references and proper timer cleanup
  const showSyncMessage = useCallback((text, duration = 3000) => {
    setSyncMessage(text);
    const timerId = setTimeout(() => {
      if (isMountedRef.current) setSyncMessage(null);
    }, duration);
    timerIdsRef.current.push(timerId);
  }, []);

  const clearMergeDialog = useCallback(() => {
    setMergeDialog(null);
  }, []);

  return { user, authLoading, syncMessage, showSyncMessage, mergeDialog, clearMergeDialog, visitLoadTrigger };
}
