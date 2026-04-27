'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import {
  FaCloudArrowUp,
  FaDownload,
  FaPlug,
  FaPlugCircleXmark,
  FaTriangleExclamation,
  FaArrowUpRightFromSquare,
  FaFolderOpen,
  FaPenToSquare,
} from 'react-icons/fa6';
import { apiClient, type DataRoomConnection, type DataRoomFile } from '@/lib/api-client';
import { openDriveFolderPicker } from '@/lib/google-picker';

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

function shortMime(mt: string): string {
  if (!mt) return '—';
  // Compress common Google Workspace types for readability.
  const map: Record<string, string> = {
    'application/vnd.google-apps.document': 'Google Doc',
    'application/vnd.google-apps.spreadsheet': 'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/vnd.google-apps.folder': 'Folder',
    'application/pdf': 'PDF',
    'text/plain': 'Text',
    'text/csv': 'CSV',
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
  };
  return map[mt] ?? mt.split('/').pop() ?? mt;
}

export default function DataRoomPage() {
  const params = useParams();
  const caseId = params.caseId as string;

  // Browser-key for the Drive Picker SDK. Read once at module evaluation;
  // null/undefined both indicate "unset" (Next inlines `process.env.NEXT_PUBLIC_*` at build).
  const drivePickerKey = process.env.NEXT_PUBLIC_DRIVE_PICKER_KEY || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<DataRoomConnection | null>(null);

  // Pre-OAuth confirmation modal
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Picker state
  const [pickerBusy, setPickerBusy] = useState(false);

  // File listing
  const [files, setFiles] = useState<DataRoomFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  // Upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ loaded: number; total: number } | null>(
    null,
  );

  // Disconnect modal
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchConnection = useCallback(async () => {
    try {
      setError(null);
      const conn = await apiClient.dataRoomGet(caseId);
      setConnection(conn);
      return conn;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data room');
      return null;
    }
  }, [caseId]);

  const fetchFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const list = await apiClient.dataRoomListFiles(caseId);
      setFiles(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list files');
    } finally {
      setFilesLoading(false);
    }
  }, [caseId]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const conn = await fetchConnection();
      if (cancelled) return;
      if (conn?.folderId && conn.status === 'active') {
        await fetchFiles();
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchConnection, fetchFiles]);

  const handleConnectClick = () => {
    setShowConsentModal(true);
  };

  const handleConfirmConnect = async () => {
    setConnecting(true);
    try {
      const { url } = await apiClient.dataRoomConnect(caseId);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth');
      setConnecting(false);
      setShowConsentModal(false);
    }
  };

  /**
   * Open the Google Drive Picker, then persist the selection. Mints a fresh
   * access token per click rather than caching one — they're cheap to obtain
   * (just a refresh on the backend) and we'd rather pay one network call than
   * race against a token expiring mid-Picker session.
   */
  const handlePickFolder = useCallback(async () => {
    if (!drivePickerKey) {
      setError('Google Drive Picker is not configured');
      return;
    }
    setError(null);
    setPickerBusy(true);
    try {
      const { accessToken } = await apiClient.dataRoomGetAccessToken(caseId);
      const picked = await openDriveFolderPicker({
        accessToken,
        apiKey: drivePickerKey,
      });
      if (!picked) return; // user cancelled
      const updated = await apiClient.dataRoomSetFolder(caseId, picked.id);
      setConnection(updated);
      if (updated.status === 'active') {
        await fetchFiles();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pick folder');
    } finally {
      setPickerBusy(false);
    }
  }, [caseId, drivePickerKey, fetchFiles]);

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

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await apiClient.dataRoomDisconnect(caseId);
      setConnection(null);
      setFiles([]);
      setShowDisconnectModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  // ----------------------------- Render -----------------------------

  const state: 'loading' | 'disconnected' | 'noFolder' | 'connected' | 'broken' = loading
    ? 'loading'
    : !connection
      ? 'disconnected'
      : connection.status === 'broken'
        ? 'broken'
        : connection.folderId
          ? 'connected'
          : 'noFolder';

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <FaFolderOpen className="text-blue-400" /> Data Room
              </h1>
              {connection?.folderName && (
                <span className="text-sm text-gray-400 ml-2">/ {connection.folderName}</span>
              )}
            </div>
            {state === 'connected' && (
              <button
                onClick={() => setShowDisconnectModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700"
                title="Disconnect Google Drive"
              >
                <FaPlugCircleXmark className="w-3.5 h-3.5" /> Disconnect
              </button>
            )}
          </div>

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

          {state === 'loading' && (
            <div className="flex items-center justify-center py-16">
              <p className="text-gray-400 text-sm">Loading data room...</p>
            </div>
          )}

          {state === 'disconnected' && (
            <div className="rounded-lg bg-gray-800 border border-gray-700 p-8 text-center">
              <FaFolderOpen className="mx-auto text-blue-400 mb-3" size={36} />
              <h2 className="text-lg font-semibold text-white mb-2">Connect a Google Drive folder</h2>
              <p className="text-sm text-gray-400 max-w-md mx-auto mb-6">
                Daubert reads and writes case documents directly in your Google Drive. Connect a
                folder to get started.
              </p>
              <button
                onClick={handleConnectClick}
                className="inline-flex items-center gap-2 px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm"
              >
                <FaPlug className="w-3.5 h-3.5" /> Connect Google Drive
              </button>
            </div>
          )}

          {state === 'noFolder' && (
            <div className="rounded-lg bg-gray-800 border border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-white mb-2">Choose a folder</h2>
              <p className="text-sm text-gray-400 mb-4">
                Pick the Google Drive folder you want to use as this case&apos;s data room.
                Daubert will only read or modify files in this folder.
              </p>
              {drivePickerKey ? (
                <button
                  onClick={handlePickFolder}
                  disabled={pickerBusy}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm"
                >
                  <FaFolderOpen className="w-3.5 h-3.5" />
                  {pickerBusy ? 'Opening picker...' : 'Pick a Drive folder'}
                </button>
              ) : (
                <PickerNotConfiguredBanner />
              )}
            </div>
          )}

          {state === 'broken' && (
            <div className="rounded-lg bg-yellow-900/30 border border-yellow-800/60 p-6">
              <div className="flex items-start gap-3 mb-4">
                <FaTriangleExclamation className="text-yellow-300 mt-0.5" />
                <div>
                  <h2 className="text-lg font-semibold text-yellow-100">Connection lost</h2>
                  <p className="text-sm text-yellow-200/80 mt-1">
                    Daubert can no longer access this Drive folder. The token may have been revoked
                    or expired beyond refresh. Please reconnect to restore access.
                  </p>
                  <p className="text-xs text-yellow-200/60 mt-2">
                    You can also remove Daubert from your Google account at{' '}
                    <a
                      href="https://myaccount.google.com/permissions"
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-yellow-100"
                    >
                      myaccount.google.com/permissions
                    </a>
                    .
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleConnectClick}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm"
                >
                  <FaPlug className="w-3.5 h-3.5" /> Reconnect
                </button>
                <button
                  onClick={() => setShowDisconnectModal(true)}
                  className="px-3 py-1.5 rounded text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700"
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}

          {state === 'connected' && (
            <>
              {/* Upload bar */}
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
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
                >
                  <FaCloudArrowUp className="w-3.5 h-3.5" /> Upload file
                </button>
                <button
                  onClick={fetchFiles}
                  disabled={filesLoading}
                  className="px-3 py-1.5 rounded text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 disabled:opacity-50"
                >
                  {filesLoading ? 'Refreshing...' : 'Refresh'}
                </button>
                {drivePickerKey && (
                  <button
                    onClick={handlePickFolder}
                    disabled={pickerBusy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 disabled:opacity-50"
                    title="Point this data room at a different Drive folder"
                  >
                    <FaPenToSquare className="w-3.5 h-3.5" />
                    {pickerBusy ? 'Opening...' : 'Change folder'}
                  </button>
                )}
                <p className="text-xs text-gray-500 ml-auto">Max 50MB per upload.</p>
              </div>

              {/* Upload progress */}
              {uploadingName && uploadProgress && (
                <div className="mb-4 p-3 rounded bg-gray-800 border border-gray-700">
                  <div className="flex items-center justify-between mb-2 text-sm">
                    <span className="text-gray-300 truncate">Uploading {uploadingName}</span>
                    <span className="text-gray-400 ml-2 shrink-0">
                      {formatBytes(String(uploadProgress.loaded))} /{' '}
                      {formatBytes(String(uploadProgress.total))}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-700 rounded overflow-hidden">
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

              {/* File table */}
              {filesLoading && files.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">Loading files...</div>
              ) : files.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">
                  No files in this folder yet. Upload one to get started.
                </div>
              ) : (
                <div className="rounded-lg border border-gray-700 overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-800/50 text-left text-sm text-gray-400">
                        <th className="px-4 py-3">Name</th>
                        <th className="px-4 py-3 w-32">Type</th>
                        <th className="px-4 py-3 w-24">Size</th>
                        <th className="px-4 py-3 w-44">Modified</th>
                        <th className="px-4 py-3 w-20">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((file) => (
                        <tr
                          key={file.id}
                          className="border-b border-gray-700/50 hover:bg-gray-800/40"
                        >
                          <td className="px-4 py-3 text-sm">
                            {file.webViewLink ? (
                              <a
                                href={file.webViewLink}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-300 hover:text-blue-200 inline-flex items-center gap-1.5"
                                title="Open in Google Drive"
                              >
                                {file.name}
                                <FaArrowUpRightFromSquare className="w-3 h-3 opacity-60" />
                              </a>
                            ) : (
                              <span className="text-gray-300" title="No web viewer for this file type">
                                {file.name}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300">
                              {shortMime(file.mimeType)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-400">
                            {formatBytes(file.size)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-400">
                            {formatDate(file.modifiedTime)}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => handleDownload(file)}
                              className="p-1.5 text-gray-500 hover:text-blue-300"
                              title="Download"
                            >
                              <FaDownload className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* Pre-OAuth consent modal */}
          {showConsentModal && (
            <Modal onClose={() => !connecting && setShowConsentModal(false)}>
              <h3 className="text-lg font-semibold text-white mb-3">Connect Google Drive</h3>
              <p className="text-sm text-gray-300 mb-3">
                Daubert will request access to your full Google Drive. It will only read or modify
                the folder you select for this case.
              </p>
              <p className="text-xs text-gray-500 mb-5">
                You&apos;ll be redirected to Google to grant access. You can revoke at any time at{' '}
                <a
                  href="https://myaccount.google.com/permissions"
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-gray-300"
                >
                  myaccount.google.com/permissions
                </a>
                .
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowConsentModal(false)}
                  disabled={connecting}
                  className="px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmConnect}
                  disabled={connecting}
                  className="px-3 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                >
                  {connecting ? 'Redirecting...' : 'Continue to Google'}
                </button>
              </div>
            </Modal>
          )}

          {/* Disconnect confirm modal */}
          {showDisconnectModal && (
            <Modal onClose={() => !disconnecting && setShowDisconnectModal(false)}>
              <h3 className="text-lg font-semibold text-white mb-3">Disconnect Google Drive?</h3>
              <p className="text-sm text-gray-300 mb-5">
                Daubert will stop having access to this folder. Your files in Drive are not deleted.
                You can reconnect later.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowDisconnectModal(false)}
                  disabled={disconnecting}
                  className="px-3 py-1.5 rounded text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="px-3 py-1.5 rounded text-sm bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
                >
                  {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                </button>
              </div>
            </Modal>
          )}
        </div>
      </div>
  );
}

function PickerNotConfiguredBanner() {
  return (
    <div className="rounded bg-yellow-900/30 border border-yellow-800/60 p-3 text-sm text-yellow-200">
      <div className="flex items-start gap-2">
        <FaTriangleExclamation className="text-yellow-300 mt-0.5 shrink-0" />
        <span>
          Google Drive Picker is not configured. Set{' '}
          <code className="px-1 py-0.5 rounded bg-yellow-950/60 text-yellow-100 text-xs">
            NEXT_PUBLIC_DRIVE_PICKER_KEY
          </code>{' '}
          in <code className="px-1 py-0.5 rounded bg-yellow-950/60 text-yellow-100 text-xs">frontend/.env.development</code> and restart.
        </span>
      </div>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 max-w-md w-full shadow-2xl">
        {children}
      </div>
    </div>
  );
}
