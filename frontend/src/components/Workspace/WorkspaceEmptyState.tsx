'use client';

import { PageHeader } from '@/components/Common/PageHeader';
import { EmptyState } from '@/components/ui';
import UserMenu from '@/components/Auth/UserMenu';

export function WorkspaceEmptyState() {
  return (
    <>
      <PageHeader title="Investigations" rightContent={<UserMenu />} />
      <div className="flex-1 flex items-center justify-center bg-surface p-6">
        <EmptyState
          icon={
            <img
              src="/logo-light.png"
              alt=""
              aria-hidden="true"
              draggable={false}
              className="h-20 w-20 select-none opacity-90"
            />
          }
          title="Daubert"
          body="Select or create an investigation to begin"
        />
      </div>
    </>
  );
}
