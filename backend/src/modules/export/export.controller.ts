import {
  Controller, Post, Param, Body, Res, Req,
  BadRequestException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { ExportService } from './export.service';
import { ProductionsService } from '../productions/productions.service';
import { InvestigationsService } from '../investigations/investigations.service';
import { DataRoomService } from '../data-room/data-room.service';
import { renderReport } from './templates/report';
import { renderChronology, renderChronologyCsv } from './templates/chronology';
import { renderChart } from './templates/chart';
import {
  renderDeclarationHtml,
  buildDeclarationFooterTemplate,
  resolveFormatId,
} from './templates/declaration';
import { renderRedlineHtml } from './templates/redline';
import { applyTrackedChangesToDocx } from './docx-redline';
import { getFormat } from './formats/registry';
import { DeclarationData } from '../productions/declaration-data';
import { RedlineData } from '../productions/redline-data';
import { renderReportBody } from './templates/report';
import { renderChronologyBody } from './templates/chronology';
import { renderChartBody } from './templates/chart';
import { renderGraphBody } from './templates/graph';
import { validateDataUrl } from './templates/util';
import { ExportExhibitDto } from './exhibit.dto';
import { composeExhibitHtml } from './exhibit-composer';
import {
  FontFamily, FontSize, Orientation, RenderOptions,
  isFontFamily, isFontSize, isOrientation,
} from './render-options';

/**
 * Requires authentication. Global AuthGuard runs first, but in dev mode
 * req.user can be undefined if Firebase isn't configured and no dev user
 * exists. We assert userId is present before proceeding.
 */
@Controller('exports')
export class ExportController {
  constructor(
    private readonly exportService: ExportService,
    private readonly productionsService: ProductionsService,
    private readonly investigationsService: InvestigationsService,
    private readonly dataRoom: DataRoomService,
  ) {}

  private getUserId(req: any): string {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('Authentication required');
    return userId;
  }

  @Post('productions/:id')
  async exportProduction(
    @Param('id') id: string,
    @Body() body: {
      format: string;
      filename?: string;
      imageDataUrl?: string;
      fontFamily?: string;
      fontSize?: number;
      orientation?: string;
    },
    @Req() req: any,
    @Res() res: Response,
  ) {
    const userId = this.getUserId(req);
    const format = body.format;
    if (!['pdf', 'png', 'docx', 'csv'].includes(format)) {
      throw new BadRequestException('format must be "pdf", "png", "docx", or "csv"');
    }

    const production = await this.productionsService.findOne(id, { kind: 'user', userId });

    const ALLOWED: Record<string, string[]> = {
      report:      ['pdf', 'docx'],
      chronology:  ['pdf', 'png', 'csv'],
      chart:       ['pdf'],          // png is client-side, never hits backend
      declaration: ['pdf', 'docx'],  // pdf = pleading-paper Puppeteer; docx = gutterless
      redline:     ['pdf', 'docx'],  // docx: tracked-changes gold path (source.kind 'docx') or reconstructed htmlToDocx (source.kind 'pdf')
    };
    const allowed = ALLOWED[production.type];
    if (!allowed?.includes(format)) {
      throw new BadRequestException(`Format "${format}" not supported for ${production.type}`);
    }

    const filename = (body.filename || production.name || 'export').replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'export';

    if (format === 'csv') {
      // chronology is the only type that reaches here (ALLOWED gates it).
      const csv = renderChronologyCsv(production.data as any);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(csv);
      return;
    }

    const renderOpts = parseRenderOptions(body);
    const orientation = parseOrientation(body.orientation);

    const data = production.data as any;
    let html: string;

    switch (production.type) {
      case 'report':
        html = renderReport(production.name, data, renderOpts);
        break;
      case 'chronology':
        html = renderChronology(production.name, data, renderOpts);
        break;
      case 'chart': {
        const imageDataUrl = body.imageDataUrl;
        if (!imageDataUrl) {
          throw new BadRequestException('Chart export requires imageDataUrl in request body');
        }
        validateDataUrl(imageDataUrl);
        html = renderChart(production.name, imageDataUrl);
        break;
      }
      case 'declaration':
        // docx can't honour the fixed pleading gutter — render gutterless.
        html = renderDeclarationHtml(data as DeclarationData, { docx: format === 'docx' });
        break;
      case 'redline':
        // Export always renders the clean, accepted-only view; the triage
        // (all-edits) view is preview-only via RedlineController.
        html = renderRedlineHtml(data as RedlineData, { mode: 'accepted', productionName: production.name });
        break;
      default:
        throw new BadRequestException(`Unsupported production type: ${production.type}`);
    }

    if (format === 'docx') {
      // Redline docx has two sub-paths. Gold path (source.kind === 'docx'):
      // apply the accepted edits as native Word tracked changes directly onto
      // the uploaded source bytes. Reconstructed path (source.kind === 'pdf'):
      // no source docx exists, so fall through to the generic htmlToDocx
      // render below — but flag the filename as reconstructed so users don't
      // mistake it for a tracked-changes redline of the original file.
      let docxFilename = filename;
      if (production.type === 'redline') {
        const redline = data as RedlineData;
        const accepted = (redline.edits ?? []).filter((e) => e.status === 'accepted');
        if (accepted.length === 0) {
          throw new BadRequestException('No accepted edits to export');
        }

        if (redline.source?.kind === 'docx') {
          let buffer: Buffer;
          try {
            ({ buffer } = await this.dataRoom.getFileForRedline(production.caseId, redline.source.fileId, userId));
          } catch (e) {
            if (e instanceof NotFoundException) {
              throw new BadRequestException('Source document no longer in the data room — export PDF instead');
            }
            throw e;
          }

          const { docx, failed } = await applyTrackedChangesToDocx(buffer, accepted, {
            author: 'Daubert',
            date: new Date().toISOString(),
          });
          if (failed.length > 0) {
            throw new BadRequestException(
              `Could not place ${failed.length} accepted edit(s) in the source document: ${failed
                .map((f) => JSON.stringify(f.anchorText))
                .join(', ')}`,
            );
          }

          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
          res.setHeader('Content-Disposition', `attachment; filename="${docxFilename}.docx"`);
          res.send(docx);
          return;
        }

        docxFilename = `${filename}_reconstructed`;
      }

      const docx = await this.exportService.htmlToDocx(html);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${docxFilename}.docx"`);
      res.send(docx);
      return;
    }

    if (format === 'png') {
      const png = await this.exportService.htmlToPng(html, { width: 1200 });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.png"`);
      res.send(png);
      return;
    }

    // Declarations render on Letter, portrait. Pleading-gutter formats (CA) get
    // a per-page footer via Puppeteer's footerTemplate and margins tuned to the
    // fixed line-number gutter; non-gutter formats use plain 1in @page margins.
    if (production.type === 'declaration') {
      const decl = data as DeclarationData;
      const format = getFormat(resolveFormatId(decl));
      const pdf = format.pleadingGutter
        ? await this.exportService.htmlToPdf(html, {
            pageFormat: format.pageFormat,
            margin: { top: '0.5in', bottom: '0.75in', left: '0.4in', right: '0.5in' },
            displayHeaderFooter: true,
            footerTemplate: buildDeclarationFooterTemplate(decl),
          })
        : await this.exportService.htmlToPdf(html, {
            pageFormat: format.pageFormat,
            margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' },
          });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
      res.send(pdf);
      return;
    }

    // pdf — chart always lands landscape (image); chronology honours the
    // user's choice (falls back to portrait); report stays portrait; redline
    // renders portrait Letter with plain 1in margins (mirrors the non-gutter
    // declaration branch above).
    let landscape = false;
    if (production.type === 'chart') landscape = true;
    else if (production.type === 'chronology') landscape = orientation === 'landscape';

    const pdfOptions =
      production.type === 'redline'
        ? { landscape, pageFormat: 'Letter' as const, margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' } }
        : { landscape };

    const pdf = await this.exportService.htmlToPdf(html, pdfOptions);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    res.send(pdf);
  }

  @Post('graph')
  async exportGraph(
    @Body() body: { name: string; filename?: string; imageDataUrl: string; orientation?: string },
    @Req() req: any,
    @Res() res: Response,
  ) {
    this.getUserId(req); // Auth required — prevents unauthenticated Puppeteer usage
    if (!body.imageDataUrl) {
      throw new BadRequestException('imageDataUrl is required');
    }
    validateDataUrl(body.imageDataUrl);
    const orientation = parseOrientation(body.orientation);
    const landscape = orientation !== 'portrait'; // default landscape
    const name = (body.name || 'graph').slice(0, 200);
    const pdf = await this.exportService.pngToPdf(body.imageDataUrl, { landscape });
    const filename = (body.filename || name || 'graph').replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'graph';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    res.send(pdf);
  }

  @Post('exhibit')
  async exportExhibit(@Body() body: ExportExhibitDto, @Req() req: any, @Res() res: Response) {
    const userId = this.getUserId(req);

    const composedItems = [] as { title: string; subtitle?: string; bodyHtml: string }[];

    for (const item of body.items) {
      let bodyHtml: string;
      if (item.refType === 'production') {
        const p = await this.productionsService.findOne(item.refId, { kind: 'user', userId });
        const data = p.data as any;
        switch (p.type) {
          case 'report':
            bodyHtml = renderReportBody(p.name, data);
            break;
          case 'chronology':
            bodyHtml = renderChronologyBody(p.name, data);
            break;
          case 'chart':
            if (!item.imageDataUrl) throw new BadRequestException(`Chart item "${p.name}" missing imageDataUrl`);
            validateDataUrl(item.imageDataUrl);
            bodyHtml = renderChartBody(p.name, item.imageDataUrl);
            break;
          default:
            throw new BadRequestException(`Unsupported production type: ${p.type}`);
        }
      } else {
        // investigation
        if (!item.imageDataUrl) throw new BadRequestException(`Investigation item missing imageDataUrl`);
        validateDataUrl(item.imageDataUrl);
        const inv = await this.investigationsService.findOne(item.refId, { kind: 'user', userId });
        bodyHtml = renderGraphBody(inv.name, item.imageDataUrl);
      }
      composedItems.push({ title: item.title, subtitle: item.subtitle, bodyHtml });
    }

    const renderOpts: RenderOptions = {
      fontFamily: body.fontFamily,
      fontSize: body.fontSize,
    };
    const html = composeExhibitHtml(composedItems, renderOpts);
    const pdf = await this.exportService.htmlToPdf(html, { landscape: false });
    const safeName = (body.filename || 'exhibit').replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'exhibit';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
    res.send(pdf);
  }
}

function parseRenderOptions(body: { fontFamily?: unknown; fontSize?: unknown }): RenderOptions {
  const opts: RenderOptions = {};
  if (body.fontFamily !== undefined) {
    if (!isFontFamily(body.fontFamily)) {
      throw new BadRequestException(`fontFamily must be one of helvetica|arial|times|georgia|courier`);
    }
    opts.fontFamily = body.fontFamily as FontFamily;
  }
  if (body.fontSize !== undefined) {
    if (!isFontSize(body.fontSize)) {
      throw new BadRequestException(`fontSize must be one of 9|10|11|12|14`);
    }
    opts.fontSize = body.fontSize as FontSize;
  }
  return opts;
}

function parseOrientation(value: unknown): Orientation | undefined {
  if (value === undefined) return undefined;
  if (!isOrientation(value)) {
    throw new BadRequestException(`orientation must be "portrait" or "landscape"`);
  }
  return value as Orientation;
}
