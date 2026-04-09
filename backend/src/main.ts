import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  // Disable NestJS's built-in body parser so ours (with a higher limit) wins
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Register before any other middleware so the limit applies everywhere
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.listen(8081);
  console.log('Daubert backend running on http://localhost:8081');
}

bootstrap();
