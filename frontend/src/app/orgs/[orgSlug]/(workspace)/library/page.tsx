'use client';

import { useParams } from 'next/navigation';
import { DeclarationLibrarySection } from './DeclarationLibrarySection';

export default function OrgLibraryPage() {
  const params = useParams();
  const orgSlug = params.orgSlug as string;

  return <DeclarationLibrarySection orgSlug={orgSlug} />;
}
