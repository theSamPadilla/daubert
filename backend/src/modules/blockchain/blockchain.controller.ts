import { Controller, Post, Body } from '@nestjs/common';
import { BlockchainService } from './blockchain.service';
import { FetchHistoryDto } from './dto/fetch-history.dto';
import { GetTransactionDto } from './dto/get-transaction.dto';
import { GetAddressInfoDto } from './dto/get-address-info.dto';

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

  @Post('get-transaction')
  async getTransaction(@Body() dto: GetTransactionDto) {
    return this.blockchainService.getTransaction(dto.txHash, dto.chain);
  }

  @Post('get-address-info')
  async getAddressInfo(@Body() dto: GetAddressInfoDto) {
    return this.blockchainService.getAddressInfo(dto.address, dto.chain);
  }
}
