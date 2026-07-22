'use client';

import { useEffect, useState } from 'react';
import { FaTriangleExclamation } from 'react-icons/fa6';
import { apiClient } from '@/lib/api-client';

interface DeclarationPreviewPaneProps {
  productionId: string;
  /**
   * Bump this to force a re-fetch of the rendered preview (e.g. after a save
   * settles). The pane fetches on mount and whenever this value changes.
   */
  refreshKey?: number;
}

/**
 * Renders the backend's faithful declaration layout (the same HTML the PDF/DOCX
 * export uses) in a sandboxed iframe. `sandbox="allow-same-origin"` lets the
 * document's own inline styles apply while blocking scripts, forms, top-level
 * navigation, and popups from the untrusted-by-default srcDoc.
 */
export function DeclarationPreviewPane({ productionId, refreshKey = 0 }: DeclarationPreviewPaneProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .getDeclarationPreview(productionId)
      .then((markup) => {
        if (cancelled) return;
        setHtml(markup);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load declaration preview:', err);
        setError('Could not load the preview. Try saving again or reloading.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productionId, refreshKey]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-redline">
          <FaTriangleExclamation className="w-4 h-4 shrink-0" />
          {error}
        </div>
      </div>
    );
  }

  if (loading && html === null) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-ink-muted">
        Loading preview…
      </div>
    );
  }

  return (
    <iframe
      title="Declaration preview"
      srcDoc={html ?? ''}
      sandbox="allow-same-origin"
      className="w-full h-full border-0 bg-white rounded"
    />
  );
}
