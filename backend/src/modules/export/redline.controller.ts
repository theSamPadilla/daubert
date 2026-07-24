import {
  Controller, Get, Header, Param, Query, Req, BadRequestException,
} from '@nestjs/common';
import { getPrincipal } from '../auth/access-principal';
import { ProductionsService } from '../productions/productions.service';
import { renderRedlineHtml } from './templates/redline';
import { RedlineData } from '../productions/redline-data';

/**
 * Read-only redline preview endpoint. Loads a production and enforces the
 * same case-access check as the normal GET /productions/:id read
 * (ProductionsController#findOne) so a caller can't preview a redline in a
 * case they don't have access to.
 */
@Controller()
export class RedlineController {
  constructor(private readonly productionsService: ProductionsService) {}

  @Get('productions/:id/redline-preview')
  @Header('Content-Type', 'text/html')
  async preview(@Param('id') id: string, @Query('mode') modeParam: string, @Req() req: any) {
    const production = await this.productionsService.findOne(id, getPrincipal(req));
    if (production.type !== 'redline') {
      throw new BadRequestException(`Production ${id} is not a redline`);
    }
    const mode = modeParam === 'accepted' ? 'accepted' : 'triage';
    const data = production.data as any;
    return renderRedlineHtml(data as RedlineData, { mode, productionName: production.name });
  }
}
