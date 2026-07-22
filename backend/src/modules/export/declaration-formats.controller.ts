import {
  Controller, Get, Header, Param, Req, BadRequestException,
} from '@nestjs/common';
import { getPrincipal } from '../auth/access-principal';
import { ProductionsService } from '../productions/productions.service';
import { listFormatSummaries } from './formats/registry';
import { renderDeclarationHtml } from './templates/declaration';
import { DeclarationData } from '../productions/declaration-data';

/**
 * Read-only declaration-format endpoints. Any authenticated user can list
 * formats (app-wide, no org/case scoping). The preview route loads a
 * production and enforces the same case-access check as the normal
 * GET /productions/:id read (ProductionsController#findOne) so a caller
 * can't preview a declaration in a case they don't have access to.
 */
@Controller()
export class DeclarationFormatsController {
  constructor(private readonly productionsService: ProductionsService) {}

  @Get('declaration-formats')
  listFormats() {
    return listFormatSummaries();
  }

  @Get('productions/:id/declaration-preview')
  @Header('Content-Type', 'text/html')
  async preview(@Param('id') id: string, @Req() req: any) {
    const production = await this.productionsService.findOne(id, getPrincipal(req));
    if (production.type !== 'declaration') {
      throw new BadRequestException(`Production ${id} is not a declaration`);
    }
    const data = production.data as any;
    return renderDeclarationHtml(data as DeclarationData);
  }
}
