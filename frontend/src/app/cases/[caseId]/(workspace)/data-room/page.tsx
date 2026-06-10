'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { FaCloudArrowUp, FaDownload, FaTrash } from 'react-icons/fa6';
import { apiClient, type DataRoomFile } from '@/lib/api-client';
import { Loader } from '@/components/Common/Loader';
import { PageHeader } from '@/components/Common/PageHeader';
import UserMenu from '@/components/Auth/UserMenu';
import { useCaseContext } from '@/contexts/CaseContext';

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

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export default function DataRoomPage() {
  const params = useParams();
  const caseId = params.caseId as string;
  const { viewerRole } = useCaseContext();
  const canMutate = viewerRole === 'owner' || viewerRole === 'editor';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<DataRoomFile[]>([]);

  // Upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ loaded: number; total: number } | null>(
    null,
  );

  const fetchFiles = useCallback(async () => {
    try {
      const list = await apiClient.dataRoomListFiles(caseId);
      setFiles(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list files');
    }
  }, [caseId]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await fetchFiles();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchFiles]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so selecting the same file again triggers another change.
    if (e.target) e.target.value = '';
    if (!file) return;

    setError(null);
    setUploadingName(file.name);
    setUploadProgress({ loaded: 0, total: file.size });

    try {
      await apiClient.dataRoomUpload(caseId, file, (loaded, total) => {
        setUploadProgress({ loaded, total });
      });
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingName(null);
      setUploadProgress(null);
    }
  };

  const handleDownload = async (file: DataRoomFile) => {
    try {
      await apiClient.dataRoomDownload(caseId, file.id, file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const handleDelete = async (file: DataRoomFile) => {
    if (!confirm(`Delete "${file.name}"? This cannot be undone.`)) return;
    try {
      await apiClient.dataRoomDeleteFile(caseId, file.id);
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  // ----------------------------- Render -----------------------------

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <PageHeader
        title="Data Room"
        rightContent={<UserMenu variant="light" />}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto">
          {/* Error banner */}
          {error && (
            <div className="mb-4 p-3 rounded bg-red-900/40 border border-red-800/60 text-red-200 text-sm flex items-center justify-between">
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                className="text-red-300 hover:text-red-100 text-xs"
              >
                Dismiss
              </button>
            </div>
          )}

          {loading ? (
            <Loader inline />
          ) : (
            <>
              {/* Upload controls */}
              {canMutate && (
                <div className="mb-4 flex items-center gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleUploadFile}
                    className="hidden"
                  />
                  <button
                    onClick={handleUploadClick}
                    disabled={uploadingName !== null}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-sm bg-brand hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed text-white"
                  >
                    <FaCloudArrowUp className="w-3.5 h-3.5" /> Upload file
                  </button>
                  <p className="text-xs text-ink-faint ml-auto">Max 50MB per upload.</p>
                </div>
              )}

              {/* Upload progress */}
              {uploadingName && uploadProgress && (
                <div className="mb-4 p-3 rounded bg-surface-panel border border-line-strong">
                  <div className="flex items-center justify-between mb-2 text-sm">
                    <span className="text-ink-muted truncate">Uploading {uploadingName}</span>
                    <span className="text-ink-muted ml-2 shrink-0">
                      {formatBytes(String(uploadProgress.loaded))} /{' '}
                      {formatBytes(String(uploadProgress.total))}
                    </span>
                  </div>
                  <div className="h-1.5 bg-surface-raised rounded overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{
                        width: uploadProgress.total
                          ? `${Math.min(100, (uploadProgress.loaded / uploadProgress.total) * 100)}%`
                          : '0%',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* File table / empty state */}
              {files.length === 0 ? (
                <div className="text-center py-12 text-ink-muted text-sm">
                  No files yet.{canMutate ? ' Upload one to get started.' : ''}
                </div>
              ) : (
                <div className="rounded-lg border border-line-strong overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-surface-panel/50 text-left text-sm text-ink-muted">
                        <th className="px-4 py-3">Name</th>
                        <th className="px-4 py-3 w-24">Size</th>
                        <th className="px-4 py-3 w-44">Uploaded</th>
                        <th className="px-4 py-3 w-24">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((file) => (
                        <tr
                          key={file.id}
                          className="border-b border-line-strong/50 hover:bg-surface-panel/40"
                        >
                          <td className="px-4 py-3 text-sm text-white">{file.name}</td>
                          <td className="px-4 py-3 text-sm text-ink-muted">
                            {formatBytes(file.size)}
                          </td>
                          <td className="px-4 py-3 text-sm text-ink-muted">
                            {formatDate(file.createdAt)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDownload(file)}
                                className="p-1.5 text-ink-faint hover:text-brand-ink"
                                title="Download"
                                aria-label="Download"
                              >
                                <FaDownload className="w-3.5 h-3.5" />
                              </button>
                              {canMutate && (
                                <button
                                  onClick={() => handleDelete(file)}
                                  className="p-1.5 text-ink-faint hover:text-red-400"
                                  title="Delete"
                                  aria-label="Delete"
                                >
                                  <FaTrash className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
