'use client';

import { AuthGuard } from '@/components/Auth/AuthGuard';

export default function EntitiesLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}
