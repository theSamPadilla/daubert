/**
 * Turn a drag-and-drop or a file/folder pick into an upload plan that keeps the
 * user's folder tree: every directory to create (parents before children) and
 * every file with the directory it lands in. Directory paths are segment arrays
 * relative to the data-room folder being uploaded into; `[]` is that folder.
 */

export interface UploadEntry {
  file: File;
  dir: string[];
}

export interface UploadPlan {
  /** Directories to create, parents before children. */
  dirs: string[][];
  files: UploadEntry[];
}

// OS metadata that rides along with copied folders and is never case material.
// Kept deliberately narrow: anything else the user drops is uploaded as-is.
const JUNK_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const JUNK_DIRS = new Set(['__macosx']);

export function isJunkFile(name: string): boolean {
  return JUNK_FILES.has(name.toLowerCase()) || name.startsWith('._');
}

/** Stable map key for a directory path. Segment names can't contain `/`. */
export function dirKey(dir: string[]): string {
  return dir.join('/');
}

/**
 * Build a plan from loose files plus any directories seen while walking (so
 * empty folders are recreated too). Every ancestor of every path is included,
 * deduped, and ordered shallowest first.
 */
export function buildUploadPlan(files: UploadEntry[], seenDirs: string[][] = []): UploadPlan {
  const kept = files.filter(
    (f) => !isJunkFile(f.file.name) && !f.dir.some((s) => JUNK_DIRS.has(s.toLowerCase())),
  );
  const dirs = new Map<string, string[]>();
  for (const path of [...seenDirs, ...kept.map((f) => f.dir)]) {
    if (path.some((s) => JUNK_DIRS.has(s.toLowerCase()))) continue;
    for (let depth = 1; depth <= path.length; depth++) {
      const prefix = path.slice(0, depth);
      dirs.set(dirKey(prefix), prefix);
    }
  }
  return {
    dirs: [...dirs.values()].sort((a, b) => a.length - b.length),
    files: kept,
  };
}

/**
 * Plan from an `<input type="file">` selection. With `webkitdirectory`, each
 * File carries `webkitRelativePath` ("Picked/sub/a.pdf"), whose directory part
 * becomes the file's dir. A plain multi-file pick has no relative path.
 */
export function planFromFileList(files: File[]): UploadPlan {
  return buildUploadPlan(
    files.map((file) => {
      const segments = (file.webkitRelativePath ?? '').split('/').filter(Boolean);
      return { file, dir: segments.slice(0, -1) };
    }),
  );
}

/**
 * Plan from a drop. Dropped folders only expose their contents through the
 * File and Directory Entries API (`dataTransfer.files` lists a folder as an
 * unreadable zero-byte File). The entries must be taken synchronously, before
 * the drop handler returns, because the browser empties the item list after.
 */
export function planFromDataTransfer(dt: DataTransfer): Promise<UploadPlan> {
  const items = Array.from(dt.items ?? []);
  if (items.length === 0) {
    return Promise.resolve(planFromFileList(Array.from(dt.files ?? [])));
  }
  const roots: FileSystemEntry[] = [];
  const loose: UploadEntry[] = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      roots.push(entry);
    } else {
      const file = item.getAsFile();
      if (file) loose.push({ file, dir: [] });
    }
  }
  return (async () => {
    const files = [...loose];
    const dirs: string[][] = [];
    for (const root of roots) await walkEntry(root, [], files, dirs);
    return buildUploadPlan(files, dirs);
  })();
}

async function walkEntry(
  entry: FileSystemEntry,
  dir: string[],
  files: UploadEntry[],
  dirs: string[][],
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    files.push({ file, dir });
    return;
  }
  if (entry.isDirectory) {
    const path = [...dir, entry.name];
    dirs.push(path);
    for (const child of await readAllEntries(entry as FileSystemDirectoryEntry)) {
      await walkEntry(child, path, files, dirs);
    }
  }
}

// readEntries() hands back at most ~100 entries per call in Chrome; keep
// reading until it returns an empty batch.
async function readAllEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}
