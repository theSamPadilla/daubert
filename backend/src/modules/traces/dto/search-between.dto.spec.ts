import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WalletSetDto } from './search-between.dto';

describe('WalletSetDto — wallets @Matches(ADDRESS_RE)', () => {
  it('passes validation with a Bitcoin legacy base58 address', async () => {
    const dto = plainToInstance(WalletSetDto, {
      wallets: ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });

  it('passes validation with a Bitcoin bech32/taproot address', async () => {
    const dto = plainToInstance(WalletSetDto, {
      wallets: [
        'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
        'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297',
      ],
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });

  it('still passes validation with EVM and Tron addresses (regression)', async () => {
    const dto = plainToInstance(WalletSetDto, {
      wallets: [
        '0x1234567890123456789012345678901234567890',
        'T123456789ABCDEFGHJKLMNPQRSTUVWXYZ',
      ],
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });

  it('fails validation with a mixed-case bech32 address', async () => {
    const dto = plainToInstance(WalletSetDto, {
      wallets: ['bc1QAR0SRRR7xfkvy5l643lydnw9re59gtzzwf5mdq'],
    });

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('wallets');
  });
});
