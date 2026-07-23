'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/Auth/AuthProvider';
import { Loader } from '@/components/Common/Loader';
import { OrgCasesAdminSection } from './OrgCasesAdminSection';

export default function OrgCasesPage() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const router = useRouter();
  const { user } = useAuth();
  const orgForThisPage = user?.orgs.find((o) => o.slug === orgSlug);
  const isAdmin = orgForThisPage?.role === 'admin';
  const orgId = orgForThisPage?.id;

  // Admin-only tab: non-admins (or org membership still resolving) get bounced
  // back to the Settings tab rather than seeing the cases-admin panel.
  useEffect(() => {
    if (orgForThisPage && !isAdmin) {
      router.replace(`/orgs/${orgSlug}/settings`);
    }
  }, [orgForThisPage, isAdmin, orgSlug, router]);

  if (!isAdmin || !orgId) {
    return <Loader inline />;
  }

  return <OrgCasesAdminSection orgId={orgId} />;
}
