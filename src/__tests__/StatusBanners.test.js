import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import StatusBanners from '../components/StatusBanners';

const defaults = {
  syncMessage: null,
  user: null,
  authLoading: false,
  showLoginPrompt: true,
  onDismissLoginPrompt: jest.fn(),
  syncError: null,
  isOnline: true,
};

describe('StatusBanners – sync message', () => {
  test('shows sync message when syncMessage is set', () => {
    render(<StatusBanners {...defaults} syncMessage="5件を同期しました" />);
    expect(screen.getByText(/5件を同期しました/)).toBeInTheDocument();
  });

  test('hides sync message when syncMessage is null', () => {
    render(<StatusBanners {...defaults} syncMessage={null} />);
    expect(screen.queryByText(/同期しました/)).not.toBeInTheDocument();
  });
});

describe('StatusBanners – login prompt', () => {
  test('shows login prompt when user is null and authLoading is false', () => {
    render(<StatusBanners {...defaults} user={null} authLoading={false} showLoginPrompt={true} />);
    expect(screen.getByText(/ログインすると記録をクラウドに保存できます/)).toBeInTheDocument();
  });

  test('hides login prompt when user is logged in', () => {
    render(<StatusBanners {...defaults} user={{ id: '1', name: 'Test' }} showLoginPrompt={true} />);
    expect(screen.queryByText(/ログインすると/)).not.toBeInTheDocument();
  });

  test('hides login prompt when authLoading is true', () => {
    render(<StatusBanners {...defaults} user={null} authLoading={true} showLoginPrompt={true} />);
    expect(screen.queryByText(/ログインすると/)).not.toBeInTheDocument();
  });

  test('hides login prompt when showLoginPrompt is false', () => {
    render(<StatusBanners {...defaults} user={null} authLoading={false} showLoginPrompt={false} />);
    expect(screen.queryByText(/ログインすると/)).not.toBeInTheDocument();
  });

  test('calls onDismissLoginPrompt when X button is clicked', () => {
    const onDismiss = jest.fn();
    render(<StatusBanners {...defaults} user={null} authLoading={false} showLoginPrompt={true} onDismissLoginPrompt={onDismiss} />);
    // The dismiss button is the only button visible here
    fireEvent.click(screen.getByRole('button'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('StatusBanners – sync error', () => {
  test('shows sync error message when syncError is set', () => {
    render(<StatusBanners {...defaults} syncError="同期に失敗しました" />);
    expect(screen.getByText(/同期に失敗しました/)).toBeInTheDocument();
  });

  test('hides sync error when syncError is null', () => {
    render(<StatusBanners {...defaults} syncError={null} />);
    expect(screen.queryByText(/失敗しました/)).not.toBeInTheDocument();
  });
});

describe('StatusBanners – offline', () => {
  test('shows offline banner when isOnline is false', () => {
    render(<StatusBanners {...defaults} isOnline={false} />);
    expect(screen.getByText(/オフラインモード/)).toBeInTheDocument();
  });

  test('hides offline banner when isOnline is true', () => {
    render(<StatusBanners {...defaults} isOnline={true} />);
    expect(screen.queryByText(/オフラインモード/)).not.toBeInTheDocument();
  });
});
