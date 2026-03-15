import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ShrineListView from '../components/ShrineListView';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const shrineA = { id: 1, name: '氷川神社', province: '武蔵国', prefecture: '埼玉県' };
const shrineB = { id: 2, name: '寒川神社', province: '相模国', prefecture: '神奈川県' };

const regionStats = [
  {
    region: '関東',
    total: 2,
    visited: 1,
    percentage: 50,
    prefectures: [
      { prefecture: '埼玉県', shrines: [shrineA], total: 1, visited: 1 },
      { prefecture: '神奈川県', shrines: [shrineB], total: 1, visited: 0 },
    ],
  },
];

const defaultProps = {
  regionStats,
  visitedShrines: new Set([1]),
  onToggleVisit: jest.fn(),
  onFocusShrine: jest.fn(),
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('ShrineListView – rendering', () => {
  test('renders region name', () => {
    render(<ShrineListView {...defaultProps} />);
    expect(screen.getByText('関東')).toBeInTheDocument();
  });

  test('renders region stats (visited/total)', () => {
    render(<ShrineListView {...defaultProps} />);
    expect(screen.getByText(/1\/2社/)).toBeInTheDocument();
  });

  test('renders all prefecture headers by default (expanded)', () => {
    render(<ShrineListView {...defaultProps} />);
    expect(screen.getByText('埼玉県')).toBeInTheDocument();
    expect(screen.getByText('神奈川県')).toBeInTheDocument();
  });

  test('renders all shrine names by default (expanded)', () => {
    render(<ShrineListView {...defaultProps} />);
    expect(screen.getByText('氷川神社')).toBeInTheDocument();
    expect(screen.getByText('寒川神社')).toBeInTheDocument();
  });

  test('shows 参拝済 badge for visited shrines', () => {
    render(<ShrineListView {...defaultProps} />);
    expect(screen.getByText('参拝済')).toBeInTheDocument();
  });

  test('does not show 参拝済 badge for unvisited shrines', () => {
    render(<ShrineListView {...defaultProps} visitedShrines={new Set()} />);
    expect(screen.queryByText('参拝済')).not.toBeInTheDocument();
  });

  test('renders multiple regions', () => {
    const multiRegion = [
      ...regionStats,
      {
        region: '近畿',
        total: 1,
        visited: 0,
        percentage: 0,
        prefectures: [
          { prefecture: '大阪府', shrines: [{ id: 99, name: '住吉大社', province: '摂津国' }], total: 1, visited: 0 },
        ],
      },
    ];
    render(<ShrineListView {...defaultProps} regionStats={multiRegion} />);
    expect(screen.getByText('関東')).toBeInTheDocument();
    expect(screen.getByText('近畿')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Region collapse / expand
// ---------------------------------------------------------------------------

describe('ShrineListView – region collapse', () => {
  test('clicking region header hides prefecture list', () => {
    render(<ShrineListView {...defaultProps} />);
    fireEvent.click(screen.getByText('関東'));
    expect(screen.queryByText('埼玉県')).not.toBeInTheDocument();
    expect(screen.queryByText('氷川神社')).not.toBeInTheDocument();
  });

  test('clicking collapsed region header expands it again', () => {
    render(<ShrineListView {...defaultProps} />);
    fireEvent.click(screen.getByText('関東')); // collapse
    fireEvent.click(screen.getByText('関東')); // expand
    expect(screen.getByText('埼玉県')).toBeInTheDocument();
    expect(screen.getByText('氷川神社')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Prefecture collapse / expand
// ---------------------------------------------------------------------------

describe('ShrineListView – prefecture collapse', () => {
  test('clicking prefecture header hides shrine list', () => {
    render(<ShrineListView {...defaultProps} />);
    fireEvent.click(screen.getByText('埼玉県'));
    expect(screen.queryByText('氷川神社')).not.toBeInTheDocument();
  });

  test('clicking collapsed prefecture header expands it', () => {
    render(<ShrineListView {...defaultProps} />);
    fireEvent.click(screen.getByText('埼玉県')); // collapse
    fireEvent.click(screen.getByText('埼玉県')); // expand
    expect(screen.getByText('氷川神社')).toBeInTheDocument();
  });

  test('collapsing one prefecture does not affect another', () => {
    render(<ShrineListView {...defaultProps} />);
    fireEvent.click(screen.getByText('埼玉県'));
    // 神奈川県 and 寒川神社 should still be visible
    expect(screen.getByText('神奈川県')).toBeInTheDocument();
    expect(screen.getByText('寒川神社')).toBeInTheDocument();
  });

  test('expanding a region resets previously collapsed prefectures', () => {
    render(<ShrineListView {...defaultProps} />);
    fireEvent.click(screen.getByText('埼玉県'));   // collapse prefecture
    fireEvent.click(screen.getByText('関東'));      // collapse region
    fireEvent.click(screen.getByText('関東'));      // expand region → should reset prefecture collapse
    expect(screen.getByText('氷川神社')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

describe('ShrineListView – interactions', () => {
  test('clicking check button calls onToggleVisit with shrine.id', () => {
    const onToggleVisit = jest.fn();
    render(<ShrineListView {...defaultProps} onToggleVisit={onToggleVisit} />);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);
    expect(onToggleVisit).toHaveBeenCalledWith(expect.any(Number));
  });

  test('clicking shrine name calls onFocusShrine with the shrine object', () => {
    const onFocusShrine = jest.fn();
    render(<ShrineListView {...defaultProps} onFocusShrine={onFocusShrine} />);
    fireEvent.click(screen.getByText('氷川神社'));
    expect(onFocusShrine).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
});
