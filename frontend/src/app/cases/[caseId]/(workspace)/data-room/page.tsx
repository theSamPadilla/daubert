'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import {
  FaCloudArrowUp,
  FaDownload,
  FaTrash,
  FaGoogle,
  FaRegFilePdf,
  FaRegFileExcel,
  FaRegFileWord,
  FaRegFilePowerpoint,
  FaRegFileImage,
  FaRegFileZipper,
  FaRegFileLines,
  FaRegFile,
  FaFolder,
  FaFolderPlus,
  FaFolderOpen,
  FaList,
  FaTableCellsLarge,
  FaChevronRight,
  FaArrowRightArrowLeft,
} from 'react-icons/fa6';
import type { IconType } from 'react-icons';

type ViewMode = 'list' | 'grid';
import {
  apiClient,
  type DataRoomFile,
  type DataRoomFolder,
} from '@/lib/api-client';
import { pickDriveFiles } from '@/lib/google-picker';
import { Loader } from '@/components/Common/Loader';
import { PageHeader } from '@/components/Common/PageHeader';
import UserMenu from '@/components/Auth/UserMenu';
import { useConfirm } from '@/components/Common/ConfirmProvider';
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
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Map a file to a type icon, tint classes, and a human label (file-browser look). */
function fileMeta(name: string, mimeType?: string): { Icon: IconType; tint: string; label: string } {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const m = (mimeType ?? '').toLowerCase();
  if (ext === 'pdf' || m.includes('pdf'))
    return { Icon: FaRegFilePdf, tint: 'text-red-400 bg-red-500/10', label: 'PDF' };
  if (['xlsx', 'xls', 'csv'].includes(ext) || m.includes('spreadsheet') || m.includes('excel') || m.includes('csv'))
    return { Icon: FaRegFileExcel, tint: 'text-emerald-400 bg-emerald-500/10', label: 'Spreadsheet' };
  if (['docx', 'doc'].includes(ext) || m.includes('wordprocessing') || m.includes('msword'))
    return { Icon: FaRegFileWord, tint: 'text-blue-400 bg-blue-500/10', label: 'Document' };
  if (['pptx', 'ppt'].includes(ext) || m.includes('presentation'))
    return { Icon: FaRegFilePowerpoint, tint: 'text-orange-400 bg-orange-500/10', label: 'Presentation' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'bmp'].includes(ext) || m.startsWith('image/'))
    return { Icon: FaRegFileImage, tint: 'text-purple-400 bg-purple-500/10', label: 'Image' };
  if (['zip', 'gz', 'tar', 'rar', '7z'].includes(ext) || m.includes('zip') || m.includes('compressed'))
    return { Icon: FaRegFileZipper, tint: 'text-amber-400 bg-amber-500/10', label: 'Archive' };
  if (['txt', 'md', 'rtf', 'json', 'log'].includes(ext) || m.startsWith('text/'))
    return { Icon: FaRegFileLines, tint: 'text-sky-400 bg-sky-500/10', label: 'Text' };
  return { Icon: FaRegFile, tint: 'text-ink-muted bg-surface-raised', label: 'File' };
}

export default function DataRoomPage() {
  const params = useParams();
  const caseId = params.caseId as string;
  const { viewerRole } = useCaseContext();
  const canMutate = viewerRole === 'owner' || viewerRole === 'editor';
  const confirm = useConfirm();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<DataRoomFile[]>([]);
  const [folders, setFolders] = useState<DataRoomFolder[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<{ id: string; name: string }[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // Restore the persisted list/grid preference (Drive-style — remembers your choice).
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('dataroom-view') : null;
    if (saved === 'grid' || saved === 'list') setViewMode(saved);
  }, []);

  const changeView = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('dataroom-view', mode);
    } catch {
      /* ignore storage failures */
    }
  }, []);

  // Upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ loaded: number; total: number } | null>(
    null,
  );

  // Google Drive import state
  const [importing, setImporting] = useState(false);

  // Move-to picker modal state. `target` is the file or folder being moved.
  const [moveTarget, setMoveTarget] = useState<
    { kind: 'file'; item: DataRoomFile } | { kind: 'folder'; item: DataRoomFolder } | null
  >(null);
  const [moving, setMoving] = useState(false);

  const fetchContents = useCallback(async () => {
    try {
      const res = await apiClient.dataRoomContents(caseId, currentFolderId);
      setFolders(res.folders);
      setFiles(res.files);
      setBreadcrumb(res.breadcrumb);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list files');
    }
  }, [caseId, currentFolderId]);

  // Initial load + re-fetch whenever the current folder changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await fetchContents();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchContents]);

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
      await apiClient.dataRoomUpload(
        caseId,
        file,
        (loaded, total) => {
          setUploadProgress({ loaded, total });
        },
        currentFolderId,
      );
      await fetchContents();
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
    const ok = await confirm({
      title: 'Delete file?',
      message: (
        <>
          Delete <span className="text-white">{file.name}</span>. This cannot be undone.
        </>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiClient.dataRoomDeleteFile(caseId, file.id);
      await fetchContents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleImportFromDrive = async () => {
    const picked = await pickDriveFiles();
    if (!picked) return; // user cancelled
    setImporting(true);
    try {
      const res = await apiClient.dataRoomImportFromDrive(
        caseId,
        picked.accessToken,
        picked.fileIds,
        currentFolderId,
      );
      await fetchContents();
      if (res.failed.length) {
        setError(`${res.failed.length} file(s) couldn't be imported`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Drive import failed');
    } finally {
      setImporting(false);
    }
  };

  // ----------------------------- Folder handlers -----------------------------

  const handleOpenFolder = (folderId: string) => {
    setCurrentFolderId(folderId);
  };

  const handleCreateFolder = async () => {
    const name = window.prompt('New folder name')?.trim();
    if (!name) return;
    try {
      await apiClient.dataRoomCreateFolder(caseId, name, currentFolderId);
      await fetchContents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create folder');
    }
  };

  const handleDeleteFolder = async (folder: DataRoomFolder) => {
    const ok = await confirm({
      title: 'Delete folder?',
      message: (
        <>
          Delete folder <span className="text-white">{folder.name}</span> and everything inside it.
          This permanently deletes all files and subfolders within and cannot be undone.
        </>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiClient.dataRoomDeleteFolder(caseId, folder.id);
      await fetchContents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete folder');
    }
  };

  // Resolve the destination chosen in the move picker, run the move, refetch.
  const handleConfirmMove = async (targetFolderId: string | null) => {
    if (!moveTarget) return;
    setMoving(true);
    try {
      if (moveTarget.kind === 'file') {
        await apiClient.dataRoomMoveFile(caseId, moveTarget.item.id, targetFolderId);
      } else {
        await apiClient.dataRoomMoveFolder(caseId, moveTarget.item.id, targetFolderId);
      }
      await fetchContents();
      setMoveTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Move failed');
    } finally {
      setMoving(false);
    }
  };

  // Destination options for the move picker. v1 simplification: we offer Root,
  // the current folder's parent (from the breadcrumb), and the subfolders
  // visible in the current view. A folder can't be moved into itself.
  const moveDestinations: { id: string | null; name: string }[] = (() => {
    const opts: { id: string | null; name: string }[] = [{ id: null, name: 'Data Room (root)' }];
    if (breadcrumb.length >= 2) {
      const parent = breadcrumb[breadcrumb.length - 2];
      opts.push({ id: parent.id, name: `${parent.name} (up one level)` });
    }
    for (const f of folders) {
      if (moveTarget?.kind === 'folder' && moveTarget.item.id === f.id) continue;
      opts.push({ id: f.id, name: f.name });
    }
    return opts;
  })();

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
              {/* Breadcrumbs */}
              <nav className="mb-4 flex items-center gap-1.5 text-sm text-ink-faint flex-wrap">
                {breadcrumb.length === 0 ? (
                  <span className="text-ink font-medium">Data Room</span>
                ) : (
                  <button
                    onClick={() => setCurrentFolderId(null)}
                    className="hover:text-ink transition-colors"
                  >
                    Data Room
                  </button>
                )}
                {breadcrumb.map((seg, i) => {
                  const isLast = i === breadcrumb.length - 1;
                  return (
                    <span key={seg.id} className="flex items-center gap-1.5">
                      <FaChevronRight className="w-2.5 h-2.5 text-ink-faint" />
                      {isLast ? (
                        <span className="text-ink font-medium">{seg.name}</span>
                      ) : (
                        <button
                          onClick={() => setCurrentFolderId(seg.id)}
                          className="hover:text-ink transition-colors"
                        >
                          {seg.name}
                        </button>
                      )}
                    </span>
                  );
                })}
              </nav>

              {/* Upload controls */}
              {canMutate && (
                <div className="mb-5 flex items-center gap-2.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleUploadFile}
                    className="hidden"
                  />
                  <button
                    onClick={handleUploadClick}
                    disabled={uploadingName !== null || importing}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-medium bg-brand hover:bg-brand/90 disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-sm shadow-brand/30"
                  >
                    <FaCloudArrowUp className="w-3.5 h-3.5" /> Upload file
                  </button>
                  <button
                    onClick={handleImportFromDrive}
                    disabled={uploadingName !== null || importing}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-medium border border-line-strong bg-surface-panel text-ink hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <FaGoogle className="w-3.5 h-3.5" /> Add from Google Drive
                  </button>
                  <button
                    onClick={handleCreateFolder}
                    disabled={uploadingName !== null || importing}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-sm font-medium border border-line-strong bg-surface-panel text-ink hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <FaFolderPlus className="w-3.5 h-3.5" /> New folder
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

              {/* File list / empty state */}
              {files.length === 0 && folders.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line-strong bg-surface-panel/20 py-16 flex flex-col items-center text-center">
                  <span className="w-14 h-14 rounded-2xl bg-surface-raised flex items-center justify-center mb-4">
                    <FaFolderOpen className="w-6 h-6 text-ink-faint" />
                  </span>
                  <p className="text-ink text-sm font-medium">No files yet.</p>
                  {canMutate && (
                    <p className="text-ink-faint text-xs mt-1">
                      Upload one to get started, or add files from Google Drive.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs text-ink-faint">
                      {folders.length > 0 && (
                        <>
                          {folders.length} folder{folders.length === 1 ? '' : 's'}
                          {files.length > 0 ? ' · ' : ''}
                        </>
                      )}
                      {files.length > 0 && (
                        <>
                          {files.length} file{files.length === 1 ? '' : 's'}
                        </>
                      )}
                    </span>
                    <div className="inline-flex items-center rounded-md border border-line-strong overflow-hidden">
                      <button
                        onClick={() => changeView('list')}
                        className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-surface-raised text-ink' : 'text-ink-faint hover:text-ink hover:bg-surface-raised/50'}`}
                        title="List view"
                        aria-label="List view"
                      >
                        <FaList className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => changeView('grid')}
                        className={`p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-surface-raised text-ink' : 'text-ink-faint hover:text-ink hover:bg-surface-raised/50'}`}
                        title="Grid view"
                        aria-label="Grid view"
                      >
                        <FaTableCellsLarge className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {viewMode === 'grid' ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {folders.map((folder) => (
                        <div
                          key={folder.id}
                          className="group relative rounded-xl border border-line-strong bg-surface-panel/30 overflow-hidden hover:bg-surface-raised/30 transition-colors"
                        >
                          <button
                            onClick={() => handleOpenFolder(folder.id)}
                            className="w-full text-left"
                          >
                            <div className="aspect-[4/3] flex items-center justify-center bg-surface/40 border-b border-line/60">
                              <span className="w-12 h-12 rounded-xl flex items-center justify-center text-amber-400 bg-amber-500/10">
                                <FaFolder className="w-6 h-6" />
                              </span>
                            </div>
                            <div className="px-3 py-2.5 min-w-0">
                              <div className="text-sm text-white truncate" title={folder.name}>
                                {folder.name}
                              </div>
                              <div className="text-xs text-ink-faint truncate">Folder</div>
                            </div>
                          </button>
                          {canMutate && (
                            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => setMoveTarget({ kind: 'folder', item: folder })}
                                className="p-1.5 rounded-md bg-surface/80 text-ink-faint hover:text-brand-ink transition-colors"
                                title="Move folder"
                                aria-label="Move folder"
                              >
                                <FaArrowRightArrowLeft className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleDeleteFolder(folder)}
                                className="p-1.5 rounded-md bg-surface/80 text-ink-faint hover:text-red-400 transition-colors"
                                title="Delete folder"
                                aria-label="Delete folder"
                              >
                                <FaTrash className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                      {files.map((file) => {
                        const { Icon, tint, label } = fileMeta(file.name, file.mimeType);
                        return (
                          <div
                            key={file.id}
                            className="group relative rounded-xl border border-line-strong bg-surface-panel/30 overflow-hidden hover:bg-surface-raised/30 transition-colors"
                          >
                            <div className="aspect-[4/3] flex items-center justify-center bg-surface/40 border-b border-line/60">
                              <span className={`w-12 h-12 rounded-xl flex items-center justify-center ${tint}`}>
                                <Icon className="w-6 h-6" />
                              </span>
                            </div>
                            <div className="px-3 py-2.5 min-w-0">
                              <div className="text-sm text-white truncate" title={file.name}>
                                {file.name}
                              </div>
                              <div className="text-xs text-ink-faint truncate">
                                {label} · {formatBytes(file.size)}
                              </div>
                            </div>
                            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => handleDownload(file)}
                                className="p-1.5 rounded-md bg-surface/80 text-ink-faint hover:text-brand-ink transition-colors"
                                title="Download"
                                aria-label="Download"
                              >
                                <FaDownload className="w-3 h-3" />
                              </button>
                              {canMutate && (
                                <button
                                  onClick={() => setMoveTarget({ kind: 'file', item: file })}
                                  className="p-1.5 rounded-md bg-surface/80 text-ink-faint hover:text-brand-ink transition-colors"
                                  title="Move"
                                  aria-label="Move"
                                >
                                  <FaArrowRightArrowLeft className="w-3 h-3" />
                                </button>
                              )}
                              {canMutate && (
                                <button
                                  onClick={() => handleDelete(file)}
                                  className="p-1.5 rounded-md bg-surface/80 text-ink-faint hover:text-red-400 transition-colors"
                                  title="Delete"
                                  aria-label="Delete"
                                >
                                  <FaTrash className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                  <div className="rounded-xl border border-line-strong bg-surface-panel/30 overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint border-b border-line-strong/70">
                          <th className="px-4 py-2.5">Name</th>
                          <th className="px-4 py-2.5 w-24 text-right">Size</th>
                          <th className="px-4 py-2.5 w-32 text-right">Added</th>
                          <th className="px-4 py-2.5 w-20" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line/60">
                        {folders.map((folder) => (
                          <tr key={folder.id} className="group hover:bg-surface-raised/30 transition-colors">
                            <td className="px-4 py-3">
                              <button
                                onClick={() => handleOpenFolder(folder.id)}
                                className="flex items-center gap-3 min-w-0 text-left w-full"
                              >
                                <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-amber-400 bg-amber-500/10">
                                  <FaFolder className="w-4 h-4" />
                                </span>
                                <div className="min-w-0">
                                  <div className="text-sm text-white truncate">{folder.name}</div>
                                  <div className="text-xs text-ink-faint">Folder</div>
                                </div>
                              </button>
                            </td>
                            <td className="px-4 py-3 text-right text-sm text-ink-muted tabular-nums whitespace-nowrap">
                              —
                            </td>
                            <td className="px-4 py-3 text-right text-sm text-ink-muted whitespace-nowrap">
                              {formatDate(folder.createdAt)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                                {canMutate && (
                                  <button
                                    onClick={() => setMoveTarget({ kind: 'folder', item: folder })}
                                    className="p-2 rounded-md text-ink-faint hover:text-brand-ink hover:bg-surface-raised transition-colors"
                                    title="Move folder"
                                    aria-label="Move folder"
                                  >
                                    <FaArrowRightArrowLeft className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {canMutate && (
                                  <button
                                    onClick={() => handleDeleteFolder(folder)}
                                    className="p-2 rounded-md text-ink-faint hover:text-red-400 hover:bg-surface-raised transition-colors"
                                    title="Delete folder"
                                    aria-label="Delete folder"
                                  >
                                    <FaTrash className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                        {files.map((file) => {
                          const { Icon, tint, label } = fileMeta(file.name, file.mimeType);
                          return (
                            <tr key={file.id} className="group hover:bg-surface-raised/30 transition-colors">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-3 min-w-0">
                                  <span
                                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tint}`}
                                  >
                                    <Icon className="w-4 h-4" />
                                  </span>
                                  <div className="min-w-0">
                                    <div className="text-sm text-white truncate">{file.name}</div>
                                    <div className="text-xs text-ink-faint">{label}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right text-sm text-ink-muted tabular-nums whitespace-nowrap">
                                {formatBytes(file.size)}
                              </td>
                              <td className="px-4 py-3 text-right text-sm text-ink-muted whitespace-nowrap">
                                {formatDate(file.createdAt)}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => handleDownload(file)}
                                    className="p-2 rounded-md text-ink-faint hover:text-brand-ink hover:bg-surface-raised transition-colors"
                                    title="Download"
                                    aria-label="Download"
                                  >
                                    <FaDownload className="w-3.5 h-3.5" />
                                  </button>
                                  {canMutate && (
                                    <button
                                      onClick={() => setMoveTarget({ kind: 'file', item: file })}
                                      className="p-2 rounded-md text-ink-faint hover:text-brand-ink hover:bg-surface-raised transition-colors"
                                      title="Move"
                                      aria-label="Move"
                                    >
                                      <FaArrowRightArrowLeft className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  {canMutate && (
                                    <button
                                      onClick={() => handleDelete(file)}
                                      className="p-2 rounded-md text-ink-faint hover:text-red-400 hover:bg-surface-raised transition-colors"
                                      title="Delete"
                                      aria-label="Delete"
                                    >
                                      <FaTrash className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Move-to picker modal */}
      {moveTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!moving) setMoveTarget(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-line-strong bg-surface-panel shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-line-strong/70">
              <h2 className="text-sm font-semibold text-ink">
                Move {moveTarget.kind === 'folder' ? 'folder' : 'file'} “{moveTarget.item.name}”
              </h2>
              <p className="text-xs text-ink-faint mt-1">Choose a destination folder.</p>
            </div>
            <ul className="max-h-72 overflow-y-auto py-1">
              {moveDestinations.map((dest) => (
                <li key={dest.id ?? '__root__'}>
                  <button
                    onClick={() => handleConfirmMove(dest.id)}
                    disabled={moving}
                    className="w-full flex items-center gap-3 px-5 py-2.5 text-left text-sm text-ink hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-amber-400 bg-amber-500/10">
                      <FaFolder className="w-3.5 h-3.5" />
                    </span>
                    <span className="truncate">{dest.name}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="px-5 py-3 border-t border-line-strong/70 flex justify-end">
              <button
                onClick={() => setMoveTarget(null)}
                disabled={moving}
                className="px-3 py-1.5 rounded-md text-sm text-ink-muted hover:text-ink hover:bg-surface-raised disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
