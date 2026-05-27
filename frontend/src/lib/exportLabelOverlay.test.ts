/**
 * @jest-environment jsdom
 */
import { renderExportLabelOverlay } from './exportLabelOverlay';
import { EXPORT_PADDING } from './labelGeometry';
import type { TraceLabel } from '@/types/investigation';

function makeFakeCy(opts: {
  bb: { x1: number; y1: number; x2: number; y2: number; w: number; h: number };
  nodes?: Record<string, { x: number; y: number }>;
}) {
  return {
    getElementById: (id: string) => {
      const pos = opts.nodes?.[id];
      if (!pos) return { length: 0 } as any;
      return {
        length: 1,
        isNode: () => true,
        isEdge: () => false,
        position: () => pos,
      } as any;
    },
    edges: () => ({ filter: () => [] }),
  } as any;
}

const BB_DEFAULT = { x1: 0, y1: 0, x2: 1000, y2: 500, w: 1000, h: 500 };

describe('renderExportLabelOverlay', () => {
  it('sizes the overlay to bb + 2 * padding', () => {
    const cy = makeFakeCy({ bb: BB_DEFAULT });
    const result = renderExportLabelOverlay(cy, [], BB_DEFAULT, EXPORT_PADDING);
    expect(result.overlayEl.style.width).toBe('1100px');
    expect(result.overlayEl.style.height).toBe('600px');
    result.dispose();
  });

  it('positions the overlay onscreen-but-hidden (position:fixed, z-index:-1, opacity:0)', () => {
    const cy = makeFakeCy({ bb: BB_DEFAULT });
    const result = renderExportLabelOverlay(cy, [], BB_DEFAULT, EXPORT_PADDING);
    // position:fixed at (0,0) keeps the overlay's bounding rect inside the
    // viewport so foreignObjectRendering's SVG viewBox captures it correctly.
    // z-index:-1 + opacity:0 keep it visually hidden until the caller flips
    // opacity to 1 for the duration of the html2canvas capture.
    expect(result.overlayEl.style.position).toBe('fixed');
    expect(result.overlayEl.style.top).toBe('0px');
    expect(result.overlayEl.style.left).toBe('0px');
    expect(result.overlayEl.style.zIndex).toBe('-1');
    expect(result.overlayEl.style.opacity).toBe('0');
    result.dispose();
  });

  it('appends one child wrapper per resolvable label', () => {
    const cy = makeFakeCy({ bb: BB_DEFAULT, nodes: { n1: { x: 200, y: 100 } } });
    const labels: { traceId: string; label: TraceLabel }[] = [
      { traceId: 't', label: { id: 'L1', text: 'Foundation', anchor: { type: 'node', anchorId: 'n1', dx: 0, dy: 0 } } },
      { traceId: 't', label: { id: 'L2', text: 'Free', anchor: { type: 'free', x: 50, y: 50 } } },
    ];
    const result = renderExportLabelOverlay(cy, labels, BB_DEFAULT, EXPORT_PADDING);
    expect(result.overlayEl.querySelectorAll('.label-wrapper').length).toBe(2);
    result.dispose();
  });

  it('positions a node-anchored label at model + dx/dy + padding offset', () => {
    const cy = makeFakeCy({ bb: BB_DEFAULT, nodes: { n1: { x: 200, y: 100 } } });
    const labels = [{
      traceId: 't',
      label: { id: 'L1', text: 'x', anchor: { type: 'node' as const, anchorId: 'n1', dx: 10, dy: -20 } },
    }];
    const result = renderExportLabelOverlay(cy, labels, BB_DEFAULT, EXPORT_PADDING);
    const wrapper = result.overlayEl.querySelector('.label-wrapper') as HTMLElement;
    expect(wrapper.style.left).toBe('260px'); // 200 + 10 + 50
    expect(wrapper.style.top).toBe('130px');  // 100 - 20 + 50
    result.dispose();
  });

  it('position is independent of cy.zoom() and cy.pan() (the bug regression)', () => {
    const cyA: any = {
      zoom: () => 1, pan: () => ({ x: 0, y: 0 }),
      getElementById: () => ({
        length: 1, isNode: () => true, isEdge: () => false, position: () => ({ x: 300, y: 200 }),
      }),
      edges: () => ({ filter: () => [] }),
    };
    const cyB: any = {
      zoom: () => 0.4, pan: () => ({ x: 999, y: -500 }),
      getElementById: cyA.getElementById,
      edges: cyA.edges,
    };
    const labels = [{
      traceId: 't',
      label: { id: 'L1', text: 'x', anchor: { type: 'node' as const, anchorId: 'n1', dx: 0, dy: 0 } },
    }];
    const a = renderExportLabelOverlay(cyA, labels, BB_DEFAULT, EXPORT_PADDING);
    const b = renderExportLabelOverlay(cyB, labels, BB_DEFAULT, EXPORT_PADDING);
    const wA = a.overlayEl.querySelector('.label-wrapper') as HTMLElement;
    const wB = b.overlayEl.querySelector('.label-wrapper') as HTMLElement;
    expect(wA.style.left).toBe(wB.style.left);
    expect(wA.style.top).toBe(wB.style.top);
    a.dispose(); b.dispose();
  });

  it('skips labels whose anchor cannot be resolved', () => {
    const cy = makeFakeCy({ bb: BB_DEFAULT });
    const labels = [{
      traceId: 't',
      label: { id: 'L1', text: 'x', anchor: { type: 'node' as const, anchorId: 'gone', dx: 0, dy: 0 } },
    }];
    const result = renderExportLabelOverlay(cy, labels, BB_DEFAULT, EXPORT_PADDING);
    expect(result.overlayEl.querySelectorAll('.label-wrapper').length).toBe(0);
    result.dispose();
  });

  it('dispose() removes the overlay element AND unmounts each label React root', () => {
    const cy = makeFakeCy({ bb: BB_DEFAULT, nodes: { n1: { x: 100, y: 100 } } });
    const labels = [{
      traceId: 't',
      label: { id: 'L1', text: '**bold**', anchor: { type: 'node' as const, anchorId: 'n1', dx: 0, dy: 0 } },
    }];
    const result = renderExportLabelOverlay(cy, labels, BB_DEFAULT, EXPORT_PADDING);
    // flushSync forces synchronous commit — DOM should already contain the <strong>.
    expect(result.overlayEl.querySelector('strong')?.textContent).toBe('bold');

    expect(document.body.contains(result.overlayEl)).toBe(true);
    result.dispose();
    expect(document.body.contains(result.overlayEl)).toBe(false);
    // Re-disposing is idempotent in our impl.
    expect(() => result.dispose()).not.toThrow();
  });
});
