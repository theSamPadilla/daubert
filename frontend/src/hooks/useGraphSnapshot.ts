'use client';
import { useCallback, useRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { createElement } from 'react';
import { GraphCanvas, type GraphCanvasHandle } from '@/components/GraphCanvas';
import type { Investigation } from '@/types/investigation';

/**
 * Capture a PNG snapshot of a Cytoscape graph by mounting <GraphCanvas> into
 * a hidden off-screen container. Returns a data URL on success.
 *
 * Container is fixed off-screen at 1400x900 — large enough that layout has
 * room to breathe; never painted to the visible viewport.
 */
export function useGraphSnapshot() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<Root | null>(null);

  const snapshot = useCallback(async (investigation: Investigation): Promise<string> => {
    // Tear down any prior root/host so each snapshot starts from a clean mount.
    if (rootRef.current) {
      rootRef.current.unmount();
      rootRef.current = null;
    }
    if (containerRef.current) {
      containerRef.current.remove();
      containerRef.current = null;
    }
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:-10000px;top:0;width:1400px;height:900px;pointer-events:none;';
    document.body.appendChild(el);
    containerRef.current = el;
    rootRef.current = createRoot(el);

    return new Promise<string>((resolve, reject) => {
      const handleRef = { current: null as GraphCanvasHandle | null };
      let raf = 0;
      const timeoutAt = performance.now() + 4_000; // hard cap

      const tryCapture = async () => {
        if (!handleRef.current) {
          raf = requestAnimationFrame(tryCapture);
          return;
        }
        // exportPngDataUrl (Task 17) reads cy.elements() internally; we need
        // to ensure they're loaded. Poll for non-empty elements by sniffing
        // the container — when Cytoscape has rendered, the inner <canvas>
        // exists with non-zero dimensions.
        const cnv = containerRef.current?.querySelector('canvas');
        if (!cnv || cnv.width === 0) {
          if (performance.now() > timeoutAt) {
            reject(new Error('Graph snapshot timed out — canvas not ready'));
            return;
          }
          raf = requestAnimationFrame(tryCapture);
          return;
        }
        try {
          const dataUrl = await handleRef.current.exportPngDataUrl();
          if (!dataUrl) reject(new Error('Snapshot failed: empty data URL'));
          else resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };

      rootRef.current!.render(
        createElement(GraphCanvas, {
          ref: (h: GraphCanvasHandle | null) => { handleRef.current = h; },
          investigation,
          selectedNodeIds: [],
          selectedEdgeIds: [],
          callbacks: {}, // CytoscapeCallbacks is a bag of optional handlers;
                        // empty object is fine for a snapshot-only mount.
        }),
      );

      raf = requestAnimationFrame(tryCapture);
      // Caller must call dispose() to clean up.
      void raf;
    });
  }, []);

  const dispose = useCallback(() => {
    if (rootRef.current) {
      rootRef.current.unmount();
      rootRef.current = null;
    }
    if (containerRef.current) {
      containerRef.current.remove();
      containerRef.current = null;
    }
  }, []);

  return { snapshot, dispose };
}
