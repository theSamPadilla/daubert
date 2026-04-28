import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from './modules/auth/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly dataSource: DataSource) {}

  @Public()
  @Get('health')
  async health() {
    await this.dataSource.query('SELECT 1');
    return { status: 'ok' };
  }
}
