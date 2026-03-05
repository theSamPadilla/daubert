import { IsString } from 'class-validator';

export class GetAddressInfoDto {
  @IsString()
  address: string;

  @IsString()
  chain: string;
}
