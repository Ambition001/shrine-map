/**
 * Tests for useVisits hook.
 *
 * M3: hook must expose load errors instead of silently swallowing them.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { useVisits } from '../useVisits';

jest.mock('../../services/visits', () => ({
  getVisits: jest.fn(),
  getLocalVisits: jest.fn(),
}));

const visitsMock = require('../../services/visits');

beforeEach(() => {
  visitsMock.getVisits.mockResolvedValue(new Set());
  visitsMock.getLocalVisits.mockResolvedValue(new Set());
});

afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Basic hook shape
// ---------------------------------------------------------------------------

describe('useVisits – initial state', () => {
  test('starts with loading=true', () => {
    const { result } = renderHook(() => useVisits(null, true, 0));
    expect(result.current.loading).toBe(true);
  });

  test('loads visits when auth resolves (authLoading=false)', async () => {
    visitsMock.getVisits.mockResolvedValue(new Set(['s1', 's2']));
    const { result } = renderHook(() => useVisits(null, false, 0));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visitedShrines).toEqual(new Set(['s1', 's2']));
  });

  test('exposes updateVisitedShrines function', async () => {
    const { result } = renderHook(() => useVisits(null, false, 0));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(typeof result.current.updateVisitedShrines).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// M3: error must be exposed, not silently swallowed
// ---------------------------------------------------------------------------

describe('useVisits – M3 error exposure', () => {
  test('exposes error when getVisits rejects', async () => {
    const loadError = new Error('Network failure');
    visitsMock.getVisits.mockRejectedValue(loadError);

    const { result } = renderHook(() => useVisits(null, false, 0));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // M3: error must be exposed via return value
    expect(result.current.error).toBeTruthy();
    expect(result.current.error).toBe(loadError);
  });

  test('error is null on successful load', async () => {
    visitsMock.getVisits.mockResolvedValue(new Set(['s1']));

    const { result } = renderHook(() => useVisits(null, false, 0));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
  });

  test('clears previous error when re-loading succeeds', async () => {
    // First load fails
    visitsMock.getVisits.mockRejectedValue(new Error('First load fail'));
    const { result, rerender } = renderHook(
      ({ trigger }) => useVisits(null, false, trigger),
      { initialProps: { trigger: 0 } }
    );

    await waitFor(() => expect(result.current.error).toBeTruthy());

    // Second load succeeds
    visitsMock.getVisits.mockResolvedValue(new Set(['s1']));
    rerender({ trigger: 1 });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.visitedShrines).toEqual(new Set(['s1']));
    });
  });

  test('loading becomes false even when getVisits rejects', async () => {
    visitsMock.getVisits.mockRejectedValue(new Error('Failure'));

    const { result } = renderHook(() => useVisits(null, false, 0));

    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});

// ---------------------------------------------------------------------------
// Reload trigger
// ---------------------------------------------------------------------------

describe('useVisits – loadTrigger', () => {
  test('re-fetches visits when loadTrigger increments', async () => {
    visitsMock.getVisits.mockResolvedValue(new Set(['s1']));
    const { result, rerender } = renderHook(
      ({ trigger }) => useVisits(null, false, trigger),
      { initialProps: { trigger: 0 } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(visitsMock.getVisits).toHaveBeenCalledTimes(1);

    rerender({ trigger: 1 });
    await waitFor(() => expect(visitsMock.getVisits).toHaveBeenCalledTimes(2));
  });
});

// ---------------------------------------------------------------------------
// Local prefetch — unblock map rendering before auth resolves
// ---------------------------------------------------------------------------

describe('useVisits – local prefetch', () => {
  test('calls getLocalVisits on mount regardless of authLoading', async () => {
    renderHook(() => useVisits(null, true, 0));
    await waitFor(() => expect(visitsMock.getLocalVisits).toHaveBeenCalledTimes(1));
  });

  test('loading becomes false and shows local data while auth is still pending', async () => {
    visitsMock.getLocalVisits.mockResolvedValue(new Set([10, 20]));
    const { result } = renderHook(() => useVisits(null, true, 0));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visitedShrines).toEqual(new Set([10, 20]));
    expect(visitsMock.getVisits).not.toHaveBeenCalled();
  });

  test('does not call getVisits while authLoading is true', async () => {
    renderHook(() => useVisits(null, true, 0));
    await waitFor(() => expect(visitsMock.getLocalVisits).toHaveBeenCalled());
    expect(visitsMock.getVisits).not.toHaveBeenCalled();
  });

  test('replaces local data with cloud data when auth resolves', async () => {
    visitsMock.getLocalVisits.mockResolvedValue(new Set([10]));
    visitsMock.getVisits.mockResolvedValue(new Set([10, 20, 30]));

    const { result, rerender } = renderHook(
      ({ authLoading }) => useVisits(null, authLoading, 0),
      { initialProps: { authLoading: true } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.visitedShrines).toEqual(new Set([10]));

    rerender({ authLoading: false });
    await waitFor(() => expect(result.current.visitedShrines).toEqual(new Set([10, 20, 30])));
    expect(visitsMock.getVisits).toHaveBeenCalledTimes(1);
  });

  test('local data does not overwrite cloud data if cloud resolves first', async () => {
    let resolveLocal;
    visitsMock.getLocalVisits.mockReturnValue(
      new Promise(res => { resolveLocal = res; })
    );
    visitsMock.getVisits.mockResolvedValue(new Set([99]));

    const { result } = renderHook(() => useVisits(null, false, 0));

    // Cloud data arrives first
    await waitFor(() => expect(result.current.visitedShrines).toEqual(new Set([99])));

    // Local data arrives late — should be ignored
    resolveLocal(new Set([1, 2, 3]));
    await new Promise(r => setTimeout(r, 10));
    expect(result.current.visitedShrines).toEqual(new Set([99]));
  });
});
