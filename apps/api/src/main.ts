import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { loadConfig, type AppConfig } from './config';

export async function createApp(config: AppConfig) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), { logger: ['error', 'warn'] });
  app.use(cookieParser());
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.useBodyParser('json', { limit: '1mb' });
  app.enableShutdownHooks();
  return app;
}

if (require.main === module) {
  createApp(loadConfig()).then((app) => app.listen(Number(process.env.PORT ?? 3000)));
}
