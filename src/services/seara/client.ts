import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { upstreamRequest } from '../http/request.js';
import { notConfigured } from '../vtex/errors.js';

/**
 * Integracao "controle" da Seara (B2E) — porte de `middlewares/getEmployee.ts`.
 *
 * Protocolo: POST de XML `<ROWSET><ROW>...</ROW></ROWSET>`, resposta tambem
 * em XML. Duas chamadas: autentica (devolve TOKEN) e consulta o CPF.
 *
 * No app VTEX IO o endpoint, o usuario, a chave e o cookie estavam HARDCODED
 * no fonte. Aqui vem de env; sem eles a rota responde 503.
 */
const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });

/** Escapa o valor antes de interpolar no XML — o original concatenava cru. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** O parser devolve escalar ou array conforme o XML; normaliza para o 1o item. */
function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

interface SearaConfig {
  endpoint: string;
  user: string;
  key: string;
  cookie: string | undefined;
}

function requireConfig(): SearaConfig {
  const { SEARA_ENDPOINT, SEARA_USER, SEARA_KEY, SEARA_COOKIE } = env;

  if (SEARA_ENDPOINT === undefined || SEARA_USER === undefined || SEARA_KEY === undefined) {
    throw notConfigured('Seara', ['SEARA_ENDPOINT', 'SEARA_USER', 'SEARA_KEY']);
  }

  return { endpoint: SEARA_ENDPOINT, user: SEARA_USER, key: SEARA_KEY, cookie: SEARA_COOKIE };
}

async function postXml(config: SearaConfig, xml: string, logLabel: string): Promise<unknown> {
  const raw = await upstreamRequest({
    upstream: 'SEARA',
    url: config.endpoint,
    method: 'POST',
    headers: {
      'Content-Type': 'application/xml',
      ...(config.cookie !== undefined ? { Cookie: config.cookie } : {}),
    },
    body: xml,
    schema: z.string(),
    parse: 'text',
    logLabel,
  });

  return parser.parse(raw);
}

/** Passo 1: autentica e devolve o TOKEN, ou `null` se a resposta nao trouxer um. */
export async function getToken(): Promise<string | null> {
  const config = requireConfig();

  const xml = `<?xml version="1.0"?>
<ROWSET>
<ROW>
    <CD_TIPO_INTEGRACAO>AUTENTICACAO_USUARIO</CD_TIPO_INTEGRACAO>
    <USER>${escapeXml(config.user)}</USER>
    <KEY>${escapeXml(config.key)}</KEY>
</ROW>
</ROWSET>`;

  const parsed = await postXml(config, xml, 'AUTENTICACAO_USUARIO');
  const rowset = (parsed as { ROWSET?: { ROW?: unknown } }).ROWSET;
  const row = first(rowset?.ROW) as { TOKEN?: unknown } | undefined;
  const token = first(row?.TOKEN);

  if (typeof token === 'string' && token !== '') return token;
  if (typeof token === 'number') return String(token);

  logger.warn('Seara nao devolveu TOKEN na autenticacao');
  return null;
}

export interface SearaEmployeeRow {
  NOME?: unknown;
  EMAIL?: unknown;
  CODIGO_INFLUENCIADOR?: unknown;
  TRANSACTION_ERROR?: unknown;
}

/** Passo 2: consulta o colaborador pelo CPF usando o token da autenticacao. */
export async function getEmployeeRow(token: string, cpf: string): Promise<SearaEmployeeRow> {
  const config = requireConfig();

  const xml = `<?xml version="1.0"?>
<ROWSET>
<ROW>
    <CD_TIPO_INTEGRACAO>B2E</CD_TIPO_INTEGRACAO>
    <TOKEN>${escapeXml(token)}</TOKEN>
    <NR_CPF>${escapeXml(cpf)}</NR_CPF>
</ROW>
</ROWSET>`;

  const parsed = await postXml(config, xml, 'B2E');
  const rowset = (parsed as { ROWSET?: { ROW?: unknown } }).ROWSET;

  return (first(rowset?.ROW) ?? {}) as SearaEmployeeRow;
}
