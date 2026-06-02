'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaArrowLeft, FaCheck } from 'react-icons/fa6';
import { AuthGuard } from '@/components/Auth/AuthGuard';
import { useAuth } from '@/components/Auth/AuthProvider';
import { apiClient } from '@/lib/api-client';

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
    <div className="min-h-screen bg-surface text-white">
      <div className="sticky top-0 z-10 bg-surface border-b border-line-strong px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-ink-muted hover:text-white transition-colors"
        >
          <FaArrowLeft size={12} />
          Back
        </button>
        <h1 className="text-base font-semibold text-white">Account</h1>
      </div>

      <div className="max-w-xl mx-auto px-6 py-8">
        <p className="text-sm text-ink-muted mb-6">Manage your profile information.</p>

        <div className="rounded-lg border border-line-strong bg-surface-panel p-6 space-y-5">
          <h2 className="text-base font-semibold text-white">Profile</h2>

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm text-ink-muted mb-1">Email</label>
              <input
                type="email"
                value={user.email}
                disabled
                className="w-full rounded border border-line-strong bg-surface px-3 py-2 text-sm text-ink-muted cursor-not-allowed"
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
                className="w-full rounded border border-line-strong bg-surface px-3 py-2 text-sm text-white placeholder-ink-muted focus:outline-none focus:border-brand"
                placeholder="Your name"
              />
              <p className="mt-1 text-xs text-ink-faint">
                This is what teammates see in case + org member lists.
              </p>
            </div>

            {error && (
              <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={!dirty || saving}
                className="px-3 py-1.5 rounded bg-brand hover:bg-brand/90 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              {saved && (
                <span className="flex items-center gap-1.5 text-sm text-green-400">
                  <FaCheck size={12} /> Saved
                </span>
              )}
            </div>
          </form>
        </div>
      </div>
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
