import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MergeConflictDialog from '../components/MergeConflictDialog';

const defaultDialog = {
  type: 'conflict',
  onlyLocalCount: 3,
  onlyCloudCount: 2,
  commonCount: 10,
};

describe('MergeConflictDialog', () => {
  test('renders nothing when dialog is null', () => {
    const { container } = render(
      <MergeConflictDialog dialog={null} onMergeAll={jest.fn()} onUseCloud={jest.fn()} onUseLocal={jest.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing when dialog.type is not "conflict"', () => {
    const { container } = render(
      <MergeConflictDialog
        dialog={{ type: 'other' }}
        onMergeAll={jest.fn()} onUseCloud={jest.fn()} onUseLocal={jest.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('renders conflict counts from dialog props', () => {
    render(
      <MergeConflictDialog dialog={defaultDialog} onMergeAll={jest.fn()} onUseCloud={jest.fn()} onUseLocal={jest.fn()} />
    );
    // Use exact match to avoid ambiguity with deletion-warning text
    expect(screen.getByText('3件')).toBeInTheDocument(); // onlyLocalCount
    expect(screen.getByText('2件')).toBeInTheDocument(); // onlyCloudCount
    expect(screen.getByText('10件')).toBeInTheDocument(); // commonCount
  });

  test('shows total count (sum of all three) in merge button', () => {
    render(
      <MergeConflictDialog dialog={defaultDialog} onMergeAll={jest.fn()} onUseCloud={jest.fn()} onUseLocal={jest.fn()} />
    );
    // total = 3 + 2 + 10 = 15
    expect(screen.getByText(/15件になります/)).toBeInTheDocument();
  });

  test('calls onMergeAll when merge button is clicked', () => {
    const onMergeAll = jest.fn();
    render(
      <MergeConflictDialog dialog={defaultDialog} onMergeAll={onMergeAll} onUseCloud={jest.fn()} onUseLocal={jest.fn()} />
    );
    fireEvent.click(screen.getByText('すべて合併する（推奨）'));
    expect(onMergeAll).toHaveBeenCalledTimes(1);
  });

  test('calls onUseCloud when cloud-only button is clicked', () => {
    const onUseCloud = jest.fn();
    render(
      <MergeConflictDialog dialog={defaultDialog} onMergeAll={jest.fn()} onUseCloud={onUseCloud} onUseLocal={jest.fn()} />
    );
    fireEvent.click(screen.getByText('クラウドのみ使用'));
    expect(onUseCloud).toHaveBeenCalledTimes(1);
  });

  test('calls onUseLocal when local-only button is clicked', () => {
    const onUseLocal = jest.fn();
    render(
      <MergeConflictDialog dialog={defaultDialog} onMergeAll={jest.fn()} onUseCloud={jest.fn()} onUseLocal={onUseLocal} />
    );
    fireEvent.click(screen.getByText('このデバイスのみ使用'));
    expect(onUseLocal).toHaveBeenCalledTimes(1);
  });

  test('shows deletion warning with correct onlyLocalCount in cloud button', () => {
    render(
      <MergeConflictDialog dialog={defaultDialog} onMergeAll={jest.fn()} onUseCloud={jest.fn()} onUseLocal={jest.fn()} />
    );
    expect(screen.getByText(/このデバイスの 3件 は削除されます/)).toBeInTheDocument();
  });

  test('shows deletion warning with correct onlyCloudCount in local button', () => {
    render(
      <MergeConflictDialog dialog={defaultDialog} onMergeAll={jest.fn()} onUseCloud={jest.fn()} onUseLocal={jest.fn()} />
    );
    expect(screen.getByText(/クラウドの 2件 は削除されます/)).toBeInTheDocument();
  });
});
