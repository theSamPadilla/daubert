'use client';

import { AuthGuard } from '@/components/AuthGuard';

export default function DataRoomLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}
