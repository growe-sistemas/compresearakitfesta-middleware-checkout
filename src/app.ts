import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { corsOrigins } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { httpLogger, requestId } from './middleware/requestContext.js';
import { apiRouter } from './routes/index.js';
import { healthRouter } from './routes/health.js';

export function createApp(): Express {
  const app = express();

  // Render fica atras de proxy: sem isso req.ip e o protocolo vem errados.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({ origin: corsOrigins() }));
  app.use(requestId);
  app.use(httpLogger);
  app.use(express.json({ limit: '1mb' }));

  // Health check vem antes de qualquer auth.
  app.use(healthRouter);
  app.use(apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
