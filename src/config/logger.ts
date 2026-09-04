import pino from 'pino';
import { env } from './env.js';

/**
 * Campos que jamais podem aparecer no log. O appToken da VTEX vai em header,
 * entao redigimos tanto o header quanto qualquer campo homonimo em objetos.
 */
const REDACT_PATHS = [
  'req.headers["x-vtex-api-apptoken"]',
  'req.headers["x-vtex-api-appkey"]',
  'req.headers["x-api-key"]',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers["x-vtex-api-apptoken"]',
  'headers["x-vtex-api-appkey"]',
  'headers["x-api-key"]',
  'appToken',
  'appKey',
  'apiKey',
  '*.appToken',
  '*.appKey',
  '*.apiKey',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'middleware-checkout' },
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  formatters: {
    level: (label) => ({ level: label }),
  },
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
        },
      }
    : {}),
});

export type Logger = typeof logger;
