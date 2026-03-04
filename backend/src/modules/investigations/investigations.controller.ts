import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { InvestigationsService } from './investigations.service';
import { CreateInvestigationDto } from './dto/create-investigation.dto';
import { UpdateInvestigationDto } from './dto/update-investigation.dto';

@Controller()
export class InvestigationsController {
  constructor(private readonly service: InvestigationsService) {}

  @Get('cases/:caseId/investigations')
  findAllForCase(@Param('caseId') caseId: string) {
    return this.service.findAllForCase(caseId);
  }

  @Post('cases/:caseId/investigations')
  create(
    @Param('caseId') caseId: string,
    @Body() dto: CreateInvestigationDto,
  ) {
    return this.service.create(caseId, dto);
  }

  @Get('investigations/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch('investigations/:id')
  update(@Param('id') id: string, @Body() dto: UpdateInvestigationDto) {
    return this.service.update(id, dto);
  }

  @Delete('investigations/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
