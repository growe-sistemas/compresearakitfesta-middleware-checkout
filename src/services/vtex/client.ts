import type { z } from 'zod';
import { env } from '../../config/env.js';
import {
  upstreamRequest,
  type HttpMethod,
  type UpstreamRequestOptions,
} from '../http/request.js';

export type { HttpMethod };

export interface VtexRequestOptions<TSchema extends z.ZodTypeAny> {
  /** Path relativo a VTEX_BASE_URL, ex.: `/api/dataentities/CL/search`. */
  path: string;
  method?: HttpMethod;
  /** Query string. Valores `undefined` sao omitidos. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Corpo JSON (serializado automaticamente). */
  body?: unknown;
  /** Schema zod que valida a resposta da VTEX. */
  schema: TSchema;
  /** Headers extras (nao sobrescrevem os de autenticacao). */
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
}

/** Header aceito pelo Master Data (versao v10 da API de dataentities). */
export const MASTERDATA_ACCEPT = 'application/vnd.vtex.ds.v10+json';

function buildUrl(
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${env.VTEX_BASE_URL}${normalizedPath}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  return url.toString();
}

/**
 * Ponto unico de acesso a VTEX.
 *
 * Injeta X-VTEX-API-AppKey / X-VTEX-API-AppToken sobre o nucleo compartilhado
 * (timeout, retry com backoff, erro mapeado). No app VTEX IO essa autenticacao
 * vinha de `ctx.vtex.authToken` + das settings do `store-theme`; fora do VTEX
 * IO ela vem das credenciais de aplicacao em env.
 */
export async function vtexRequest<TSchema extends z.ZodTypeAny>(
  options: VtexRequestOptions<TSchema>,
): Promise<z.infer<TSchema>> {
  const { path, method = 'GET', query, body, schema, headers: extraHeaders } = options;

  const headers: Record<string, string> = {
    ...extraHeaders,
    // depois do spread: credenciais nunca podem ser sobrescritas por fora
    'X-VTEX-API-AppKey': env.VTEX_APPKEY,
    'X-VTEX-API-AppToken': env.VTEX_APPTOKEN,
    Accept: extraHeaders?.['Accept'] ?? 'application/json',
  };

  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const request: UpstreamRequestOptions<TSchema> = {
    upstream: 'VTEX',
    url: buildUrl(path, query),
    method,
    headers,
    schema,
    logLabel: path,
    ...(body !== undefined ? { body } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  };

  return upstreamRequest(request);
}
