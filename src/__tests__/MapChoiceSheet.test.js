import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MapChoiceSheet from '../components/MapChoiceSheet';

const shrine = {
  id: 1,
  name: '氷川神社',
  lat: 35.8,
  lng: 139.6,
};

describe('MapChoiceSheet – content', () => {
  test('renders Google Maps link with correct coordinates', () => {
    render(<MapChoiceSheet shrine={shrine} onClose={jest.fn()} />);
    const link = screen.getByText('Google Maps').closest('a');
    expect(link.href).toContain('35.8');
    expect(link.href).toContain('139.6');
  });

  test('renders Apple Maps link with correct coordinates', () => {
    render(<MapChoiceSheet shrine={shrine} onClose={jest.fn()} />);
    const link = screen.getByText('Apple Maps').closest('a');
    expect(link.href).toContain('35.8');
    expect(link.href).toContain('139.6');
  });

  test('Apple Maps link encodes shrine name in query param', () => {
    render(<MapChoiceSheet shrine={shrine} onClose={jest.fn()} />);
    const link = screen.getByText('Apple Maps').closest('a');
    expect(link.href).toContain(encodeURIComponent('氷川神社'));
  });

  test('renders キャンセル button', () => {
    render(<MapChoiceSheet shrine={shrine} onClose={jest.fn()} />);
    expect(screen.getByText('キャンセル')).toBeInTheDocument();
  });

  test('both links open in a new tab', () => {
    render(<MapChoiceSheet shrine={shrine} onClose={jest.fn()} />);
    const links = screen.getAllByRole('link');
    links.forEach(link => expect(link).toHaveAttribute('target', '_blank'));
  });
});

describe('MapChoiceSheet – interactions', () => {
  test('calls onClose when キャンセル is clicked', () => {
    const onClose = jest.fn();
    render(<MapChoiceSheet shrine={shrine} onClose={onClose} />);
    fireEvent.click(screen.getByText('キャンセル'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('calls onClose when backdrop is clicked', () => {
    const onClose = jest.fn();
    const { container } = render(<MapChoiceSheet shrine={shrine} onClose={onClose} />);
    // The backdrop is the first div (fixed inset-0)
    const backdrop = container.querySelector('.fixed.inset-0.bg-black');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('calls onClose when Google Maps link is clicked', () => {
    const onClose = jest.fn();
    render(<MapChoiceSheet shrine={shrine} onClose={onClose} />);
    fireEvent.click(screen.getByText('Google Maps'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('calls onClose when Apple Maps link is clicked', () => {
    const onClose = jest.fn();
    render(<MapChoiceSheet shrine={shrine} onClose={onClose} />);
    fireEvent.click(screen.getByText('Apple Maps'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
