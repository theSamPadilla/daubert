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

  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    if (allowedOrigins.length === 0) {
      throw new Error(
        'ALLOWED_ORIGINS must be set in production (comma-separated list of allowed origins)',
      );
    }

    app.enableCors({
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
  } else {
    app.enableCors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = Number(process.env.PORT) || 8081;
  const host = isProduction ? '0.0.0.0' : '127.0.0.1';
  await app.listen(port, host);
  console.log(`Daubert backend running on http://${host}:${port}`);
}

bootstrap();
