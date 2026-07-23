'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaPlus, FaTrash, FaUserTie } from 'react-icons/fa6';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { Loader } from '@/components/Common/Loader';
import { useConfirm } from '@/components/Common/ConfirmProvider';
import { Panel } from '@/components/ui/Panel';
import { Kicker } from '@/components/ui/Kicker';
import { Badge } from '@/components/ui/Badge';
import { DeclarantModal, type DeclarantDto } from '@/components/Declarants/DeclarantModal';

type Declarant = components['schemas']['Declarant'];
type CreateDeclarantRequest = components['schemas']['CreateDeclarantRequest'];
type UpdateDeclarantRequest = components['schemas']['UpdateDeclarantRequest'];

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function DeclarantsSection({
  orgSlug,
  isAdmin,
  currentUserId,
}: {
  orgSlug: string;
  isAdmin: boolean;
  currentUserId: string;
}) {
  const confirm = useConfirm();
  const [declarants, setDeclarants] = useState<Declarant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Declarant | null | 'new'>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await apiClient.listDeclarants(orgSlug);
      setDeclarants(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load declarants');
    } finally {
      setLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => { load(); }, [load]);

  const canEdit = (d: Declarant) => isAdmin || d.userId === currentUserId;

  // Persist the declarant. Returns the created declarant on create (so the modal
  // can attach the uploaded source file afterwards), or null on edit. Refreshing
  // the list happens here; the modal closes itself once any attach completes.
  const handleSave = async (dto: DeclarantDto): Promise<Declarant | null> => {
    if (editing && editing !== 'new') {
      const patch: UpdateDeclarantRequest = {
        displayName: dto.displayName,
        title: dto.title ?? null,
        firm: dto.firm ?? null,
        cvExhibit: dto.cvExhibit ?? null,
        hourlyRate: dto.hourlyRate ?? null,
        nonContingencyDisclosure: dto.nonContingencyDisclosure ?? null,
        dateOfBirth: dto.dateOfBirth ?? null,
        address: dto.address ?? null,
        priorTestimony: dto.priorTestimony,
        qualifications: dto.qualifications,
      };
      await apiClient.updateDeclarant(orgSlug, editing.id, patch);
      await load();
      return null;
    }

    const create: CreateDeclarantRequest = {
      displayName: dto.displayName,
      title: dto.title,
      firm: dto.firm,
      cvExhibit: dto.cvExhibit,
      hourlyRate: dto.hourlyRate,
      nonContingencyDisclosure: dto.nonContingencyDisclosure,
      dateOfBirth: dto.dateOfBirth,
      address: dto.address,
      priorTestimony: dto.priorTestimony,
      qualifications: dto.qualifications,
      userId: dto.userId,
    };
    const created = await apiClient.createDeclarant(orgSlug, create);
    await load();
    return created;
  };

  const handleDelete = async (declarant: Declarant) => {
    const ok = await confirm({
      title: 'Delete this declarant?',
      message: <>Delete <span className="text-ink font-medium">{declarant.displayName}</span> from this organization? This cannot be undone.</>,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiClient.deleteDeclarant(orgSlug, declarant.id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete declarant');
    }
  };

  return (
    <Panel padded className="mb-6">
      <div className="flex items-center justify-between mb-1">
        <Kicker className="block">Declarants</Kicker>
        <button
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors"
        >
          <FaPlus size={10} />
          New declarant
        </button>
      </div>
      <p className="text-xs text-ink-muted mb-5">
        Reusable expert profiles: name, credentials, and qualifications paragraphs that any
        case in this organization can insert into a declaration.
      </p>

      {error && (
        <div className="px-3 py-2 mb-4 rounded-lg border border-redline/30 bg-redline/5 text-sm text-redline">
          {error}
        </div>
      )}

      {loading ? (
        <Loader inline />
      ) : declarants.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-8">
          <FaUserTie className="w-6 h-6 text-ink-faint/60 mb-2" />
          <p className="text-sm text-ink-muted">No declarants yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full">
            <tbody>
              {declarants.map((declarant) => {
                const editable = canEdit(declarant);
                const subtitle = [declarant.title, declarant.firm].filter(Boolean).join(' · ');
                return (
                  <tr key={declarant.id} className="border-t border-line first:border-t-0">
                    <td className="px-4 py-3">
                      {editable ? (
                        <button
                          type="button"
                          onClick={() => setEditing(declarant)}
                          className="text-sm text-ink font-medium hover:text-brand transition-colors text-left"
                        >
                          {declarant.displayName}
                        </button>
                      ) : (
                        <span className="text-sm text-ink font-medium">{declarant.displayName}</span>
                      )}
                      {subtitle && <p className="text-[13px] text-ink-muted">{subtitle}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {declarant.userId === currentUserId && <Badge tone="accent">You</Badge>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editable && (
                        <button
                          onClick={() => handleDelete(declarant)}
                          className="p-1.5 text-ink-faint hover:text-redline transition-colors"
                          title="Delete declarant"
                          aria-label={`Delete declarant ${declarant.displayName}`}
                        >
                          <FaTrash size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <DeclarantModal
          declarant={editing === 'new' ? null : editing}
          orgSlug={orgSlug}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </Panel>
  );
}
