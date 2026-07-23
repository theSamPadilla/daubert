'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOrgContext } from '@/contexts/OrgContext';
import { apiClient } from '@/lib/api-client';
import { Panel } from '@/components/ui/Panel';
import { Kicker } from '@/components/ui/Kicker';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Banner } from './Banner';

export function OrgInfoSection({
  orgSlug,
  isAdmin,
}: {
  orgSlug: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { setActiveOrgSlug } = useOrgContext();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.getOrg(orgSlug).then((o) => {
      setName(o.name);
      setSlug(o.slug);
    }).catch((e: Error) => setError(e.message));
  }, [orgSlug]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const updated = await apiClient.updateOrg(orgSlug, { name, slug });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      if (updated.slug !== orgSlug) {
        setActiveOrgSlug(updated.slug);
        router.replace(`/orgs/${updated.slug}/settings`);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel padded className="mb-6">
      <Kicker index={1} className="block mb-3">Organization info</Kicker>
      {error && <Banner message={error} onClose={() => setError(null)} />}
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm text-ink-muted mb-1">Name</label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isAdmin}
          />
        </div>
        <div>
          <label className="block text-sm text-ink-muted mb-1">Slug</label>
          <Input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={!isAdmin}
            className="font-mono"
          />
          {isAdmin && (
            <p className="mt-1 text-xs text-ink-faint">
              Changing the slug will update the URL and break any existing links.
            </p>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="submit"
              disabled={saving || !name.trim() || !slug.trim()}
            >
              {saving ? 'Saving...' : saved ? 'Saved' : 'Save changes'}
            </Button>
          </div>
        )}
      </form>
    </Panel>
  );
}
