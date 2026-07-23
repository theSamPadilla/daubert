'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader } from '@/components/Common/Loader';

export default function OrgIndexPage() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;
  const router = useRouter();

  useEffect(() => {
    router.replace(`/orgs/${orgSlug}/settings`);
  }, [orgSlug, router]);

  return <Loader inline />;
}
