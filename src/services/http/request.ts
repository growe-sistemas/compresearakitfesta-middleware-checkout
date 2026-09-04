import { setTimeout as sleep } from 'node:timers/promises';
import type { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  AppError,
  UpstreamError,
  mapUpstreamStatus,
  upstreamErrorCode,
  type Upstream,
} from '../vtex/errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface UpstreamRequestOptions<TSchema extends z.ZodTypeAny> {
  /** Qual servico externo — define o prefixo do codigo de erro. */
  upstream: Upstream;
  /** URL absoluta ja montada. */
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  /** Objeto (serializado como JSON) ou string crua (ex.: XML). */
  body?: unknown;
  /** Schema zod que valida a resposta. Obrigatorio: nada de `any`. */
  schema: TSchema;
  /** `json` faz JSON.parse; `text` entrega a string crua ao schema. */
  parse?: 'json' | 'text';
  timeoutMs?: number;
  maxRetries?: number;
  /** Rotulo curto usado no log, sem query string (que pode ter segredo). */
  logLabel: string;
}

/** Status em que vale a pena tentar de novo. */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

const BASE_BACKOFF_MS = 300;
const MAX_BACKOFF_MS = 5_000;
/** Corpo de erro guardado para diagnostico, truncado para nao poluir o log. */
const MAX_ERROR_BODY_CHARS = 500;

/**
 * Backoff exponencial com jitter. Respeita `Retry-After` quando o upstream
 * manda (em segundos, formato usado em 429).
 */
function backoffDelayMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader !== null) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    }
  }

  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  const jitter = Math.random() * exponential * 0.3;
  return Math.round(exponential + jitter);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/**
 * Nucleo HTTP compartilhado: timeout por tentativa, retry com backoff em
 * 5xx/429/rede, e traducao de qualquer falha em `UpstreamError` com o status
 * ja mapeado para o contrato do middleware. A resposta so volta depois de
 * passar pelo schema zod.
 */
export async function upstreamRequest<TSchema extends z.ZodTypeAny>(
  options: UpstreamRequestOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  const {
    upstream,
    url,
    method = 'GET',
    headers = {},
    body,
    schema,
    parse = 'json',
    timeoutMs = env.VTEX_TIMEOUT_MS,
    maxRetries = env.VTEX_MAX_RETRIES,
    logLabel,
  } = options;

  const serializedBody =
    body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);

  let lastError: UpstreamError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const startedAt = Date.now();
    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        ...(serializedBody !== undefined ? { body: serializedBody } : {}),
      });
    } catch (error) {
      const timedOut = isAbortError(error);
      lastError = new UpstreamError(
        upstream,
        timedOut ? 504 : 502,
        timedOut ? `${upstream}_TIMEOUT` : `${upstream}_NETWORK_ERROR`,
        timedOut
          ? `Timeout de ${timeoutMs}ms ao chamar ${upstream} (${logLabel})`
          : `Falha de rede ao chamar ${upstream} (${logLabel})`,
        { cause: error },
      );

      // Rede e timeout sempre valem retentativa (dentro do limite).
      if (attempt < maxRetries) {
        const delay = backoffDelayMs(attempt, null);
        logger.warn(
          { upstream, logLabel, method, attempt: attempt + 1, maxRetries, delay },
          'Retentando chamada ao upstream',
        );
        await sleep(delay);
        continue;
      }
      throw lastError;
    }

    const durationMs = Date.now() - startedAt;

    if (response.ok) {
      logger.debug(
        { upstream, logLabel, method, status: response.status, durationMs, attempt: attempt + 1 },
        'Chamada ao upstream concluida',
      );
      return parseBody(schema, response, upstream, logLabel, parse);
    }

    const rawBody = await response.text().catch(() => '');
    lastError = new UpstreamError(
      upstream,
      mapUpstreamStatus(response.status),
      upstreamErrorCode(upstream, response.status),
      `${upstream} respondeu ${response.status} em ${method} ${logLabel}`,
      { upstreamStatus: response.status, upstreamBody: rawBody.slice(0, MAX_ERROR_BODY_CHARS) },
    );

    if (RETRYABLE_STATUSES.has(response.status) && attempt < maxRetries) {
      const delay = backoffDelayMs(attempt, response.headers.get('retry-after'));
      logger.warn(
        {
          upstream,
          logLabel,
          method,
          upstreamStatus: response.status,
          attempt: attempt + 1,
          maxRetries,
          delay,
          durationMs,
        },
        'Retentando chamada ao upstream',
      );
      await sleep(delay);
      continue;
    }

    logger.error(
      {
        upstream,
        logLabel,
        method,
        upstreamStatus: response.status,
        durationMs,
        body: lastError.upstreamBody,
      },
      'Chamada ao upstream falhou',
    );
    throw lastError;
  }

  // Inalcancavel: o loop sempre retorna ou lanca. Guarda para o compilador.
  throw (
    lastError ?? new UpstreamError(upstream, 502, `${upstream}_ERROR`, 'Falha desconhecida')
  );
}

async function parseBody<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  response: Response,
  upstream: Upstream,
  logLabel: string,
  parse: 'json' | 'text',
): Promise<z.infer<TSchema>> {
  const text = response.status === 204 ? '' : await response.text();
  let payload: unknown;

  if (parse === 'text') {
    payload = text;
  } else if (text.trim() === '') {
    payload = null;
  } else {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new UpstreamError(
        upstream,
        502,
        `${upstream}_INVALID_JSON`,
        `${upstream} devolveu JSON invalido em ${logLabel}`,
        { cause: error, upstreamBody: text.slice(0, MAX_ERROR_BODY_CHARS) },
      );
    }
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    logger.error(
      { upstream, logLabel, issues: parsed.error.issues },
      'Resposta do upstream nao bate com o schema esperado',
    );
    throw new AppError(
      502,
      `${upstream}_CONTRACT_MISMATCH`,
      `Resposta de ${upstream} em ${logLabel} nao bate com o contrato esperado`,
      { details: parsed.error.issues },
    );
  }

  return parsed.data;
}
