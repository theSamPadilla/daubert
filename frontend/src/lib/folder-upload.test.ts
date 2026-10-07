import {
  buildUploadPlan,
  isJunkFile,
  planFromDataTransfer,
  planFromFileList,
} from './folder-upload';

// --- Fake File and Directory Entries API ------------------------------------

function fileEntry(name: string): FileSystemFileEntry {
  const file = new File(['x'], name);
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (ok: (f: File) => void) => ok(file),
  } as unknown as FileSystemFileEntry;
}

// `batchSize` mimics Chrome handing readEntries() results back in chunks.
function dirEntry(name: string, children: FileSystemEntry[], batchSize = 100): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let cursor = 0;
      return {
        readEntries: (ok: (batch: FileSystemEntry[]) => void) => {
          const batch = children.slice(cursor, cursor + batchSize);
          cursor += batchSize;
          ok(batch);
        },
      };
    },
  } as unknown as FileSystemDirectoryEntry;
}

function dropOf(items: Array<FileSystemEntry | File>): DataTransfer {
  return {
    items: items.map((item) => {
      const file = item instanceof File ? item : null;
      const entry = item instanceof File ? null : item;
      return { kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => file };
    }),
    files: [],
  } as unknown as DataTransfer;
}

function withRelativePath(name: string, path: string): File {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

const summary = (plan: { dirs: string[][]; files: { file: File; dir: string[] }[] }) => ({
  dirs: plan.dirs.map((d) => d.join('/')),
  files: plan.files.map((f) => [...f.dir, f.file.name].join('/')),
});

// ---------------------------------------------------------------------------

describe('isJunkFile', () => {
  it('flags OS metadata files only', () => {
    expect(isJunkFile('.DS_Store')).toBe(true);
    expect(isJunkFile('Thumbs.db')).toBe(true);
    expect(isJunkFile('desktop.ini')).toBe(true);
    expect(isJunkFile('._contract.pdf')).toBe(true);
    expect(isJunkFile('.env')).toBe(false);
    expect(isJunkFile('contract.pdf')).toBe(false);
  });
});

describe('buildUploadPlan', () => {
  it('includes every ancestor once, parents before children', () => {
    const plan = buildUploadPlan([
      { file: new File(['x'], 'c.pdf'), dir: ['A', 'B', 'C'] },
      { file: new File(['x'], 'b.pdf'), dir: ['A', 'B'] },
      { file: new File(['x'], 'root.pdf'), dir: [] },
    ]);
    expect(summary(plan).dirs).toEqual(['A', 'A/B', 'A/B/C']);
  });

  it('drops junk files and anything under __MACOSX', () => {
    const plan = buildUploadPlan(
      [
        { file: new File(['x'], '.DS_Store'), dir: ['A'] },
        { file: new File(['x'], 'real.pdf'), dir: ['A'] },
        { file: new File(['x'], 'shadow.pdf'), dir: ['A', '__MACOSX'] },
      ],
      [['A', '__MACOSX']],
    );
    expect(summary(plan)).toEqual({ dirs: ['A'], files: ['A/real.pdf'] });
  });
});

describe('planFromFileList', () => {
  it('uses webkitRelativePath for folder picks', () => {
    const plan = planFromFileList([
      withRelativePath('a.pdf', 'Evidence/a.pdf'),
      withRelativePath('b.pdf', 'Evidence/Bank/b.pdf'),
    ]);
    expect(summary(plan)).toEqual({
      dirs: ['Evidence', 'Evidence/Bank'],
      files: ['Evidence/a.pdf', 'Evidence/Bank/b.pdf'],
    });
  });

  it('treats a plain multi-file pick as loose files', () => {
    const plan = planFromFileList([new File(['x'], 'a.pdf'), new File(['x'], 'b.pdf')]);
    expect(summary(plan)).toEqual({ dirs: [], files: ['a.pdf', 'b.pdf'] });
  });
});

describe('planFromDataTransfer', () => {
  it('walks dropped folders, keeping structure and empty folders', async () => {
    const plan = await planFromDataTransfer(
      dropOf([
        dirEntry('Evidence', [
          fileEntry('a.pdf'),
          dirEntry('Bank', [fileEntry('b.csv')]),
          dirEntry('Empty', []),
        ]),
        fileEntry('loose.txt'),
      ]),
    );
    expect(summary(plan)).toEqual({
      dirs: ['Evidence', 'Evidence/Bank', 'Evidence/Empty'],
      files: ['Evidence/a.pdf', 'Evidence/Bank/b.csv', 'loose.txt'],
    });
  });

  it('keeps reading a directory until readEntries returns an empty batch', async () => {
    const children = Array.from({ length: 250 }, (_, i) => fileEntry(`f${i}.txt`));
    const plan = await planFromDataTransfer(dropOf([dirEntry('Big', children, 100)]));
    expect(plan.files).toHaveLength(250);
  });

  it('falls back to getAsFile when an item has no entry', async () => {
    const plan = await planFromDataTransfer(dropOf([new File(['x'], 'a.pdf')]));
    expect(summary(plan)).toEqual({ dirs: [], files: ['a.pdf'] });
  });

  it('falls back to dataTransfer.files when there is no item list', async () => {
    const file = new File(['x'], 'a.pdf');
    const plan = await planFromDataTransfer({ files: [file] } as unknown as DataTransfer);
    expect(plan.files[0].file).toBe(file);
  });
});
