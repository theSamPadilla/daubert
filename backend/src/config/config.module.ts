import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.validation';

const envFile =
  process.env.NODE_ENV === 'production'
    ? '.env.production'
    : '.env.development';

@Module({
  imports: [
    NestConfigModule.forRoot({
      envFilePath: envFile,
      isGlobal: true,
      validate: () => {
        validateEnv();
        return process.env;
      },
    }),
  ],
})
export class ConfigModule {}
