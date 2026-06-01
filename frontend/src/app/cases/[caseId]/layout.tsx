'use client';

import { useParams } from 'next/navigation';
import { AuthGuard } from '@/components/Auth/AuthGuard';
import { CaseProvider } from '@/contexts/CaseContext';

export default function CaseLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const caseId = params.caseId as string;
  return (
    <AuthGuard>
      <CaseProvider caseId={caseId}>{children}</CaseProvider>
    </AuthGuard>
  );
}
