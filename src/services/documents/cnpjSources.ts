import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { TtlCache } from '../cache/ttlCache.js';
import { getCnpjFromRF, getCnpjFromSN, getCnpjFromST } from '../sintegra/client.js';
import { getPublicaCnpj } from '../publicacnpj/client.js';
import { AppError, UpstreamError } from '../vtex/errors.js';
import type { CnpjSources, SourceStatus } from '../../mappers/cnpj.js';

/**
 * Coleta das fontes de CNPJ.
 *
 * Substitui o disparo que hoje sai do navegador
 * (`checkout-ui/.../sintegra.js:104`): quatro `fetch` em paralelo, sem cache,
 * sem dedupe, sem diagnostico de qual fonte falhou — e com a `publica.cnpj.ws`
 * chamada direto do cliente.
 *
 * Aqui o disparo ganha tres camadas na frente:
 *
 * 1. **cache** por CNPJ (o SN sozinho leva ~21s; nao faz sentido repetir);
 * 2. **dedupe de requisicao em voo** — cliques repetidos no botao "Buscar", ou
 *    dois clientes com o mesmo CNPJ ao mesmo tempo, compartilham a MESMA
 *    coleta em vez de multiplicar consultas pagas;
 * 3. **isolamento de falha** — uma fonte que cai vira status em `sources`,
 *    nao exception. O antigo usava `allSettled` mas jogava o objeto de erro
 *    dentro do payload como se fosse dado.
 *
 * O cache guarda as **respostas cruas**, nunca a consolidacao. A consolidacao
 * depende do `fallbackEmail` de quem pediu (vai para `DS_EMAIL_NFD` quando a
 * empresa nao tem e-mail proprio) — cachear o resultado final entregaria o
 * e-mail de um cliente para outro.
 */
export interface CnpjSourcesResult {
  sources: CnpjSources;
  statuses: Record<'RF' | 'SN' | 'ST' | 'PUBLICA', SourceStatus>;
  cache: { hit: boolean; ageSeconds?: number };
}

type CachedSources = Omit<CnpjSourcesResult, 'cache'>;

const cache = new TtlCache<CachedSources>({
  ttlMs: env.CNPJ_CACHE_TTL_MS,
  maxEntries: env.CNPJ_CACHE_MAX_ENTRIES,
});

/**
 * Cache separado para CNPJ que nenhuma fonte conhece.
 *
 * Sem ele, erro de digitacao repetido queima tres consultas pagas por
 * tentativa. Com TTL proprio, menor: uma resposta negativa nao pode ficar
 * presa por 24h se a empresa acabou de ser aberta.
 */
const negativeCache = new TtlCache<CachedSources>({
  ttlMs: env.CNPJ_NEGATIVE_CACHE_TTL_MS,
  maxEntries: env.CNPJ_CACHE_MAX_ENTRIES,
});

/** Coletas em andamento, para nao disparar a mesma duas vezes. */
const inFlight = new Map<string, Promise<CachedSources>>();

interface SourceOutcome<T> {
  value: T | null;
  status: SourceStatus;
}

/**
 * Executa uma fonte e traduz o resultado em `{ value, status }`.
 *
 * Erro de configuracao (credencial ausente) **sobe**: servidor mal configurado
 * tem de falhar alto, nao degradar em silencio.
 */
async function runSource<T>(
  label: string,
  cnpj: string,
  run: () => Promise<T>,
): Promise<SourceOutcome<T>> {
  try {
    return { value: await run(), status: 'ok' };
  } catch (error) {
    if (error instanceof AppError && !(error instanceof UpstreamError)) throw error;

    const timedOut = error instanceof UpstreamError && error.code.endsWith('_TIMEOUT');
    const notFound = error instanceof UpstreamError && error.upstreamStatus === 404;

    logger.warn(
      {
        source: label,
        cnpj,
        code: error instanceof AppError ? error.code : undefined,
        upstreamStatus: error instanceof UpstreamError ? error.upstreamStatus : undefined,
      },
      'Fonte de CNPJ indisponivel; seguindo com as demais',
    );

    return { value: null, status: notFound ? 'not_found' : timedOut ? 'timeout' : 'error' };
  }
}

/**
 * A SintegraWS responde HTTP 200 mesmo sem achar o registro, sinalizando pelo
 * campo `code` (`"0"` = sucesso).
 *
 * Isso e especialmente importante no plugin ST: empresa **sem** inscricao
 * estadual volta como `code: "1"`, "Nenhum estabelecimento encontrado no
 * SINTEGRA". Nao e falha — e a resposta correta para quem nao e contribuinte
 * de ICMS. Por isso vira `not_found` com valor nulo, e o consolidador trata
 * como "Isento".
 */
function unwrapSintegra(
  outcome: SourceOutcome<Record<string, unknown>>,
): SourceOutcome<Record<string, unknown>> {
  if (outcome.status !== 'ok' || outcome.value === null) return outcome;

  const code = outcome.value['code'];
  if (code === '0') return outcome;

  return { value: null, status: 'not_found' };
}

async function collect(cnpj: string): Promise<CachedSources> {
  // As quatro em paralelo: o tempo total e o da fonte mais lenta (o SN),
  // nao a soma. Nenhuma delas derruba as outras.
  const [rf, sn, st, publica] = await Promise.all([
    runSource('RF', cnpj, () => getCnpjFromRF(cnpj)).then(unwrapSintegra),
    runSource('SN', cnpj, () => getCnpjFromSN(cnpj)).then(unwrapSintegra),
    // Plugin ST DE VERDADE. A rota legada `getDataSintegraST` chama o plugin RF
    // por engano, e e dai que o front tentava tirar a inscricao estadual —
    // por isso ela caia sempre em "Isento". Ver docs/06.
    runSource('ST', cnpj, () => getCnpjFromST(cnpj)).then(unwrapSintegra),
    runSource('PUBLICA', cnpj, () => getPublicaCnpj(cnpj)),
  ]);

  return {
    sources: {
      rf: rf.value,
      sn: sn.value,
      st: st.value,
      publica: publica.value,
    },
    statuses: {
      RF: rf.status,
      SN: sn.status,
      ST: st.status,
      PUBLICA: publica.status,
    },
  };
}

/** Coleta com cache e dedupe. `cnpj` ja deve vir so com digitos. */
export async function fetchCnpjSources(cnpj: string): Promise<CnpjSourcesResult> {
  const cached = cache.get(cnpj) ?? negativeCache.get(cnpj);
  if (cached !== null) {
    return { ...cached.value, cache: { hit: true, ageSeconds: cached.ageSeconds } };
  }

  const pending = inFlight.get(cnpj);
  if (pending !== undefined) {
    logger.debug({ cnpj }, 'Reaproveitando coleta de CNPJ em andamento');
    return { ...(await pending), cache: { hit: false } };
  }

  const promise = collect(cnpj);
  inFlight.set(cnpj, promise);

  try {
    const result = await promise;

    const hasAnyValue = Object.values(result.sources).some((value) => value !== null);

    if (hasAnyValue) {
      cache.set(cnpj, result);
    } else if (Object.values(result.statuses).every((status) => status === 'not_found')) {
      // Resposta negativa DEFINITIVA: as quatro fontes responderam e nenhuma
      // conhece o CNPJ. Vale cachear (curto) para nao repetir consulta paga.
      negativeCache.set(cnpj, result);
    }
    // Falha de rede/timeout nao entra em cache nenhum: prender o CNPJ em erro
    // pelo TTL inteiro seria pior que consultar de novo.

    return { ...result, cache: { hit: false } };
  } finally {
    inFlight.delete(cnpj);
  }
}

/** Uso em teste/diagnostico. */
export function clearCnpjCache(): void {
  cache.clear();
  negativeCache.clear();
}
