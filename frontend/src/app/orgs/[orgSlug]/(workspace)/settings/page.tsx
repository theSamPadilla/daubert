'use client';

import { useParams } from 'next/navigation';
import { useAuth } from '@/components/Auth/AuthProvider';
import { OrgInfoSection } from './OrgInfoSection';
import { MembersSection } from './MembersSection';
import { InvitesSection } from './InvitesSection';

export default function OrgSettingsPage() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const { user } = useAuth();
  const orgForThisPage = user?.orgs.find((o) => o.slug === orgSlug);
  const isAdmin = orgForThisPage?.role === 'admin';
  const currentUserId = user?.id ?? '';

  return (
    <>
      <OrgInfoSection orgSlug={orgSlug} isAdmin={isAdmin} />
      <MembersSection orgSlug={orgSlug} isAdmin={isAdmin} currentUserId={currentUserId} />
      {isAdmin && <InvitesSection orgSlug={orgSlug} />}
    </>
  );
}
