import React from 'react';
import { render, screen } from '@testing-library/react';

// Mock heavy service modules before importing App
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

import App from '../App';

describe('App – smoke tests', () => {
  // The App has a multi-level async boot sequence:
  //   handleRedirectResult → onAuthChange → getVisits
  // Each step is a separate async boundary, so the final render
  // is not reachable within a single waitFor/act flush in jsdom.
  // Individual units (components, utils, services) are tested separately.

  test('renders loading spinner on initial mount', () => {
    // Before any async callbacks resolve, the spinner should show
    render(<App />);
    expect(screen.getByText('読み込み中...')).toBeInTheDocument();
  });
});
