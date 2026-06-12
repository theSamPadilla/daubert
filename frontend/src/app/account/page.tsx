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
import { AgentActivitySection } from './AgentActivitySection';
import { ConnectedAgentsSection } from './ConnectedAgentsSection';

const inputClass =
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-white placeholder:text-ink-faint focus:outline-none focus:border-brand transition-colors';

const primaryBtn =
  'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-brand hover:bg-brand/90 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset] disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

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

  return (
    <div className="relative min-h-screen bg-surface text-white overflow-hidden">
      {/* faint grid overlay */}
      <div className="pointer-events-none absolute inset-0 bg-grid-faint -z-10" />
      <div className="pointer-events-none absolute -right-32 top-16 -z-10 opacity-[0.06] select-none">
        <Image src="/logo-light.png" alt="" width={720} height={720} priority />
      </div>

      {/* Header */}
      <header className="relative z-10 bg-surface-panel/70 backdrop-blur-md border-b border-line/60 h-14 px-5 flex items-center justify-between shrink-0">
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
          <Image src="/logo-light.png" alt="Daubert" width={26} height={26} priority />
          <h1 className="text-base font-semibold tracking-tight text-white">Daubert</h1>
        </Link>
        <UserMenu />
      </header>

      <main className="relative max-w-2xl mx-auto px-6 py-12">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-white transition-colors mb-8"
        >
          <FaArrowLeft size={10} />
          Back
        </button>

        <div className="mb-10">
          <div className="flex items-center gap-3">
            <span className="h-px w-8 bg-gradient-to-r from-brand-ink to-transparent" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
              You
            </span>
          </div>
          <h2 className="mt-3 text-4xl font-bold tracking-tight text-white">
            Account
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            Manage your profile information.
          </p>
        </div>

        <div className="relative p-6 rounded-xl bg-surface-panel border border-line-strong/60 shadow-[0_2px_12px_rgba(0,0,0,0.35)] overflow-hidden" id="profile-section">
          <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
          <h3 className="text-base font-semibold text-white mb-5">Profile</h3>

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm text-ink-muted mb-1">Email</label>
              <input
                type="email"
                value={user.email}
                disabled
                className={`${inputClass} text-ink-muted cursor-not-allowed opacity-70`}
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
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button type="submit" disabled={!dirty || saving} className={primaryBtn}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {saved && (
                <span className="flex items-center gap-1.5 text-sm text-emerald-400">
                  <FaCheck size={12} /> Saved
                </span>
              )}
            </div>
          </form>
        </div>

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
