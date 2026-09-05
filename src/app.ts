import path from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { corsOrigins } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { httpLogger, requestId } from './middleware/requestContext.js';
import { apiRouter } from './routes/index.js';
import { healthRouter } from './routes/health.js';

/**
 * Pasta da pagina de status, resolvida a partir DESTE modulo — nao do
 * diretorio de trabalho.
 *
 * Funciona igual nos dois modos: em desenvolvimento o modulo esta em `src/`
 * e em producao em `dist/` — os dois com a `public/` um nivel acima. Assim
 * nao ha passo de copia no build nem dependencia de onde o `npm start` foi
 * chamado.
 */
const PUBLIC_DIR = path.resolve(__dirname, '../public');

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

  /**
   * Pagina de status em `/`. Estatica: os dados de deploy ela busca do
   * `/health`, entao nao ha template para renderizar no servidor.
   *
   * `index: 'index.html'` so na raiz e `redirect: false` para nao transformar
   * a pasta em servidor de arquivos: nada mais mora ali.
   */
  app.use(
    express.static(PUBLIC_DIR, {
      index: 'index.html',
      redirect: false,
      // Sem cache de tempo: uma pagina que mostra a data do deploy nao pode
      // ficar velha justamente depois de um deploy. O `etag` (padrao) resolve
      // o custo — repeticao vira 304, nao download.
      maxAge: 0,
    }),
  );

  app.use(apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
