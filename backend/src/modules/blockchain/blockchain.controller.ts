import { Controller, Post, Body } from '@nestjs/common';
import { BlockchainService } from './blockchain.service';
import { FetchHistoryDto } from './dto/fetch-history.dto';

@Controller('blockchain')
export class BlockchainController {
  constructor(private readonly blockchainService: BlockchainService) {}

  @Post('fetch-history')
  async fetchHistory(@Body() dto: FetchHistoryDto) {
    return this.blockchainService.fetchHistory(
      dto.address,
      dto.chain,
      dto.options,
    );
  }
}
