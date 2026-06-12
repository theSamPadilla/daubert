'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { FaArrowLeft, FaCheck } from 'react-icons/fa6';
import { AuthGuard } from '@/components/Auth/AuthGuard';
import { useAuth } from '@/components/Auth/AuthProvider';
import UserMenu from '@/components/Auth/UserMenu';
import { apiClient } from '@/lib/api-client';
import { Button, Panel, Kicker } from '@/components/ui';
import { AgentActivitySection } from './AgentActivitySection';
import { ConnectedAgentsSection } from './ConnectedAgentsSection';

function AccountInner() {
  const router = useRouter();
  const { user, refreshMe } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync local input if user loads after mount (refresh, initial fetch race).
  useEffect(() => {
    if (user?.name && !saved) setName(user.name);
    // We intentionally only re-sync when `user` arrives, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user) return null;

  const trimmed = name.trim();
  const dirty = trimmed.length > 0 && trimmed !== user.name;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      await apiClient.updateMe({ name: trimmed });
      await refreshMe();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus:border-brand transition-colors';

  return (
    <div className="relative min-h-screen bg-surface overflow-hidden">
      {/* Header — website nav pattern */}
      <header className="sticky top-0 z-10 bg-surface/80 backdrop-blur-md border-b border-line h-14 px-5 flex items-center justify-between shrink-0">
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
          <Image src="/logo.png" alt="Daubert" width={26} height={26} priority />
          <h1 className="text-base font-semibold tracking-tight text-ink">Daubert</h1>
        </Link>
        <UserMenu />
      </header>

      <main className="relative max-w-4xl mx-auto px-6 py-12">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors mb-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded"
        >
          <FaArrowLeft size={10} />
          Back
        </button>

        <div className="mb-10">
          <Kicker>You</Kicker>
          <h2 className="mt-3 text-4xl font-bold tracking-tight text-ink">
            Account
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            Manage your profile information.
          </p>
        </div>

        <Panel padded className="mb-0" id="profile-section">
          <h3 className="text-base font-semibold text-ink mb-5">Profile</h3>

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm text-ink-muted mb-1">Email</label>
              <input
                type="email"
                value={user.email}
                disabled
                className={`${inputClass} text-ink-faint cursor-not-allowed opacity-70`}
              />
              <p className="mt-1 text-xs text-ink-faint">
                Tied to your sign-in identity. Contact support to change it.
              </p>
            </div>

            <div>
              <label className="block text-sm text-ink-muted mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                required
                className={inputClass}
                placeholder="Your name"
              />
              <p className="mt-1 text-xs text-ink-faint">
                This is what teammates see in case + org member lists.
              </p>
            </div>

            {error && (
              <div className="rounded-lg border border-redline/30 bg-redline/8 px-3 py-2 text-sm text-redline">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={!dirty || saving} size="sm">
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
              {saved && (
                <span className="flex items-center gap-1.5 text-sm text-accent">
                  <FaCheck size={12} /> Saved
                </span>
              )}
            </div>
          </form>
        </Panel>

        <ConnectedAgentsSection />
        <AgentActivitySection />
      </main>
    </div>
  );
}

export default function AccountPage() {
  return (
    <AuthGuard>
      <AccountInner />
    </AuthGuard>
  );
}
