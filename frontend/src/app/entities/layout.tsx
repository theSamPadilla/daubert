'use client';

import { AuthGuard } from '@/components/AuthGuard';

export default function EntitiesLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}
