'use client';

import { AuthGuard } from '@/components/AuthGuard';

export default function CaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthGuard>{children}</AuthGuard>;
}
