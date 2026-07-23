'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaDownload, FaTrash, FaFolderOpen } from 'react-icons/fa6';
import { apiClient } from '@/lib/api-client';
import type { components } from '@/generated/api-types';
import { Loader } from '@/components/Common/Loader';
import { useConfirm } from '@/components/Common/ConfirmProvider';
import { Panel } from '@/components/ui/Panel';
import { Kicker } from '@/components/ui/Kicker';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';

type OrgFile = components['schemas']['OrgFile'];

// Human-readable byte size (mirrors DeclarantsSection's AttachmentsBlock).
function formatBytes(raw: string | undefined): string {
  if (!raw) return '—';
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function OrgFilesSection({
  orgSlug,
  isAdmin,
  currentUserId,
}: {
  orgSlug: string;
  isAdmin: boolean;
  currentUserId: string;
}) {
  const confirm = useConfirm();
  const [files, setFiles] = useState<OrgFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await apiClient.listOrgFiles(orgSlug);
      setFiles(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => {
    load();
  }, [load]);

  const canDelete = (file: OrgFile) => isAdmin || file.declarantUserId === currentUserId;

  const handleDownload = async (file: OrgFile) => {
    try {
      await apiClient.downloadDeclarantFile(orgSlug, file.declarantId, file.id, file.name);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  };

  const handleDelete = async (file: OrgFile) => {
    const ok = await confirm({
      title: 'Delete this file?',
      message: (
        <>
          Delete <span className="text-ink font-medium">{file.name}</span> attached to{' '}
          <span className="text-ink font-medium">{file.declarantName}</span>? This cannot be
          undone.
        </>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setBusyId(file.id);
    try {
      await apiClient.deleteDeclarantFile(orgSlug, file.declarantId, file.id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete file');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Panel padded className="mb-6">
      <Kicker className="block mb-1">Files</Kicker>
      <p className="text-xs text-ink-muted mb-5">
        All files stored at the organization level. Today that&apos;s declarant source files
        (CVs, prior declarations); more org file types will land here.
      </p>

      {error && (
        <div className="px-3 py-2 mb-4 rounded-lg border border-redline/30 bg-redline/5 text-sm text-redline">
          {error}
        </div>
      )}

      {loading ? (
        <Loader inline />
      ) : files.length === 0 ? (
        <EmptyState
          icon={<FaFolderOpen className="w-6 h-6 text-ink-faint/60" />}
          title="No files yet."
          body="Files attach to declarants from the Declarants tab: upload a CV or prior declaration there and it will show up here."
          className="py-8"
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full">
            <tbody>
              {files.map((file) => (
                <tr key={file.id} className="border-t border-line first:border-t-0">
                  <td className="px-4 py-3">
                    <p className="text-sm text-ink font-medium truncate">{file.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge tone="neutral">{file.kind === 'cv' ? 'CV' : 'Prior declaration'}</Badge>
                      <span className="text-xs text-ink-faint">{formatBytes(file.size)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-ink-muted">
                      Attached to <span className="text-ink">{file.declarantName}</span>
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-ink-faint">{formatDate(file.createdAt)}</span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleDownload(file)}
                      className="p-1.5 text-ink-faint hover:text-ink transition-colors"
                      title="Download file"
                      aria-label={`Download ${file.name}`}
                    >
                      <FaDownload size={12} />
                    </button>
                    {canDelete(file) && (
                      <button
                        type="button"
                        onClick={() => handleDelete(file)}
                        disabled={busyId === file.id}
                        className="p-1.5 text-ink-faint hover:text-redline transition-colors disabled:opacity-40"
                        title="Delete file"
                        aria-label={`Delete ${file.name}`}
                      >
                        <FaTrash size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
