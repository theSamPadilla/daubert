/**
 * @jest-environment jsdom
 *
 * Tests for the UI primitive component library.
 *
 * What we care about:
 * - Button: correct variant classes applied, disabled state, danger variant
 * - Modal: renders title + children in overlay with z-50, Escape closes it
 * - Kicker: font-mono + uppercase classes, index prop prefixes zero-padded "01 · "
 * - Badge: correct tone classes applied
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { Button } from './Button';
import { Modal } from './Modal';
import { Kicker } from './Kicker';
import { Badge } from './Badge';

// ─── Button ──────────────────────────────────────────────────────────────────

describe('Button', () => {
  it('primary renders with bg-brand class', () => {
    const { container } = render(<Button variant="primary">Click me</Button>);
    const btn = container.querySelector('button')!;
    expect(btn.className).toContain('bg-brand');
  });

  it('danger renders with bg-redline class', () => {
    const { container } = render(<Button variant="danger">Delete</Button>);
    const btn = container.querySelector('button')!;
    expect(btn.className).toContain('bg-redline');
  });

  it('disabled has disabled:opacity-60 class and is disabled', () => {
    const { container } = render(<Button disabled>Disabled</Button>);
    const btn = container.querySelector('button')!;
    expect(btn.className).toContain('disabled:opacity-60');
    expect(btn.disabled).toBe(true);
  });
});

// ─── Modal ───────────────────────────────────────────────────────────────────

describe('Modal', () => {
  it('renders title and children inside overlay with z-50 class', () => {
    const onClose = jest.fn();
    const { container } = render(
      <Modal open title="Test Modal" onClose={onClose}>
        <p>Modal content</p>
      </Modal>,
    );
    expect(screen.getByText('Test Modal')).toBeTruthy();
    expect(screen.getByText('Modal content')).toBeTruthy();
    // overlay should have z-50 class
    const overlay = container.firstElementChild as HTMLElement;
    expect(overlay.className).toContain('z-50');
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = jest.fn();
    render(
      <Modal open title="Esc Test" onClose={onClose}>
        <p>content</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render when open is false', () => {
    const onClose = jest.fn();
    const { container } = render(
      <Modal open={false} title="Hidden" onClose={onClose}>
        <p>should not appear</p>
      </Modal>,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ─── Kicker ──────────────────────────────────────────────────────────────────

describe('Kicker', () => {
  it('renders font-mono and uppercase classes', () => {
    const { container } = render(<Kicker>Section</Kicker>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('font-mono');
    expect(el.className).toContain('uppercase');
  });

  it('prefixes "01 · " when index={1}', () => {
    render(<Kicker index={1}>Section</Kicker>);
    expect(screen.getByText('01 · Section')).toBeTruthy();
  });

  it('prefixes "12 · " when index={12}', () => {
    render(<Kicker index={12}>Section</Kicker>);
    expect(screen.getByText('12 · Section')).toBeTruthy();
  });
});

// ─── Badge ───────────────────────────────────────────────────────────────────

describe('Badge', () => {
  it('tone brand has bg-brand-soft class', () => {
    const { container } = render(<Badge tone="brand">Beta</Badge>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('bg-brand-soft');
  });

  it('defaults to neutral tone (bg-surface-raised)', () => {
    const { container } = render(<Badge>Default</Badge>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('bg-surface-raised');
  });

  it('danger tone has bg-redline/10 class', () => {
    const { container } = render(<Badge tone="danger">Error</Badge>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('bg-redline/10');
  });
});
