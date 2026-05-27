'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';

/**
 * Two-way sync between the `?inv=<id>` query param and the in-memory
 * `activeInvestigationId` state. Reading the URL is the source of truth on
 * mount + back/forward; setting via `selectInvestigation` updates both state
 * and the URL via router.push.
 */
export function useInvestigationUrlSync() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams();
  const caseId = params.caseId as string;

  const [activeInvestigationId, setActiveInvestigationId] = useState<string | null>(null);

  useEffect(() => {
    const invId = searchParams.get('inv');
    if (invId && invId !== activeInvestigationId) {
      setActiveInvestigationId(invId);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectInvestigation = useCallback((id: string) => {
    setActiveInvestigationId(id);
    router.push(`/cases/${caseId}/investigations?inv=${id}`, { scroll: false });
  }, [router, caseId]);

  const clearInvestigation = useCallback(() => {
    setActiveInvestigationId(null);
  }, []);

  return { caseId, activeInvestigationId, selectInvestigation, clearInvestigation };
}
