'use client';
import { useEffect, useRef, useState } from 'react';
import { FaSpinner } from 'react-icons/fa6';
import type { ExportTheme } from '@/lib/exportTheme';

interface Props {
  theme: ExportTheme;
  generate: (theme: ExportTheme) => Promise<string>;
}

export function ExportPreview({ theme, generate }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Partial<Record<ExportTheme, string>>>({});
  const reqIdRef = useRef(0);

  useEffect(() => {
    const cached = cacheRef.current[theme];
    if (cached) {
      setDataUrl(cached);
      setError(null);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    generate(theme)
      .then((url) => {
        if (reqId !== reqIdRef.current) return; // stale
        cacheRef.current[theme] = url;
        setDataUrl(url);
      })
      .catch((err) => {
        if (reqId !== reqIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Preview failed');
      })
      .finally(() => {
        if (reqId !== reqIdRef.current) return;
        setLoading(false);
      });
  }, [theme, generate]);

  return (
    <div className="flex h-full w-full items-center justify-center rounded border border-line-strong bg-surface overflow-hidden">
      {loading && (
        <div className="flex flex-col items-center gap-2 text-ink-muted text-xs">
          <FaSpinner className="animate-spin" />
          <span>Rendering preview…</span>
        </div>
      )}
      {!loading && error && (
        <div className="px-4 text-center text-xs text-red-300">Preview failed: {error}</div>
      )}
      {!loading && !error && dataUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt="Export preview" className="max-h-full max-w-full object-contain" />
      )}
    </div>
  );
}
