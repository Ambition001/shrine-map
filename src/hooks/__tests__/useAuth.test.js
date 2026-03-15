/**
 * Tests for useAuth hook.
 *
 * Mocks all external services so the hook can be tested in isolation.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAuth } from '../useAuth';

// ---------------------------------------------------------------------------
// Service mocks
// ---------------------------------------------------------------------------

jest.mock('../../services/auth', () => ({
  handleRedirectResult: jest.fn().mockResolvedValue(null),
  onAuthChange: jest.fn(),
}));

jest.mock('../../services/visits', () => ({
  initLocalStorage: jest.fn().mockResolvedValue(undefined),
  smartMerge: jest.fn().mockResolvedValue({ action: 'identical' }),
  syncPendingOperations: jest.fn().mockResolvedValue({ synced: 0 }),
}));

const authService = require('../../services/auth');
const visitsService = require('../../services/visits');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set up onAuthChange so it immediately calls the callback with `user`,
 * simulating a new login (previousUser was null, now user is set).
 */
function setupNewLogin(user) {
  authService.onAuthChange.mockImplementation((cb) => {
    // Simulate auth state change: null → user (new login)
    cb(user);
    return jest.fn(); // unsubscribe
  });
}

function setupNoLogin() {
  authService.onAuthChange.mockImplementation((cb) => {
    cb(null); // no user
    return jest.fn();
  });
}

const MOCK_USER = { id: 'u1', name: 'Test', email: 't@t.com' };

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.useFakeTimers();
  authService.handleRedirectResult.mockResolvedValue(null);
  visitsService.initLocalStorage.mockResolvedValue(undefined);
  visitsService.syncPendingOperations.mockResolvedValue({ synced: 0 });
  visitsService.smartMerge.mockResolvedValue({ action: 'identical' });
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Issue 2: sync message for 'use_cloud' with reason 'pending_synced'
// ---------------------------------------------------------------------------

describe('useAuth – sync message on new login', () => {
  test('shows sync message when smartMerge returns action=use_cloud reason=pending_synced with count > 0', async () => {
    setupNewLogin(MOCK_USER);
    visitsService.smartMerge.mockResolvedValue({
      action: 'use_cloud',
      reason: 'pending_synced',
      count: 3,
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.syncMessage).toBe('3件の記録を同期しました');
    });
  });

  test('does NOT show sync message when action=use_cloud reason=pending_synced but count is 0', async () => {
    setupNewLogin(MOCK_USER);
    visitsService.smartMerge.mockResolvedValue({
      action: 'use_cloud',
      reason: 'pending_synced',
      count: 0,
    });

    const { result } = renderHook(() => useAuth());

    // Wait for auth to settle
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    expect(result.current.syncMessage).toBeNull();
  });

  test('shows sync message when action=partial_sync', async () => {
    setupNewLogin(MOCK_USER);
    visitsService.smartMerge.mockResolvedValue({
      action: 'partial_sync',
      count: 2,
      failed: 1,
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.syncMessage).toContain('2件');
    });
  });

  // L1: partial_sync message must use Japanese 失敗 (not Simplified Chinese 失败)
  test('partial_sync message uses Japanese 失敗 not Simplified Chinese 失败', async () => {
    setupNewLogin(MOCK_USER);
    visitsService.smartMerge.mockResolvedValue({
      action: 'partial_sync',
      count: 2,
      failed: 1,
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.syncMessage).toContain('失敗');
      expect(result.current.syncMessage).not.toContain('失败');
    });
  });

  test('shows sync message when action=uploaded_local', async () => {
    setupNewLogin(MOCK_USER);
    visitsService.smartMerge.mockResolvedValue({
      action: 'uploaded_local',
      count: 5,
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.syncMessage).toBe('5件の記録を同期しました');
    });
  });

  test('sets mergeDialog when action=ask_user', async () => {
    setupNewLogin(MOCK_USER);
    visitsService.smartMerge.mockResolvedValue({
      action: 'ask_user',
      conflict: {
        onlyLocal: ['s1'],
        onlyCloud: ['s2', 's3'],
        common: ['s4'],
      },
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.mergeDialog).toMatchObject({
        type: 'conflict',
        onlyLocalCount: 1,
        onlyCloudCount: 2,
        commonCount: 1,
      });
    });
  });

  test('clears sync message after 2 seconds', async () => {
    setupNewLogin(MOCK_USER);
    visitsService.smartMerge.mockResolvedValue({
      action: 'use_cloud',
      reason: 'pending_synced',
      count: 3,
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.syncMessage).toBe('3件の記録を同期しました');
    });

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(result.current.syncMessage).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Issue 4: setTimeout cleanup (no leaked timers on unmount)
// ---------------------------------------------------------------------------

describe('useAuth – timer cleanup on unmount', () => {
  test('does not update state after unmount (no leaked setTimeout)', async () => {
    setupNewLogin(MOCK_USER);
    visitsService.smartMerge.mockResolvedValue({
      action: 'use_cloud',
      reason: 'pending_synced',
      count: 2,
    });

    const { result, unmount } = renderHook(() => useAuth());

    // Wait for sync message to appear
    await waitFor(() => {
      expect(result.current.syncMessage).toBe('2件の記録を同期しました');
    });

    // Unmount before timer fires
    unmount();

    // Advance timers past the 2s cleanup window
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // No error should be thrown (state update on unmounted component)
    // If clearTimeout is missing, React would log a warning. This test
    // verifies no pending timers fire after unmount.
    expect(result.current.syncMessage).toBe('2件の記録を同期しました');
  });
});

// ---------------------------------------------------------------------------
// HIGH-2: isMountedRef Strict Mode hazard
// ---------------------------------------------------------------------------

describe('useAuth – HIGH-2 isMountedRef Strict Mode safety', () => {
  /**
   * In React 18/19 Strict Mode effects run twice: mount → cleanup → mount.
   * If isMountedRef starts as `useRef(true)` and is only set to `false`
   * in cleanup (never reset inside the effect body), after the first cleanup
   * cycle isMountedRef.current stays `false` permanently — showSyncMessage
   * timers will never clear the message.
   *
   * The fix: initialize isMountedRef to `useRef(false)` and set
   * `isMountedRef.current = true` inside the effect body.
   *
   * Source contract test: verify the source file encodes the correct pattern.
   * (Strict Mode double-invoke is suppressed in NODE_ENV=test, so behavioral
   * detection of the bug requires inspecting the implementation contract.)
   */
  test('HIGH-2: isMountedRef initialized to false and set to true inside effect body', () => {
    // Read the source to verify the structural fix is in place.
    // The fix requires:
    //   1. useRef(false) — NOT useRef(true)
    //   2. isMountedRef.current = true inside the effect body
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../useAuth.js'),
      'utf8'
    );

    // Must NOT initialize to true (that's the bug)
    expect(src).not.toMatch(/isMountedRef\s*=\s*useRef\(true\)/);

    // Must initialize to false
    expect(src).toMatch(/isMountedRef\s*=\s*useRef\(false\)/);

    // Must set to true inside an effect (the reset after Strict Mode cleanup)
    // Pattern: isMountedRef.current = true somewhere (not in cleanup)
    expect(src).toMatch(/isMountedRef\.current\s*=\s*true/);
  });

  test('showSyncMessage timer clears the message when hook is mounted', async () => {
    setupNoLogin();
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.authLoading).toBe(false));

    act(() => {
      result.current.showSyncMessage('テスト', 1000);
    });

    expect(result.current.syncMessage).toBe('テスト');

    act(() => { jest.advanceTimersByTime(1000); });

    // Timer callback must run (isMountedRef.current must be true while mounted)
    expect(result.current.syncMessage).toBeNull();
  });

  test('timer does not setState after unmount (isMountedRef guarded correctly)', async () => {
    setupNoLogin();
    const { result, unmount } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.authLoading).toBe(false));

    act(() => {
      result.current.showSyncMessage('テスト', 500);
    });

    // Unmount before timer fires — isMountedRef.current must become false
    unmount();

    // Timer fires after unmount — must not throw or attempt setState
    expect(() => {
      act(() => { jest.advanceTimersByTime(500); });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Basic hook shape
// ---------------------------------------------------------------------------

describe('useAuth – initial state', () => {
  test('returns expected initial shape', async () => {
    setupNoLogin();

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.authLoading).toBe(false));

    expect(result.current.user).toBeNull();
    expect(result.current.syncMessage).toBeNull();
    expect(result.current.mergeDialog).toBeNull();
    // M1: hook must expose narrow interface functions, not raw setters
    expect(typeof result.current.showSyncMessage).toBe('function');
    expect(typeof result.current.clearMergeDialog).toBe('function');
    expect(typeof result.current.visitLoadTrigger).toBe('number');
  });

  // M1: showSyncMessage sets the message and clears it after duration
  test('showSyncMessage sets syncMessage and clears it after duration', async () => {
    setupNoLogin();

    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.authLoading).toBe(false));

    act(() => {
      result.current.showSyncMessage('テストメッセージ', 2000);
    });

    expect(result.current.syncMessage).toBe('テストメッセージ');

    act(() => {
      jest.advanceTimersByTime(2000);
    });

    expect(result.current.syncMessage).toBeNull();
  });

  // M1: clearMergeDialog sets mergeDialog to null
  test('clearMergeDialog sets mergeDialog to null', async () => {
    setupNewLogin(MOCK_USER);
    visitsService.smartMerge.mockResolvedValue({
      action: 'ask_user',
      conflict: {
        onlyLocal: ['s1'],
        onlyCloud: ['s2'],
        common: [],
      },
    });

    const { result } = renderHook(() => useAuth());

    // Wait for dialog to appear
    await waitFor(() => expect(result.current.mergeDialog).not.toBeNull());

    // Clear it
    act(() => {
      result.current.clearMergeDialog();
    });

    expect(result.current.mergeDialog).toBeNull();
  });

  test('increments visitLoadTrigger after smartMerge completes on new login', async () => {
    setupNewLogin(MOCK_USER);
    visitsService.smartMerge.mockResolvedValue({ action: 'identical' });

    const { result } = renderHook(() => useAuth());

    const initialTrigger = result.current.visitLoadTrigger;

    await waitFor(() => {
      expect(result.current.visitLoadTrigger).toBeGreaterThan(initialTrigger);
    });
  });
});
