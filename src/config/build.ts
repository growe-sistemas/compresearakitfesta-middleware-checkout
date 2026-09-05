import { env } from './env.js';

/**
 * Identificacao do processo em execucao.
 *
 * `startedAt` e capturado quando este modulo carrega, ou seja, no boot. No
 * Render isso equivale a data do deploy: cada deploy sobe um processo novo.
 * Nao existe variavel de "data do deploy" na plataforma — o boot e o dado
 * mais proximo e nao depende de nada externo.
 *
 * As `RENDER_*` sao injetadas pela plataforma. Em desenvolvimento nao existem,
 * e os campos correspondentes ficam `null`.
 */
export const DEPLOY_INFO = {
  startedAt: new Date().toISOString(),
  environment: env.NODE_ENV,
  service: env.RENDER_SERVICE_NAME ?? null,
  commit: env.RENDER_GIT_COMMIT ?? null,
  /** Primeiros 7 caracteres do commit, como o git mostra. */
  commitShort: env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
  branch: env.RENDER_GIT_BRANCH ?? null,
  nodeVersion: process.version,
} as const;
