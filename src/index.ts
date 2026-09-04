import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';

/** Tempo maximo esperando as conexoes em voo antes de derrubar a marretada. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const app = createApp();

// 0.0.0.0 e obrigatorio no Render: bind em localhost nao recebe trafego.
const server = app.listen(env.PORT, '0.0.0.0', () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, vtexAccount: env.VTEX_ACCOUNT },
    'Middleware no ar',
  );
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'Encerrando: parando de aceitar novas conexoes');

  const forceExit = setTimeout(() => {
    logger.error('Conexoes nao encerraram a tempo, saindo a forca');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close((err) => {
    if (err !== undefined) {
      logger.error({ err }, 'Erro ao encerrar o servidor');
      process.exit(1);
    }
    logger.info('Encerrado com sucesso');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Promise rejeitada sem tratamento');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Excecao nao capturada');
  process.exit(1);
});
