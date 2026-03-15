import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ShrineDetailPanel from '../components/ShrineDetailPanel';

const shrine = {
  id: 1,
  name: '氷川神社',
  reading: 'ひかわじんじゃ',
  prefecture: '埼玉県',
  province: '武蔵国',
  lat: 35.8,
  lng: 139.6,
};

const shrineWithHours = {
  ...shrine,
  goshuinHours: '9:00 - 17:00',
};

describe('ShrineDetailPanel – content', () => {
  test('renders shrine name', () => {
    render(<ShrineDetailPanel shrine={shrine} isVisited={false} onToggle={jest.fn()} onClose={jest.fn()} onMapChoice={jest.fn()} />);
    expect(screen.getByText('氷川神社')).toBeInTheDocument();
  });

  test('renders reading (furigana)', () => {
    render(<ShrineDetailPanel shrine={shrine} isVisited={false} onToggle={jest.fn()} onClose={jest.fn()} onMapChoice={jest.fn()} />);
    expect(screen.getByText('ひかわじんじゃ')).toBeInTheDocument();
  });

  test('renders prefecture and province', () => {
    render(<ShrineDetailPanel shrine={shrine} isVisited={false} onToggle={jest.fn()} onClose={jest.fn()} onMapChoice={jest.fn()} />);
    expect(screen.getByText(/埼玉県/)).toBeInTheDocument();
    expect(screen.getByText(/武蔵国/)).toBeInTheDocument();
  });

  test('renders goshuinHours when present', () => {
    render(<ShrineDetailPanel shrine={shrineWithHours} isVisited={false} onToggle={jest.fn()} onClose={jest.fn()} onMapChoice={jest.fn()} />);
    expect(screen.getByText(/9:00 - 17:00/)).toBeInTheDocument();
  });

  test('does not render goshuinHours row when absent', () => {
    render(<ShrineDetailPanel shrine={shrine} isVisited={false} onToggle={jest.fn()} onClose={jest.fn()} onMapChoice={jest.fn()} />);
    expect(screen.queryByText(/御朱印受付/)).not.toBeInTheDocument();
  });
});

describe('ShrineDetailPanel – visited state', () => {
  test('shows 参拝済み when isVisited is true', () => {
    render(<ShrineDetailPanel shrine={shrine} isVisited={true} onToggle={jest.fn()} onClose={jest.fn()} onMapChoice={jest.fn()} />);
    expect(screen.getByText(/参拝済み/)).toBeInTheDocument();
  });

  test('shows 参拝済みとしてマーク when isVisited is false', () => {
    render(<ShrineDetailPanel shrine={shrine} isVisited={false} onToggle={jest.fn()} onClose={jest.fn()} onMapChoice={jest.fn()} />);
    expect(screen.getByText(/参拝済みとしてマーク/)).toBeInTheDocument();
  });
});

describe('ShrineDetailPanel – interactions', () => {
  test('calls onToggle with shrine.id when toggle button is clicked', () => {
    const onToggle = jest.fn();
    render(<ShrineDetailPanel shrine={shrine} isVisited={false} onToggle={onToggle} onClose={jest.fn()} onMapChoice={jest.fn()} />);
    fireEvent.click(screen.getByText(/参拝済みとしてマーク/));
    expect(onToggle).toHaveBeenCalledWith(1);
  });

  test('calls onClose when X button is clicked', () => {
    const onClose = jest.fn();
    render(<ShrineDetailPanel shrine={shrine} isVisited={false} onToggle={jest.fn()} onClose={onClose} onMapChoice={jest.fn()} />);
    // X button is the only button without text content
    const buttons = screen.getAllByRole('button');
    const closeButton = buttons.find(b => !b.textContent.includes('マーク') && !b.textContent.includes('地図'));
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('calls onMapChoice when 地図 button is clicked', () => {
    const onMapChoice = jest.fn();
    render(<ShrineDetailPanel shrine={shrine} isVisited={false} onToggle={jest.fn()} onClose={jest.fn()} onMapChoice={onMapChoice} />);
    fireEvent.click(screen.getByText('地図'));
    expect(onMapChoice).toHaveBeenCalledTimes(1);
  });
});
