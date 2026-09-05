import { z } from 'zod';
import { env } from '../../config/env.js';
import { upstreamRequest } from '../http/request.js';
import { notConfigured } from '../vtex/errors.js';

/**
 * SintegraWS — porte de `clients/sintegra.ts`.
 *
 * No app VTEX IO o token estava HARDCODED na URL do fonte. Aqui vem de
 * `SINTEGRA_TOKEN`; sem ele a rota responde 503 em vez de vazar um 401 do
 * provedor. A URL nunca vai para o log (o token esta na query string) —
 * por isso o `logLabel` e so o nome do plugin.
 */
const sintegraResponseSchema = z
  .object({
    /** `'0'` = sucesso. Qualquer outro valor e erro de negocio do provedor. */
    code: z.string().optional(),
    status: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export type SintegraResponse = z.infer<typeof sintegraResponseSchema>;

export type SintegraPlugin = 'RF' | 'SN' | 'ST' | 'CPF';

function requireToken(): string {
  if (env.SINTEGRA_TOKEN === undefined) {
    throw notConfigured('Sintegra', ['SINTEGRA_TOKEN']);
  }
  return env.SINTEGRA_TOKEN;
}

async function query(
  plugin: SintegraPlugin,
  params: Record<string, string>,
): Promise<SintegraResponse> {
  const url = new URL(env.SINTEGRA_BASE_URL);
  url.searchParams.set('token', requireToken());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set('plugin', plugin);

  return upstreamRequest({
    upstream: 'SINTEGRA',
    url: url.toString(),
    schema: sintegraResponseSchema,
    logLabel: `plugin=${plugin}`,
    // O plugin SN ja foi medido em 21s: o timeout padrao da VTEX (10s) cortaria
    // a consulta antes de ela responder.
    timeoutMs: env.SINTEGRA_TIMEOUT_MS,
  });
}

/** Consulta CNPJ na Receita Federal. */
export async function getCnpjFromRF(cnpj: string): Promise<SintegraResponse> {
  return query('RF', { cnpj });
}

/** Consulta CNPJ no Simples Nacional. */
export async function getCnpjFromSN(cnpj: string): Promise<SintegraResponse> {
  return query('SN', { cnpj });
}

/** Consulta CNPJ na Substituicao Tributaria. */
export async function getCnpjFromST(cnpj: string): Promise<SintegraResponse> {
  return query('ST', { cnpj });
}

/** Consulta CPF. `birthDate` so com digitos. */
export async function getCpf(cpf: string, birthDate: string): Promise<SintegraResponse> {
  return query('CPF', { cpf, 'data-nascimento': birthDate });
}
