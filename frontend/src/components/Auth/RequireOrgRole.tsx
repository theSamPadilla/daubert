'use client';

import { ReactNode } from 'react';
import { useOrgContext } from '@/contexts/OrgContext';
import type { OrgMemberRole } from '@/lib/api-client';

const ROLE_RANK: Record<OrgMemberRole, number> = {
  guest: 0,
  member: 1,
  admin: 2,
};

interface RequireOrgRoleProps {
  minRole: OrgMemberRole;
  children: ReactNode;
}

/**
 * Client-side org-role gate. Reads the active org from OrgContext.
 * - No active org: renders an "Org not selected" panel.
 * - Active org role below minRole: renders an "Access Denied" panel.
 * - Otherwise: renders children.
 */
export function RequireOrgRole({ minRole, children }: RequireOrgRoleProps) {
  const { activeOrg } = useOrgContext();

  if (!activeOrg) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="max-w-sm text-center space-y-4">
          <h2 className="text-xl font-bold text-ink">No Organization Selected</h2>
          <p className="text-ink-muted">
            Select an organization to continue.
          </p>
        </div>
      </div>
    );
  }

  if (ROLE_RANK[activeOrg.role] < ROLE_RANK[minRole]) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="max-w-sm text-center space-y-4">
          <h2 className="text-xl font-bold text-ink">Access Denied</h2>
          <p className="text-ink-muted">
            You need at least <strong>{minRole}</strong> access in this organization.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
