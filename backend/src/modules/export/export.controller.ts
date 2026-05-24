import {
  Controller, Post, Param, Body, Res, Req,
  BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { Response } from 'express';
import { ExportService } from './export.service';
import { ProductionsService } from '../productions/productions.service';
import { InvestigationsService } from '../investigations/investigations.service';
import { renderReport } from './templates/report';
import { renderChronology } from './templates/chronology';
import { renderChart } from './templates/chart';
import { renderReportBody } from './templates/report';
import { renderChronologyBody } from './templates/chronology';
import { renderChartBody } from './templates/chart';
import { renderGraphBody } from './templates/graph';
import { validateDataUrl } from './templates/util';
import { ExportExhibitDto } from './exhibit.dto';
import { composeExhibitHtml } from './exhibit-composer';

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
  ) {}

  private getUserId(req: any): string {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('Authentication required');
    return userId;
  }

  @Post('productions/:id')
  async exportProduction(
    @Param('id') id: string,
    @Body() body: { format: string; filename?: string; imageDataUrl?: string },
    @Req() req: any,
    @Res() res: Response,
  ) {
    const userId = this.getUserId(req);
    const format = body.format;
    if (!['pdf', 'png', 'docx'].includes(format)) {
      throw new BadRequestException('format must be "pdf", "png", or "docx"');
    }

    const production = await this.productionsService.findOne(id, { kind: 'user', userId });

    const ALLOWED: Record<string, string[]> = {
      report:     ['pdf', 'docx'],
      chronology: ['pdf', 'png'],
      chart:      ['pdf'],          // png is client-side, never hits backend
    };
    const allowed = ALLOWED[production.type];
    if (!allowed?.includes(format)) {
      throw new BadRequestException(`Format "${format}" not supported for ${production.type}`);
    }

    const data = production.data as any;
    let html: string;

    switch (production.type) {
      case 'report':
        html = renderReport(production.name, data);
        break;
      case 'chronology':
        html = renderChronology(production.name, data);
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
      default:
        throw new BadRequestException(`Unsupported production type: ${production.type}`);
    }

    const filename = (body.filename || production.name || 'export').replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'export';

    if (format === 'docx') {
      const docx = await this.exportService.htmlToDocx(html);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.docx"`);
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

    // pdf
    const pdf = await this.exportService.htmlToPdf(html, { landscape: production.type === 'chart' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    res.send(pdf);
  }

  @Post('graph')
  async exportGraph(
    @Body() body: { name: string; filename?: string; imageDataUrl: string },
    @Req() req: any,
    @Res() res: Response,
  ) {
    this.getUserId(req); // Auth required — prevents unauthenticated Puppeteer usage
    if (!body.imageDataUrl) {
      throw new BadRequestException('imageDataUrl is required');
    }
    validateDataUrl(body.imageDataUrl);
    const name = (body.name || 'graph').slice(0, 200);
    const pdf = await this.exportService.pngToPdf(body.imageDataUrl);
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

    const html = composeExhibitHtml(composedItems);
    const pdf = await this.exportService.htmlToPdf(html, { landscape: false });
    const safeName = (body.filename || 'exhibit').replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'exhibit';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
    res.send(pdf);
  }
}
