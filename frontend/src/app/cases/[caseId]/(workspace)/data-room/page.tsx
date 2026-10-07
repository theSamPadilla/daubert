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
import { pickDriveFiles, pickDriveFolderForExport } from '@/lib/google-picker';
import {
  dirKey,
  planFromDataTransfer,
  planFromFileList,
  type UploadPlan,
} from '@/lib/folder-upload';
import { Loader } from '@/components/Common/Loader';
import { Button } from '@/components/ui';
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
  // Neutral counterpart to `error`, for outcomes the user chose (e.g. a cancel).
  const [notice, setNotice] = useState<string | null>(null);
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

  // Upload state. Progress is batch-wide: `label` names the current step and the
  // byte counts span every file in the batch.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{ label: string; loaded: number; total: number } | null>(
    null,
  );
  const uploading = upload !== null;
  // Set while a batch runs; Cancel aborts it, stopping the in-flight file too.
  const uploadAbort = useRef<AbortController | null>(null);

  // Drag-and-drop state. `dragDepth` counts enter/leave across nested children
  // so the overlay doesn't flicker as the cursor crosses child boundaries.
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);

  // Google Drive import state
  const [importing, setImporting] = useState(false);

  // Google Drive export (multi-select) state. Only FILE ids are selectable.
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

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

  // An upload can outlive a folder change; when it finishes, refresh whichever
  // folder is open then, not the one it started in.
  const fetchContentsRef = useRef(fetchContents);
  fetchContentsRef.current = fetchContents;

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

  // Selection is folder-scoped — reset it whenever we navigate folders.
  useEffect(() => {
    setSelectedFileIds(new Set());
  }, [currentFolderId]);

  const toggleFileSelected = (fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  // Upload a batch into the current folder: recreate its folder tree
  // parent-first, then upload files one at a time with batch-wide progress. A
  // failure is collected and the batch keeps going; a folder that can't be
  // created takes its subtree with it. Cancelling keeps whatever already
  // landed. Shared by both pickers and drag-and-drop. Takes a promise so a
  // drop's folder walk counts as part of the busy state.
  const uploadPlan = useCallback(
    async (planned: UploadPlan | Promise<UploadPlan>) => {
      if (!canMutate) return;
      setError(null);
      setNotice(null);
      setUpload({ label: 'Preparing upload', loaded: 0, total: 0 });
      const controller = new AbortController();
      uploadAbort.current = controller;
      const { signal } = controller;
      const failures: { name: string; reason: string }[] = [];
      let itemCount = 0;
      let count = 0;
      let uploaded = 0;
      try {
        const plan = await planned;
        itemCount = plan.dirs.length + plan.files.length;
        count = plan.files.length;
        const total = plan.files.reduce((n, f) => n + f.file.size, 0);

        const folderIds = new Map<string, string | null>([[dirKey([]), currentFolderId]]);
        for (const dir of plan.dirs) {
          if (signal.aborted) break;
          const parentId = folderIds.get(dirKey(dir.slice(0, -1)));
          if (parentId === undefined) continue; // an ancestor failed
          const name = dir[dir.length - 1];
          setUpload({ label: `Creating folder ${name}`, loaded: 0, total });
          try {
            const created = await apiClient.dataRoomCreateFolder(caseId, name, parentId);
            folderIds.set(dirKey(dir), created.id);
          } catch (err) {
            if (signal.aborted) break;
            failures.push({
              name: `${name}/`,
              reason: err instanceof Error ? err.message : 'Could not create folder',
            });
          }
        }

        let done = 0;
        for (const [i, { file, dir }] of plan.files.entries()) {
          if (signal.aborted) break;
          const folderId = folderIds.get(dirKey(dir));
          if (folderId === undefined) {
            failures.push({ name: file.name, reason: 'Its folder could not be created' });
            continue;
          }
          const label =
            count > 1 ? `Uploading ${i + 1} of ${count}: ${file.name}` : `Uploading ${file.name}`;
          const base = done;
          setUpload({ label, loaded: base, total });
          try {
            await apiClient.dataRoomUpload(
              caseId,
              file,
              (loaded, fileTotal) =>
                setUpload({
                  label,
                  loaded: base + (fileTotal ? (loaded / fileTotal) * file.size : 0),
                  total,
                }),
              folderId,
              signal,
            );
            uploaded += 1;
          } catch (err) {
            if (signal.aborted) break;
            failures.push({
              name: file.name,
              reason: err instanceof Error ? err.message : `Upload failed for ${file.name}`,
            });
          }
          done += file.size;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read the selected items');
      } finally {
        uploadAbort.current = null;
        setUpload(null);
      }

      await fetchContentsRef.current();
      if (signal.aborted) {
        setNotice(
          `Upload cancelled after ${uploaded} of ${count} file${count === 1 ? '' : 's'}. ` +
            'Anything already uploaded was kept.',
        );
      }
      if (failures.length === 0) return;
      if (itemCount === 1) {
        setError(failures[0].reason);
      } else if (failures.length === 1) {
        setError(`${failures[0].name} failed to upload: ${failures[0].reason}`);
      } else {
        const names = failures.slice(0, 3).map((f) => f.name).join(', ');
        const more = failures.length > 3 ? ` and ${failures.length - 3} more` : '';
        setError(`${failures.length} items failed to upload: ${names}${more}.`);
      }
    },
    [canMutate, caseId, currentFolderId],
  );

  // Both pickers share this: a plain multi-file pick, or a folder pick whose
  // files carry their path inside the chosen folder.
  const handlePickerChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    // Reset the input so selecting the same items again triggers another change.
    if (e.target) e.target.value = '';
    if (selected.length) await uploadPlan(planFromFileList(selected));
  };

  // ----------------------------- Drag-and-drop -----------------------------
  // The whole data-room surface is a dropzone: drag files or folders anywhere
  // over the content area to upload them into the current folder, keeping the
  // folder structure. Editors only, and one batch at a time.

  const isFileDrag = (e: React.DragEvent) => e.dataTransfer?.types?.includes('Files');

  const handleDragEnter = (e: React.DragEvent) => {
    if (!canMutate || !isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  };

  // Always claim the drag, even mid-upload: an unclaimed file drop makes the
  // browser navigate away to open the file.
  const handleDragOver = (e: React.DragEvent) => {
    if (!canMutate || !isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = uploading ? 'none' : 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!canMutate || !isFileDrag(e)) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!canMutate) return;
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (uploading) return;
    // planFromDataTransfer reads the dropped entries synchronously, before this
    // handler returns; only the folder walk after that is async.
    void uploadPlan(planFromDataTransfer(e.dataTransfer));
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
          Delete <span className="font-medium text-ink">{file.name}</span>. This cannot be undone.
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

  const handleExportToDrive = async (fileIds: string[]) => {
    if (fileIds.length === 0) return;
    const picked = await pickDriveFolderForExport();
    if (!picked) return; // user cancelled
    setExporting(true);
    try {
      const res = await apiClient.dataRoomExportToDrive(
        caseId,
        picked.accessToken,
        fileIds,
        picked.destinationFolderId,
      );
      if (res.failed.length) {
        setError(`${res.failed.length} file(s) couldn't be exported to Drive`);
      }
      setSelectedFileIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Drive export failed');
    } finally {
      setExporting(false);
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
          Delete folder <span className="font-medium text-ink">{folder.name}</span> and everything inside it.
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
        rightContent={<UserMenu />}
      />
      <div
        className="flex-1 overflow-y-auto p-6 relative"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag-over overlay — covers the whole surface so files can be dropped
            anywhere. pointer-events-none so the drop lands on the container. */}
        {isDragging && canMutate && (
          <div className="absolute inset-3 z-40 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand bg-brand/10 backdrop-blur-sm pointer-events-none">
            <FaCloudArrowUp className="w-10 h-10 text-brand mb-3" />
            {uploading ? (
              <p className="text-ink text-sm font-medium">Wait for the current upload to finish</p>
            ) : (
              <>
                <p className="text-ink text-sm font-medium">Drop files or folders to upload</p>
                <p className="text-ink-faint text-xs mt-1">
                  into {breadcrumb.length ? breadcrumb[breadcrumb.length - 1].name : 'Data Room'}
                </p>
              </>
            )}
          </div>
        )}
        <div className="max-w-6xl mx-auto">
          {notice && (
            <div className="mb-4 p-3 rounded-lg bg-surface-panel border border-line text-ink-muted text-sm flex items-center justify-between">
              <span>{notice}</span>
              <button
                onClick={() => setNotice(null)}
                className="text-ink-faint hover:text-ink text-xs"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-redline/10 border border-redline/30 text-redline text-sm flex items-center justify-between">
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                className="text-redline/80 hover:text-redline text-xs"
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
                <div className="mb-5 flex flex-wrap items-center gap-2.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handlePickerChange}
                    className="hidden"
                    data-testid="upload-files-input"
                  />
                  {/* `webkitdirectory` (supported by every current browser) turns the
                      picker into a folder picker; React's typings don't know it. */}
                  <input
                    ref={folderInputRef}
                    type="file"
                    multiple
                    onChange={handlePickerChange}
                    className="hidden"
                    data-testid="upload-folder-input"
                    {...{ webkitdirectory: '' }}
                  />
                  <Button
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || importing}
                  >
                    <FaCloudArrowUp className="w-3.5 h-3.5" /> Upload files
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => folderInputRef.current?.click()}
                    disabled={uploading || importing}
                  >
                    <FaFolderOpen className="w-3.5 h-3.5" /> Upload folder
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleImportFromDrive}
                    disabled={uploading || importing}
                  >
                    <FaGoogle className="w-3.5 h-3.5" /> Add from Google Drive
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleCreateFolder}
                    disabled={uploading || importing}
                  >
                    <FaFolderPlus className="w-3.5 h-3.5" /> New folder
                  </Button>
                  <p className="text-xs text-ink-faint ml-auto">
                    Or drag files and folders anywhere here. Max 50MB per file.
                  </p>
                </div>
              )}

              {/* Upload progress */}
              {upload && (
                <div className="mb-4 p-3 rounded-lg bg-surface-panel border border-line">
                  <div className="flex items-center justify-between mb-2 text-sm">
                    <span className="text-ink-muted truncate">{upload.label}</span>
                    <div className="ml-2 flex items-center gap-3 shrink-0">
                      {upload.total > 0 && (
                        <span className="text-ink-muted">
                          {formatBytes(String(upload.loaded))} /{' '}
                          {formatBytes(String(upload.total))}
                        </span>
                      )}
                      <button
                        onClick={() => uploadAbort.current?.abort()}
                        className="text-ink-faint hover:text-ink text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand transition-all"
                      style={{
                        width: upload.total
                          ? `${Math.min(100, (upload.loaded / upload.total) * 100)}%`
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
                      Drag files or whole folders anywhere here to upload, or add from Google Drive.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {/* Multi-select action bar — appears once one or more files are selected. */}
                  {selectedFileIds.size > 0 && (
                    <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-line bg-surface-panel px-3.5 py-2">
                      <span className="text-sm text-ink-muted">
                        {selectedFileIds.size} selected
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleExportToDrive([...selectedFileIds])}
                        disabled={exporting}
                      >
                        <FaGoogle className="w-3.5 h-3.5" /> Save {selectedFileIds.size} to Google
                        Drive
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedFileIds(new Set())}
                        disabled={exporting}
                      >
                        Clear selection
                      </Button>
                    </div>
                  )}

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
                              <div className="text-sm text-ink truncate" title={folder.name}>
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
                                className="p-1.5 rounded-md bg-surface/80 text-ink-faint hover:text-redline transition-colors"
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
                            <label
                              className={`absolute top-2 left-2 z-10 transition-opacity ${selectedFileIds.has(file.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                            >
                              <input
                                type="checkbox"
                                aria-label={`Select ${file.name}`}
                                checked={selectedFileIds.has(file.id)}
                                onChange={() => toggleFileSelected(file.id)}
                                className="w-4 h-4 accent-brand cursor-pointer"
                              />
                            </label>
                            <div className="aspect-[4/3] flex items-center justify-center bg-surface/40 border-b border-line/60">
                              <span className={`w-12 h-12 rounded-xl flex items-center justify-center ${tint}`}>
                                <Icon className="w-6 h-6" />
                              </span>
                            </div>
                            <div className="px-3 py-2.5 min-w-0">
                              <div className="text-sm text-ink truncate" title={file.name}>
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
                              <button
                                onClick={() => handleExportToDrive([file.id])}
                                disabled={exporting}
                                className="p-1.5 rounded-md bg-surface/80 text-ink-faint hover:text-brand-ink disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                title="Save to Google Drive"
                                aria-label="Save to Google Drive"
                              >
                                <FaGoogle className="w-3 h-3" />
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
                                  className="p-1.5 rounded-md bg-surface/80 text-ink-faint hover:text-redline transition-colors"
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
                                  <div className="text-sm text-ink truncate">{folder.name}</div>
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
                                    className="p-2 rounded-md text-ink-faint hover:text-redline hover:bg-surface-raised transition-colors"
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
                                  <input
                                    type="checkbox"
                                    aria-label={`Select ${file.name}`}
                                    checked={selectedFileIds.has(file.id)}
                                    onChange={() => toggleFileSelected(file.id)}
                                    className={`w-4 h-4 accent-brand cursor-pointer shrink-0 transition-opacity ${selectedFileIds.has(file.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                  />
                                  <span
                                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tint}`}
                                  >
                                    <Icon className="w-4 h-4" />
                                  </span>
                                  <div className="min-w-0">
                                    <div className="text-sm text-ink truncate">{file.name}</div>
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
                                  <button
                                    onClick={() => handleExportToDrive([file.id])}
                                    disabled={exporting}
                                    className="p-2 rounded-md text-ink-faint hover:text-brand-ink hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    title="Save to Google Drive"
                                    aria-label="Save to Google Drive"
                                  >
                                    <FaGoogle className="w-3.5 h-3.5" />
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
                                      className="p-2 rounded-md text-ink-faint hover:text-redline hover:bg-surface-raised transition-colors"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMoveTarget(null)}
                disabled={moving}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
