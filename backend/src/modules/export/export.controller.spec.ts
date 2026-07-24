import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ExportController } from './export.controller';
import { RedlineController } from './redline.controller';
import { ExportService } from './export.service';
import { ProductionsService } from '../productions/productions.service';
import { InvestigationsService } from '../investigations/investigations.service';
import { DataRoomService } from '../data-room/data-room.service';
import { applyTrackedChangesToDocx } from './docx-redline';

jest.mock('./docx-redline', () => ({
  applyTrackedChangesToDocx: jest.fn(),
}));

/**
 * Build a minimal mock Response compatible with the controller's usage of
 * `res.setHeader()` and `res.send()`.
 */
function makeMockRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    _headers: headers,
    _body: undefined as any,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    send(body: any) {
      res._body = body;
    },
  };
  return res;
}

/**
 * Build a minimal mock Request with an authenticated user.
 */
function makeMockReq(userId = 'user-1') {
  return { user: { id: userId } };
}

const FAKE_PDF = Buffer.from('%PDF-1.4 fake');
const FAKE_DOCX = Buffer.from('PK fake docx');
const FAKE_PNG = Buffer.from('\x89PNG fake');

describe('ExportController', () => {
  let controller: ExportController;
  let exportService: jest.Mocked<ExportService>;
  let productionsService: jest.Mocked<ProductionsService>;
  let dataRoomService: jest.Mocked<DataRoomService>;

  beforeEach(async () => {
    (applyTrackedChangesToDocx as jest.Mock).mockReset();

    const mockExportService: Partial<jest.Mocked<ExportService>> = {
      htmlToPdf: jest.fn().mockResolvedValue(FAKE_PDF),
      htmlToDocx: jest.fn().mockResolvedValue(FAKE_DOCX),
      htmlToPng: jest.fn().mockResolvedValue(FAKE_PNG),
      pngToPdf: jest.fn().mockResolvedValue(FAKE_PDF),
    };

    const mockProductionsService: Partial<jest.Mocked<ProductionsService>> = {
      findOne: jest.fn(),
    };

    const mockInvestigationsService: Partial<jest.Mocked<InvestigationsService>> = {
      findOne: jest.fn(),
    };

    const mockDataRoomService: Partial<jest.Mocked<DataRoomService>> = {
      getFileForRedline: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExportController],
      providers: [
        { provide: ExportService, useValue: mockExportService },
        { provide: ProductionsService, useValue: mockProductionsService },
        { provide: InvestigationsService, useValue: mockInvestigationsService },
        { provide: DataRoomService, useValue: mockDataRoomService },
      ],
    }).compile();

    controller = module.get<ExportController>(ExportController);
    exportService = module.get(ExportService);
    productionsService = module.get(ProductionsService);
    dataRoomService = module.get(DataRoomService);
  });

  // ── format gating: disallowed combinations return 400 ─────────────────────

  it('report + format "png" → 400 BadRequestException', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-1',
      type: 'report',
      name: 'My Report',
      data: { content: '<p>Hello</p>' },
    });

    await expect(
      controller.exportProduction(
        'prod-1',
        { format: 'png' },
        makeMockReq(),
        makeMockRes(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('chart + format "docx" → 400 BadRequestException', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-2',
      type: 'chart',
      name: 'Volume Chart',
      data: {},
    });

    await expect(
      controller.exportProduction(
        'prod-2',
        { format: 'docx' },
        makeMockReq(),
        makeMockRes(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('unknown format string → 400 BadRequestException', async () => {
    await expect(
      controller.exportProduction(
        'prod-3',
        { format: 'html' } as any,
        makeMockReq(),
        makeMockRes(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ── chronology + csv → reaches CSV branch ──────────────────────────────────

  it('chronology + format "csv" → returns text/csv with BOM and header row', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-csv',
      type: 'chronology',
      name: 'Timeline',
      data: {
        entries: [
          {
            date: '2024-01-01',
            sourceUrl: 'https://etherscan.io/tx/0x1234567890abcdef',
            sourceLabel: '0x1234…',
            description: 'Initial transfer, of funds',
            details: 'Line one\nLine two',
            highlight: 'yellow',
          },
        ],
      },
    });

    const res = makeMockRes();
    await controller.exportProduction(
      'prod-csv',
      { format: 'csv' },
      makeMockReq(),
      res,
    );

    expect(res._headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(res._headers['Content-Disposition']).toMatch(/\.csv"$/);
    const body = res._body as string;
    expect(body.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM
    expect(body).toContain('Source URL,Source Label,Date,Description,Details,Highlight');
    expect(body).toContain('"Initial transfer, of funds"'); // comma forces quoting
    expect(body).toContain('"Line one\nLine two"');         // newline forces quoting
    expect(body).toContain('yellow');
    // Did NOT touch any HTML pipeline
    expect(exportService.htmlToPdf).not.toHaveBeenCalled();
    expect(exportService.htmlToPng).not.toHaveBeenCalled();
    expect(exportService.htmlToDocx).not.toHaveBeenCalled();
  });

  it('report + format "csv" → 400 BadRequestException', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-csv-bad',
      type: 'report',
      name: 'My Report',
      data: { content: '<p>x</p>' },
    });

    const res = makeMockRes();
    await expect(
      controller.exportProduction('prod-csv-bad', { format: 'csv' }, makeMockReq(), res),
    ).rejects.toThrow(BadRequestException);
  });

  // ── chronology + png → reaches PNG branch ─────────────────────────────────

  it('chronology + format "png" → reaches PNG branch (calls htmlToPng, returns image/png)', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-4',
      type: 'chronology',
      name: 'Timeline',
      data: { rows: [] },
    });

    const res = makeMockRes();
    await controller.exportProduction(
      'prod-4',
      { format: 'png' },
      makeMockReq(),
      res,
    );

    expect(exportService.htmlToPng).toHaveBeenCalledTimes(1);
    expect(res._headers['Content-Type']).toBe('image/png');
    expect(res._headers['Content-Disposition']).toMatch(/\.png"$/);
    expect(res._body).toBe(FAKE_PNG);
  });

  // ── report + docx ──────────────────────────────────────────────────────────

  it('report + format "docx" → calls htmlToDocx, returns correct Content-Type', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-5',
      type: 'report',
      name: 'Q1 Report',
      data: { content: '<p>Report content</p>' },
    });

    const res = makeMockRes();
    await controller.exportProduction(
      'prod-5',
      { format: 'docx' },
      makeMockReq(),
      res,
    );

    expect(exportService.htmlToDocx).toHaveBeenCalledTimes(1);
    expect(res._headers['Content-Type']).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(res._headers['Content-Disposition']).toMatch(/\.docx"$/);
    expect(res._body).toBe(FAKE_DOCX);
  });

  // ── filename field ─────────────────────────────────────────────────────────

  it('uses body.filename for Content-Disposition when provided', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-6',
      type: 'chronology',
      name: 'Timeline',
      data: { rows: [] },
    });

    const res = makeMockRes();
    await controller.exportProduction(
      'prod-6',
      { format: 'pdf', filename: 'My Custom Filename' },
      makeMockReq(),
      res,
    );

    // Sanitized: spaces → _, lower-cased
    expect(res._headers['Content-Disposition']).toContain('my_custom_filename.pdf');
  });

  it('falls back to production.name for Content-Disposition when filename absent', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-7',
      type: 'chronology',
      name: 'Smith Timeline',
      data: { rows: [] },
    });

    const res = makeMockRes();
    await controller.exportProduction(
      'prod-7',
      { format: 'pdf' },
      makeMockReq(),
      res,
    );

    expect(res._headers['Content-Disposition']).toContain('smith_timeline.pdf');
  });

  // ── exportGraph: filename field ────────────────────────────────────────────

  it('exportGraph uses body.filename for Content-Disposition when provided', async () => {
    const res = makeMockRes();
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo='; // minimal valid data URL

    await controller.exportGraph(
      { name: 'graph', filename: 'Custom Graph Name', imageDataUrl },
      makeMockReq(),
      res,
    );

    expect(exportService.pngToPdf).toHaveBeenCalledTimes(1);
    expect(exportService.htmlToPdf).not.toHaveBeenCalled();
    expect(res._headers['Content-Disposition']).toContain('custom_graph_name.pdf');
  });

  it('exportGraph falls back to body.name when filename absent', async () => {
    const res = makeMockRes();
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    await controller.exportGraph(
      { name: 'Wallet Trace Alpha', imageDataUrl },
      makeMockReq(),
      res,
    );

    expect(res._headers['Content-Disposition']).toContain('wallet_trace_alpha.pdf');
  });

  // ── exportGraph: orientation ───────────────────────────────────────────────

  it('exportGraph defaults to landscape when orientation omitted', async () => {
    const res = makeMockRes();
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    await controller.exportGraph({ name: 'g', imageDataUrl }, makeMockReq(), res);

    expect(exportService.pngToPdf).toHaveBeenCalledWith(imageDataUrl, { landscape: true });
  });

  it('exportGraph honours orientation "portrait"', async () => {
    const res = makeMockRes();
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    await controller.exportGraph(
      { name: 'g', imageDataUrl, orientation: 'portrait' },
      makeMockReq(),
      res,
    );

    expect(exportService.pngToPdf).toHaveBeenCalledWith(imageDataUrl, { landscape: false });
  });

  it('exportGraph honours orientation "landscape"', async () => {
    const res = makeMockRes();
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    await controller.exportGraph(
      { name: 'g', imageDataUrl, orientation: 'landscape' },
      makeMockReq(),
      res,
    );

    expect(exportService.pngToPdf).toHaveBeenCalledWith(imageDataUrl, { landscape: true });
  });

  it('exportGraph rejects invalid orientation values', async () => {
    const res = makeMockRes();
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    await expect(
      controller.exportGraph(
        { name: 'g', imageDataUrl, orientation: 'sideways' } as any,
        makeMockReq(),
        res,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ── auth guard ─────────────────────────────────────────────────────────────

  it('exportProduction without authenticated user → ForbiddenException', async () => {
    await expect(
      controller.exportProduction(
        'prod-8',
        { format: 'pdf' },
        { user: undefined },
        makeMockRes(),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // ── render options: fontFamily / fontSize / orientation ───────────────────

  describe('render options', () => {
    const chronology = {
      id: 'prod-c',
      type: 'chronology',
      name: 'Timeline',
      data: { entries: [{ date: '2026-01-01', description: 'a' }] },
    };
    const report = {
      id: 'prod-r',
      type: 'report',
      name: 'Report',
      data: { content: '<p>hi</p>' },
    };

    it('chronology pdf with orientation "landscape" → htmlToPdf called with landscape:true', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(chronology);
      await controller.exportProduction(
        'prod-c',
        { format: 'pdf', orientation: 'landscape' },
        makeMockReq(),
        makeMockRes(),
      );
      expect(exportService.htmlToPdf).toHaveBeenCalledWith(expect.any(String), { landscape: true });
    });

    it('chronology pdf without orientation → defaults to portrait', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(chronology);
      await controller.exportProduction(
        'prod-c',
        { format: 'pdf' },
        makeMockReq(),
        makeMockRes(),
      );
      expect(exportService.htmlToPdf).toHaveBeenCalledWith(expect.any(String), { landscape: false });
    });

    it('report pdf ignores orientation (always portrait)', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(report);
      await controller.exportProduction(
        'prod-r',
        { format: 'pdf', orientation: 'landscape' } as any,
        makeMockReq(),
        makeMockRes(),
      );
      expect(exportService.htmlToPdf).toHaveBeenCalledWith(expect.any(String), { landscape: false });
    });

    it('chronology pdf injects chosen font/size into the HTML passed to htmlToPdf', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(chronology);
      await controller.exportProduction(
        'prod-c',
        { format: 'pdf', fontFamily: 'georgia', fontSize: 14 },
        makeMockReq(),
        makeMockRes(),
      );
      const html = (exportService.htmlToPdf as jest.Mock).mock.calls[0][0];
      expect(html).toMatch(/font-family:\s*Georgia/);
      expect(html).toMatch(/font-size:\s*14pt/);
    });

    it('report docx injects chosen font/size into the HTML passed to htmlToDocx', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(report);
      await controller.exportProduction(
        'prod-r',
        { format: 'docx', fontFamily: 'times', fontSize: 12 },
        makeMockReq(),
        makeMockRes(),
      );
      const html = (exportService.htmlToDocx as jest.Mock).mock.calls[0][0];
      expect(html).toMatch(/font-family:\s*'Times New Roman'/);
      expect(html).toMatch(/font-size:\s*12pt/);
    });

    it('rejects an unknown fontFamily', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(report);
      await expect(
        controller.exportProduction(
          'prod-r',
          { format: 'pdf', fontFamily: 'comic-sans' } as any,
          makeMockReq(),
          makeMockRes(),
        ),
      ).rejects.toThrow(/fontFamily/);
    });

    it('rejects an unknown fontSize', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(report);
      await expect(
        controller.exportProduction(
          'prod-r',
          { format: 'pdf', fontSize: 99 } as any,
          makeMockReq(),
          makeMockRes(),
        ),
      ).rejects.toThrow(/fontSize/);
    });

    it('rejects an unknown orientation', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(chronology);
      await expect(
        controller.exportProduction(
          'prod-c',
          { format: 'pdf', orientation: 'sideways' } as any,
          makeMockReq(),
          makeMockRes(),
        ),
      ).rejects.toThrow(/orientation/);
    });
  });

  // ── redline ──────────────────────────────────────────────────────────────

  describe('redline', () => {
    const acceptedEdit = {
      id: 'e1',
      kind: 'delete' as const,
      anchor: { text: 'quick brown fox', start: 4, end: 19 },
      newText: '',
      basis: 'basis text',
      status: 'accepted' as const,
      origin: 'user' as const,
    };
    const proposedEdit = {
      id: 'e2',
      kind: 'insert_after' as const,
      anchor: { text: 'lazy dog', start: 35, end: 43 },
      newText: ' indeed',
      basis: 'another basis',
      status: 'proposed' as const,
      origin: 'agent' as const,
    };

    function makeRedline(overrides: {
      id: string;
      sourceKind: 'docx' | 'pdf';
      edits: any[];
    }) {
      return {
        id: overrides.id,
        type: 'redline',
        name: 'Widmann Redline',
        caseId: 'case-1',
        data: {
          schemaVersion: 1,
          source: {
            fileId: 'f1',
            fileName: overrides.sourceKind === 'docx' ? 'agreement.docx' : 'agreement.pdf',
            mimeType: overrides.sourceKind === 'docx' ? 'application/vnd.x' : 'application/pdf',
            kind: overrides.sourceKind,
            extractedAt: '2026-01-01T00:00:00.000Z',
          },
          baseText: 'The quick brown fox jumps over the lazy dog.',
          edits: overrides.edits,
          comments: [],
        },
      };
    }

    // Non-docx-specific fixture used by the pre-existing pdf/png/csv tests.
    const redline = makeRedline({ id: 'prod-redline', sourceKind: 'docx', edits: [acceptedEdit, proposedEdit] });

    it('redline + format "pdf" → allowed, renders portrait Letter with 1in margins', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(redline);
      const res = makeMockRes();
      await controller.exportProduction('prod-redline', { format: 'pdf' }, makeMockReq(), res);

      expect(exportService.htmlToPdf).toHaveBeenCalledWith(expect.any(String), {
        landscape: false,
        pageFormat: 'Letter',
        margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' },
      });
      expect(res._headers['Content-Type']).toBe('application/pdf');
      expect(res._body).toBe(FAKE_PDF);
    });

    it('redline + format "pdf" with zero accepted edits (all proposed) → still exports a PDF, no guard', async () => {
      const allProposed = makeRedline({ id: 'prod-redline-pdf-noaccept', sourceKind: 'docx', edits: [proposedEdit] });
      (productionsService.findOne as jest.Mock).mockResolvedValue(allProposed);
      const res = makeMockRes();
      await controller.exportProduction('prod-redline-pdf-noaccept', { format: 'pdf' }, makeMockReq(), res);

      expect(res._headers['Content-Type']).toBe('application/pdf');
      expect(res._body).toBe(FAKE_PDF);
    });

    it('redline + format "png" → 400 BadRequestException', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(redline);
      await expect(
        controller.exportProduction('prod-redline', { format: 'png' }, makeMockReq(), makeMockRes()),
      ).rejects.toThrow(BadRequestException);
    });

    it('redline + format "csv" → 400 BadRequestException', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(redline);
      await expect(
        controller.exportProduction('prod-redline', { format: 'csv' }, makeMockReq(), makeMockRes()),
      ).rejects.toThrow(BadRequestException);
    });

    // ── docx gold path (source.kind === 'docx') ────────────────────────────

    it('redline + docx, source.kind "docx", ≥1 accepted edit → tracked-changes buffer via applyTrackedChangesToDocx', async () => {
      const production = makeRedline({ id: 'prod-redline-docx', sourceKind: 'docx', edits: [acceptedEdit, proposedEdit] });
      (productionsService.findOne as jest.Mock).mockResolvedValue(production);
      const sourceBuffer = Buffer.from('PK source docx');
      (dataRoomService.getFileForRedline as jest.Mock).mockResolvedValue({
        name: 'agreement.docx',
        mimeType: 'application/vnd.x',
        buffer: sourceBuffer,
      });
      const trackedBuffer = Buffer.from('PK tracked-changes docx');
      (applyTrackedChangesToDocx as jest.Mock).mockResolvedValue({ docx: trackedBuffer, failed: [] });

      const res = makeMockRes();
      await controller.exportProduction('prod-redline-docx', { format: 'docx' }, makeMockReq('user-9'), res);

      expect(dataRoomService.getFileForRedline).toHaveBeenCalledWith('case-1', 'f1', 'user-9');
      expect(applyTrackedChangesToDocx).toHaveBeenCalledWith(
        sourceBuffer,
        [acceptedEdit],
        expect.objectContaining({ author: 'Daubert' }),
      );
      expect(exportService.htmlToDocx).not.toHaveBeenCalled();
      expect(res._headers['Content-Type']).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      expect(res._body).toBe(trackedBuffer);
    });

    it('redline + docx, source.kind "docx", applyTrackedChangesToDocx reports failed edits → 400 listing anchor quotes', async () => {
      const production = makeRedline({ id: 'prod-redline-docx-fail', sourceKind: 'docx', edits: [acceptedEdit] });
      (productionsService.findOne as jest.Mock).mockResolvedValue(production);
      (dataRoomService.getFileForRedline as jest.Mock).mockResolvedValue({
        name: 'agreement.docx',
        mimeType: 'application/vnd.x',
        buffer: Buffer.from('PK source docx'),
      });
      (applyTrackedChangesToDocx as jest.Mock).mockResolvedValue({
        docx: Buffer.from(''),
        failed: [{ editId: 'e1', anchorText: 'quick brown fox', reason: 'anchor_not_found' }],
      });

      await expect(
        controller.exportProduction('prod-redline-docx-fail', { format: 'docx' }, makeMockReq(), makeMockRes()),
      ).rejects.toThrow(BadRequestException);

      try {
        await controller.exportProduction('prod-redline-docx-fail', { format: 'docx' }, makeMockReq(), makeMockRes());
        fail('expected exportProduction to throw');
      } catch (e) {
        expect((e as Error).message).toContain('quick brown fox');
      }
    });

    it('redline + docx, getFileForRedline throws NotFoundException → 400 "Source document no longer in the data room"', async () => {
      const production = makeRedline({ id: 'prod-redline-docx-gone', sourceKind: 'docx', edits: [acceptedEdit] });
      (productionsService.findOne as jest.Mock).mockResolvedValue(production);
      (dataRoomService.getFileForRedline as jest.Mock).mockRejectedValue(new NotFoundException('file_not_found'));

      await expect(
        controller.exportProduction('prod-redline-docx-gone', { format: 'docx' }, makeMockReq(), makeMockRes()),
      ).rejects.toThrow(/Source document no longer in the data room/);
    });

    it('redline + docx, zero accepted edits (source.kind "docx") → 400 "No accepted edits to export"', async () => {
      const production = makeRedline({ id: 'prod-redline-docx-noaccept', sourceKind: 'docx', edits: [proposedEdit] });
      (productionsService.findOne as jest.Mock).mockResolvedValue(production);

      await expect(
        controller.exportProduction('prod-redline-docx-noaccept', { format: 'docx' }, makeMockReq(), makeMockRes()),
      ).rejects.toThrow(/No accepted edits to export/);
      expect(dataRoomService.getFileForRedline).not.toHaveBeenCalled();
    });

    // ── docx reconstructed path (source.kind === 'pdf') ─────────────────────

    it('redline + docx, source.kind "pdf" → falls through to htmlToDocx, filename has _reconstructed suffix', async () => {
      const production = makeRedline({ id: 'prod-redline-pdf', sourceKind: 'pdf', edits: [acceptedEdit] });
      (productionsService.findOne as jest.Mock).mockResolvedValue(production);

      const res = makeMockRes();
      await controller.exportProduction('prod-redline-pdf', { format: 'docx', filename: 'my-redline' }, makeMockReq(), res);

      expect(exportService.htmlToDocx).toHaveBeenCalledTimes(1);
      expect(applyTrackedChangesToDocx).not.toHaveBeenCalled();
      expect(dataRoomService.getFileForRedline).not.toHaveBeenCalled();
      expect(res._headers['Content-Disposition']).toContain('my-redline_reconstructed.docx');
      expect(res._body).toBe(FAKE_DOCX);
    });

    it('redline + docx, zero accepted edits (source.kind "pdf") → 400 "No accepted edits to export"', async () => {
      const production = makeRedline({ id: 'prod-redline-pdf-noaccept', sourceKind: 'pdf', edits: [proposedEdit] });
      (productionsService.findOne as jest.Mock).mockResolvedValue(production);

      await expect(
        controller.exportProduction('prod-redline-pdf-noaccept', { format: 'docx' }, makeMockReq(), makeMockRes()),
      ).rejects.toThrow(/No accepted edits to export/);
      expect(exportService.htmlToDocx).not.toHaveBeenCalled();
    });
  });
});

// ── RedlineController: redline-preview route ──────────────────────────────

describe('RedlineController', () => {
  let controller: RedlineController;
  let productionsService: jest.Mocked<ProductionsService>;

  beforeEach(async () => {
    const mockProductionsService: Partial<jest.Mocked<ProductionsService>> = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RedlineController],
      providers: [{ provide: ProductionsService, useValue: mockProductionsService }],
    }).compile();

    controller = module.get<RedlineController>(RedlineController);
    productionsService = module.get(ProductionsService);
  });

  function makeMockPrincipalReq() {
    return { principal: { kind: 'user', userId: 'user-1' } };
  }

  it('redline-preview route 400s for a non-redline production', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-decl',
      type: 'declaration',
      name: 'Not A Redline',
      data: {},
    });

    await expect(
      controller.preview('prod-decl', 'triage', makeMockPrincipalReq()),
    ).rejects.toThrow(BadRequestException);
  });

  it('redline-preview route renders HTML for a redline production', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-redline',
      type: 'redline',
      name: 'Widmann Redline',
      data: {
        schemaVersion: 1,
        source: { fileId: 'f1', fileName: 'agreement.docx', mimeType: 'application/vnd.x', kind: 'docx', extractedAt: '2026-01-01T00:00:00.000Z' },
        baseText: 'The quick brown fox jumps over the lazy dog.',
        edits: [],
        comments: [],
      },
    });

    const html = await controller.preview('prod-redline', 'triage', makeMockPrincipalReq());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Widmann Redline');
  });
});
