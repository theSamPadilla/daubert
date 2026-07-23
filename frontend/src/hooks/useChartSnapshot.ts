'use client';
import { useCallback, useRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { createElement } from 'react';
import { ChartViewer } from '@/components/Productions/ChartViewer';
import { EXPORT_THEMES, type ExportTheme } from '@/lib/exportTheme';

export function useChartSnapshot() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<Root | null>(null);

  const snapshot = useCallback(async (
    chartData: any,
    theme: ExportTheme = 'dark',
    height: number = 600,
  ): Promise<string> => {
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
    el.style.cssText = `position:fixed;left:-10000px;top:0;width:1000px;height:${height}px;pointer-events:none;`;
    document.body.appendChild(el);
    containerRef.current = el;
    rootRef.current = createRoot(el);

    // Chart.js renders its canvas synchronously on mount, but the actual draw
    // happens over ~1 second of animation. Capturing on the first RAF after
    // canvas-appears returns a blank PNG. Disable animation so Chart.js draws
    // synchronously during its init effect; we then wait one extra RAF after
    // detecting the canvas so the synchronous draw has been painted.
    const snapshotData = {
      ...chartData,
      options: {
        ...(chartData?.options ?? {}),
        animation: false as const,
        // Skip transitions for the same reason — any animated state change
        // during capture would race the toDataURL read.
        transitions: { active: { animation: { duration: 0 } } },
      },
    };

    return new Promise<string>((resolve, reject) => {
      let raf = 0;
      let postCanvasWait = false;
      const timeoutAt = performance.now() + 4_000;
      const tryCapture = () => {
        const canvas = containerRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
        if (!canvas || canvas.width === 0) {
          if (performance.now() > timeoutAt) {
            reject(new Error('Chart snapshot timed out: canvas not ready'));
            return;
          }
          raf = requestAnimationFrame(tryCapture);
          return;
        }
        if (!postCanvasWait) {
          // Canvas exists but Chart.js may have just committed; let its init
          // effect run and one paint complete before we read pixels.
          postCanvasWait = true;
          raf = requestAnimationFrame(tryCapture);
          return;
        }
        try {
          // Chart.js renders onto a transparent canvas. Composite onto the
          // theme's PNG background so exports match the in-app canvas color
          // instead of producing a transparent PNG.
          const bg = EXPORT_THEMES[theme].pngBackground;
          const out = document.createElement('canvas');
          out.width = canvas.width;
          out.height = canvas.height;
          const ctx = out.getContext('2d');
          if (!ctx) {
            resolve(canvas.toDataURL('image/png'));
            return;
          }
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, out.width, out.height);
          ctx.drawImage(canvas, 0, 0);
          resolve(out.toDataURL('image/png'));
        } catch (err) {
          reject(err);
        }
      };
      rootRef.current!.render(createElement(ChartViewer, { data: snapshotData, theme }));
      raf = requestAnimationFrame(tryCapture);
      void raf;
    });
  }, []);

  const dispose = useCallback(() => {
    if (rootRef.current) { rootRef.current.unmount(); rootRef.current = null; }
    if (containerRef.current) { containerRef.current.remove(); containerRef.current = null; }
  }, []);

  return { snapshot, dispose };
}
