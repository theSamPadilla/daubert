'use client';

import { PageHeader } from '@/components/Common/PageHeader';
import UserMenu from '@/components/Auth/UserMenu';

export function WorkspaceEmptyState() {
  return (
    <>
      <PageHeader title="Investigations" rightContent={<UserMenu />} />
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="flex flex-col items-center text-center">
          <img
            src="/logo-light.png"
            alt=""
            aria-hidden="true"
            draggable={false}
            className="h-20 w-20 select-none mb-4 opacity-90"
          />
          <h2 className="text-2xl font-bold mb-2">Daubert</h2>
          <p className="text-ink-faint">Select or create an investigation to begin</p>
        </div>
      </div>
    </>
  );
}
