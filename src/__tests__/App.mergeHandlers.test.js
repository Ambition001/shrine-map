/**
 * Tests for App merge handlers (handleMergeAll, handleUseCloud, handleUseLocal)
 * and setTimeout cleanup.
 *
 * Issue 4: setTimeout without clearTimeout on unmount
 * Issue 5: No try/catch in merge handlers — Promise rejections must surface to user
 */
import React from 'react';
import { render, fireEvent, act, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks (all factories must be self-contained — no outer-scope variable refs)
// ---------------------------------------------------------------------------

jest.mock('../components/ShrineListView', () => ({
  __esModule: true,
  default: function MockShrineListView() { return null; },
}));

jest.mock('../components/MergeConflictDialog', () => ({
  __esModule: true,
  default: function MockMergeConflictDialog({ dialog, onMergeAll, onUseCloud, onUseLocal }) {
    const R = require('react');
    if (!dialog) return null;
    return R.createElement('div', { 'data-testid': 'merge-dialog' },
      R.createElement('button', { onClick: onMergeAll }, 'MergeAll'),
      R.createElement('button', { onClick: onUseCloud }, 'UseCloud'),
      R.createElement('button', { onClick: onUseLocal }, 'UseLocal'),
    );
  },
}));

jest.mock('../components/StatusBanners', () => ({
  __esModule: true,
  default: function MockStatusBanners({ syncMessage, syncError }) {
    const R = require('react');
    return R.createElement('div', null,
      syncMessage ? R.createElement('div', { 'data-testid': 'sync-message' }, syncMessage) : null,
      syncError ? R.createElement('div', { 'data-testid': 'sync-error' }, syncError) : null,
    );
  },
}));

jest.mock('../components/ShrineDetailPanel', () => ({
  __esModule: true,
  default: function MockShrineDetailPanel() { return null; },
}));

jest.mock('../components/MapChoiceSheet', () => ({
  __esModule: true,
  default: function MockMapChoiceSheet() { return null; },
}));

jest.mock('mapbox-gl', () => {
  const instance = {
    on() {}, addControl() {}, addSource() {}, addLayer() {}, removeSource() {},
    getSource() { return null; }, getLayer() { return null; },
    getCenter() { return { lng: 138.5, lat: 36.5 }; },
    getZoom() { return 5.5; },
    getCanvas() { return { style: {} }; },
    setLayoutProperty() {}, flyTo() {}, resize() {}, remove() {},
  };
  return {
    Map: function() { return instance; },
    NavigationControl: function() {},
    accessToken: null,
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
  mergeAll: jest.fn().mockResolvedValue({ merged: true, count: 3, finalVisits: new Set() }),
  clearLocalStorage: jest.fn().mockResolvedValue(undefined),
  replaceCloudWithLocal: jest.fn().mockResolvedValue({ replaced: true, deleted: 1, uploaded: 2, finalVisits: new Set() }),
  syncPendingOperations: jest.fn().mockResolvedValue({ synced: 0 }),
}));

jest.mock('../hooks/useAuth');
jest.mock('../hooks/useVisits');

// ---------------------------------------------------------------------------
// Get mutable references to mocked modules after imports
// ---------------------------------------------------------------------------

import { useAuth } from '../hooks/useAuth';
import { useVisits } from '../hooks/useVisits';
import App from '../App';

// Get references to the mock fns so we can change their implementations per test
const visitsMock = jest.requireMock('../services/visits');

// ---------------------------------------------------------------------------
// Default hook values
// ---------------------------------------------------------------------------

// M1: use narrow interface (showSyncMessage, clearMergeDialog) not raw setters
const showSyncMessage = jest.fn();
const clearMergeDialog = jest.fn();

const makeAuthWithDialog = (dialog) => ({
  user: { id: 'u1', name: 'Test' },
  authLoading: false,
  syncMessage: null,
  showSyncMessage,
  mergeDialog: dialog,
  clearMergeDialog,
  visitLoadTrigger: 0,
});

const defaultAuth = makeAuthWithDialog(null);

const updateVisitedShrines = jest.fn();
const defaultVisits = {
  visitedShrines: new Set(),
  updateVisitedShrines,
  loading: false,
};

const conflictDialog = {
  type: 'conflict',
  onlyLocalCount: 1,
  onlyCloudCount: 1,
  commonCount: 0,
  onlyCloud: ['cloud-1'],
};

beforeEach(() => {
  jest.useFakeTimers();
  useAuth.mockReturnValue(defaultAuth);
  useVisits.mockReturnValue(defaultVisits);
  // Reset to default success implementations
  visitsMock.mergeAll.mockResolvedValue({ merged: true, count: 3, finalVisits: new Set() });
  visitsMock.clearLocalStorage.mockResolvedValue(undefined);
  visitsMock.getVisits.mockResolvedValue(new Set(['s2']));
  visitsMock.replaceCloudWithLocal.mockResolvedValue({ replaced: true, deleted: 1, uploaded: 2, finalVisits: new Set() });
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Issue 5: handleMergeAll — try/catch with user-facing error on rejection
// ---------------------------------------------------------------------------

describe('App – handleMergeAll error handling (Issue 5)', () => {
  test('shows sync error when mergeAll rejects', async () => {
    visitsMock.mergeAll.mockRejectedValue(new Error('Network error'));
    useAuth.mockReturnValue(makeAuthWithDialog(conflictDialog));

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByText('MergeAll'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('sync-error')).toBeInTheDocument();
    });
  });

  test('calls showSyncMessage with merge count on success', async () => {
    visitsMock.mergeAll.mockResolvedValue({ merged: true, count: 4, finalVisits: new Set() });
    useAuth.mockReturnValue(makeAuthWithDialog(conflictDialog));

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByText('MergeAll'));
    });

    // M1: App now calls showSyncMessage instead of setSyncMessage directly
    expect(showSyncMessage).toHaveBeenCalledWith(expect.stringContaining('4件'), 3000);
  });
});

// ---------------------------------------------------------------------------
// Issue 5: handleUseCloud — try/catch with user-facing error on rejection
// ---------------------------------------------------------------------------

describe('App – handleUseCloud error handling (Issue 5)', () => {
  test('shows sync error when clearLocalStorage rejects', async () => {
    visitsMock.clearLocalStorage.mockRejectedValue(new Error('Storage error'));
    useAuth.mockReturnValue(makeAuthWithDialog(conflictDialog));

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByText('UseCloud'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('sync-error')).toBeInTheDocument();
    });
  });

  test('calls clearLocalStorage and getVisits on success', async () => {
    useAuth.mockReturnValue(makeAuthWithDialog(conflictDialog));

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByText('UseCloud'));
    });

    expect(visitsMock.clearLocalStorage).toHaveBeenCalled();
    expect(visitsMock.getVisits).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Issue 5: handleUseLocal — try/catch with user-facing error on rejection
// ---------------------------------------------------------------------------

describe('App – handleUseLocal error handling (Issue 5)', () => {
  test('shows sync error when replaceCloudWithLocal rejects', async () => {
    visitsMock.replaceCloudWithLocal.mockRejectedValue(new Error('Replace error'));
    useAuth.mockReturnValue(makeAuthWithDialog(conflictDialog));

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByText('UseLocal'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('sync-error')).toBeInTheDocument();
    });
  });

  test('passes correct onlyCloud IDs to replaceCloudWithLocal', async () => {
    useAuth.mockReturnValue(makeAuthWithDialog({
      ...conflictDialog,
      onlyCloud: ['cloud-shrine-1', 'cloud-shrine-2'],
    }));

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByText('UseLocal'));
    });

    expect(visitsMock.replaceCloudWithLocal).toHaveBeenCalledWith(
      ['cloud-shrine-1', 'cloud-shrine-2']
    );
  });

  test('reloads visits from server when replaced=false', async () => {
    visitsMock.replaceCloudWithLocal.mockResolvedValue({ replaced: false });
    visitsMock.getVisits.mockResolvedValue(new Set(['srv-1']));
    useAuth.mockReturnValue(makeAuthWithDialog(conflictDialog));

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByText('UseLocal'));
    });

    expect(visitsMock.getVisits).toHaveBeenCalled();
    expect(updateVisitedShrines).toHaveBeenCalledWith(new Set(['srv-1']));
  });
});

// ---------------------------------------------------------------------------
// handleLogin — errors must surface to user, not be silently swallowed
// ---------------------------------------------------------------------------

const authMockRef = jest.requireMock('../services/auth');

describe('App – handleLogin error handling', () => {
  test('shows sync error when loginWithGoogle rejects', async () => {
    authMockRef.loginWithGoogle.mockRejectedValue(new Error('Login failed'));
    useAuth.mockReturnValue({ ...defaultAuth, user: null });

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByText('ログイン'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('sync-error')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// L2: handleLogout — catch block must surface error to user, not swallow it
// ---------------------------------------------------------------------------

const authMock = jest.requireMock('../services/auth');

describe('App – handleLogout error handling (L2)', () => {
  test('shows sync error when logout throws', async () => {
    authMock.logout.mockRejectedValue(new Error('Logout failed'));
    useAuth.mockReturnValue({ ...defaultAuth, user: { id: 'u1', name: 'Test', photoURL: null } });

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByText('ログアウト'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('sync-error')).toBeInTheDocument();
    });
  });

  test('shows sync error when clearLocalStorage throws during logout', async () => {
    visitsMock.clearLocalStorage.mockRejectedValue(new Error('Storage clear failed'));
    authMock.logout.mockResolvedValue(undefined);
    useAuth.mockReturnValue({ ...defaultAuth, user: { id: 'u1', name: 'Test', photoURL: null } });

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByText('ログアウト'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('sync-error')).toBeInTheDocument();
    });
  });

  test('calls clearLocalStorage and logout on successful logout', async () => {
    visitsMock.clearLocalStorage.mockResolvedValue(undefined);
    authMock.logout.mockResolvedValue(undefined);
    useAuth.mockReturnValue({ ...defaultAuth, user: { id: 'u1', name: 'Test', photoURL: null } });

    render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByText('ログアウト'));
    });

    expect(visitsMock.clearLocalStorage).toHaveBeenCalled();
    expect(authMock.logout).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Issue 4: setTimeout cleanup — no stale timers firing after unmount
// ---------------------------------------------------------------------------

describe('App – setTimeout cleanup on unmount (Issue 4)', () => {
  test('no error after mergeAll timer fires post-unmount', async () => {
    visitsMock.mergeAll.mockResolvedValue({ merged: true, count: 2, finalVisits: new Set() });
    useAuth.mockReturnValue(makeAuthWithDialog(conflictDialog));

    const { unmount } = render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByText('MergeAll'));
    });

    // Unmount BEFORE the 3s cleanup timer fires
    unmount();

    // Advance time past the timer — must not throw
    act(() => {
      jest.advanceTimersByTime(5000);
    });
  });

  test('no error after handleUseCloud timer fires post-unmount', async () => {
    useAuth.mockReturnValue(makeAuthWithDialog(conflictDialog));

    const { unmount } = render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByText('UseCloud'));
    });

    unmount();

    act(() => {
      jest.advanceTimersByTime(5000);
    });
  });

  test('no error after handleUseLocal timer fires post-unmount', async () => {
    useAuth.mockReturnValue(makeAuthWithDialog(conflictDialog));

    const { unmount } = render(<App />);

    await act(async () => {
      fireEvent.click(screen.getByText('UseLocal'));
    });

    unmount();

    act(() => {
      jest.advanceTimersByTime(5000);
    });
  });
});
