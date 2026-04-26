import {
  Controller, Post, Param, Body, Res, Req,
  BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { Response } from 'express';
import { ExportService } from './export.service';
import { ProductionsService } from '../productions/productions.service';
import { renderReport } from './templates/report';
import { renderChronology } from './templates/chronology';
import { renderChart } from './templates/chart';
import { renderGraph } from './templates/graph';
import { validateDataUrl } from './templates/util';

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
  ) {}

  private getUserId(req: any): string {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException('Authentication required');
    return userId;
  }

  @Post('productions/:id')
  async exportProduction(
    @Param('id') id: string,
    @Body() body: { format: string; imageDataUrl?: string },
    @Req() req: any,
    @Res() res: Response,
  ) {
    const userId = this.getUserId(req);
    const format = body.format;
    if (!format || !['pdf', 'html'].includes(format)) {
      throw new BadRequestException('format must be "pdf" or "html"');
    }

    const production = await this.productionsService.findOne(id, userId);
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

    const safeName = (production.name || 'export').replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'export';

    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.html"`);
      res.send(html);
      return;
    }

    const pdf = await this.exportService.htmlToPdf(html, {
      landscape: production.type === 'chart',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
    res.send(pdf);
  }

  @Post('graph')
  async exportGraph(
    @Body() body: { name: string; imageDataUrl: string },
    @Req() req: any,
    @Res() res: Response,
  ) {
    this.getUserId(req); // Auth required — prevents unauthenticated Puppeteer usage
    if (!body.imageDataUrl) {
      throw new BadRequestException('imageDataUrl is required');
    }
    validateDataUrl(body.imageDataUrl);
    const name = (body.name || 'graph').slice(0, 200);
    const html = renderGraph(name, body.imageDataUrl);
    const pdf = await this.exportService.htmlToPdf(html, { landscape: true });
    const safeName = (name || 'graph').replace(/[^a-z0-9_-]/gi, '_').toLowerCase() || 'graph';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
    res.send(pdf);
  }
}
