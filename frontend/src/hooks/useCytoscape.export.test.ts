/**
 * @jest-environment jsdom
 */

// Mock heavy transitive dependencies so this test can import useCytoscape.ts
// without needing firebase, fetch, cytoscape canvas, or html2canvas.
jest.mock('@/lib/api-client', () => ({ apiClient: {} }));
jest.mock('html2canvas', () => jest.fn());
jest.mock('cytoscape', () => jest.fn());
jest.mock('./cytoscapeStyle', () => ({ CYTOSCAPE_STYLE: [] }));
jest.mock('./cytoscapeEvents', () => ({ bindCytoscapeEvents: jest.fn() }));
jest.mock('./cytoscapeSync', () => ({ syncCytoscape: jest.fn() }));
jest.mock('./useCytoscapeOverlays', () => ({
  useCytoscapeOverlays: jest.fn(() => undefined),
}));
jest.mock('@/lib/exportTheme', () => ({ EXPORT_THEMES: {} }));

import { composeExport } from './useCytoscape';

function makeCanvas(width: number, height: number, fillColor?: string, dot?: { x: number; y: number; color: string }) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  if (fillColor) { ctx.fillStyle = fillColor; ctx.fillRect(0, 0, width, height); }
  if (dot) { ctx.fillStyle = dot.color; ctx.fillRect(dot.x, dot.y, 1, 1); }
  return c;
}

describe('composeExport', () => {
  it('produces a composite sized to the overlay (= bb + 2 * padding × scale)', () => {
    const baseCanvas = makeCanvas(200, 100, 'red');
    const overlayCanvas = makeCanvas(300, 200);
    const result = composeExport(baseCanvas, overlayCanvas, 50, 1);
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
  });

  it('draws the base PNG offset by (padding * scale, padding * scale)', () => {
    const baseCanvas = makeCanvas(2, 2, undefined, { x: 0, y: 0, color: 'red' });
    const overlayCanvas = makeCanvas(102, 102);
    const composite = composeExport(baseCanvas, overlayCanvas, 50, 1);
    const ctx = composite.getContext('2d')!;
    const pixel = ctx.getImageData(50, 50, 1, 1).data;
    expect(pixel[0]).toBe(255); // red
    expect(pixel[3]).toBe(255); // opaque
  });

  it('draws the overlay at (0, 0) on top of the base', () => {
    const baseCanvas = makeCanvas(2, 2, 'red');
    const overlayCanvas = makeCanvas(102, 102, undefined, { x: 50, y: 50, color: 'blue' });
    const composite = composeExport(baseCanvas, overlayCanvas, 50, 1);
    const ctx = composite.getContext('2d')!;
    const pixel = ctx.getImageData(50, 50, 1, 1).data;
    expect(pixel[2]).toBe(255); // blue from overlay covers base
  });

  it('scales the padding offset for the base PNG by `scale`', () => {
    const baseCanvas = makeCanvas(2, 2, 'red');
    const overlayCanvas = makeCanvas(204, 204);
    const composite = composeExport(baseCanvas, overlayCanvas, 50, 2);
    const ctx = composite.getContext('2d')!;
    expect(ctx.getImageData(99, 99, 1, 1).data[3]).toBe(0);     // outside base (transparent)
    expect(ctx.getImageData(100, 100, 1, 1).data[0]).toBe(255); // base starts here, red
  });
});
