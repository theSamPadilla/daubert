'use client';

import { useParams } from 'next/navigation';
import { useAuth } from '@/components/Auth/AuthProvider';
import { OrgFilesSection } from './OrgFilesSection';

export default function OrgFilesPage() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const { user } = useAuth();
  const orgForThisPage = user?.orgs.find((o) => o.slug === orgSlug);
  const isAdmin = orgForThisPage?.role === 'admin';
  const currentUserId = user?.id ?? '';

  return <OrgFilesSection orgSlug={orgSlug} isAdmin={isAdmin} currentUserId={currentUserId} />;
}
