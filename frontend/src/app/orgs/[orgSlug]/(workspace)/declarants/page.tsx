'use client';

import { useParams } from 'next/navigation';
import { useAuth } from '@/components/Auth/AuthProvider';
import { DeclarantsSection } from './DeclarantsSection';

export default function OrgDeclarantsPage() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const { user } = useAuth();
  const orgForThisPage = user?.orgs.find((o) => o.slug === orgSlug);
  const isAdmin = orgForThisPage?.role === 'admin';
  const currentUserId = user?.id ?? '';

  return <DeclarantsSection orgSlug={orgSlug} isAdmin={isAdmin} currentUserId={currentUserId} />;
}
