'use client';

import { CaseShell } from '@/components/Workspace/CaseShell';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <CaseShell>{children}</CaseShell>;
}
