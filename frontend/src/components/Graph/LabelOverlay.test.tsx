/**
 * @jest-environment jsdom
 */
import { render } from '@testing-library/react';
import { LabelOverlay } from './LabelOverlay';

it('renders external links with target="_blank" rel="noopener noreferrer"', () => {
  const { container } = render(<LabelOverlay text="[link](https://example.com)" />);
  const a = container.querySelector('a');
  expect(a).toBeTruthy();
  expect(a!.getAttribute('target')).toBe('_blank');
  expect(a!.getAttribute('rel')).toBe('noopener noreferrer');
  expect(a!.getAttribute('href')).toBe('https://example.com');
});

it('strips inline event handlers and script tags', () => {
  const { container } = render(
    <LabelOverlay text={`<img src=x onerror="alert(1)">\n\n<script>alert(1)</script>`} />,
  );
  expect(container.innerHTML).not.toContain('onerror');
  expect(container.innerHTML).not.toContain('<script');
});
