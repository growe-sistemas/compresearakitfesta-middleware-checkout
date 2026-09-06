import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { TtlCache } from '../cache/ttlCache.js';
import { readCnpjFromMasterData, saveCnpjToMasterData } from './cnpjCache.js';
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
 * O disparo ganha camadas na frente, da mais barata para a mais cara:
 *
 * | | Camada | Alcance | Custo |
 * | --- | --- | --- | --- |
 * | L1 | memoria (`CNPJ_CACHE_TTL_MS`) | por instancia | ~0ms |
 * | L2 | Master Data `CB` (`CNPJ_MASTERDATA_TTL_DAYS`) | compartilhado e duravel | ~200ms |
 * | L3 | SintegraWS + publica.cnpj.ws | externo | 1 a 21s, cota paga |
 *
 * O L2 e a mesma entidade que o `checkout-ui` ja usa, no mesmo formato: o
 * middleware aproveita os CNPJ que o front acumulou, e o front continua lendo
 * o que o middleware grava. Ver `cnpjCache.ts`.
 *
 * Alem das camadas:
 *
 * - **dedupe de requisicao em voo** — cliques repetidos no botao "Buscar", ou
 *   dois clientes com o mesmo CNPJ ao mesmo tempo, compartilham a MESMA coleta
 *   em vez de multiplicar consultas pagas;
 * - **isolamento de falha** — uma fonte que cai vira status em `sources`, nao
 *   exception. O antigo usava `allSettled` mas jogava o objeto de erro dentro
 *   do payload como se fosse dado.
 *
 * O cache guarda as **respostas cruas**, nunca a consolidacao. A consolidacao
 * depende do `fallbackEmail` de quem pediu (vai para `DS_EMAIL_NFD` quando a
 * empresa nao tem e-mail proprio) — cachear o resultado final entregaria o
 * e-mail de um cliente para outro.
 */
/** De onde a resposta veio. `null` quando as fontes foram consultadas. */
export type CacheSource = 'memory' | 'masterdata' | null;

export interface CnpjSourcesResult {
  sources: CnpjSources;
  statuses: Record<'RF' | 'SN' | 'ST' | 'PUBLICA', SourceStatus>;
  cache: { hit: boolean; source: CacheSource; ageSeconds?: number };
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

/**
 * Status derivados de um payload que veio do CB.
 *
 * O documento guarda as respostas, nao como cada fonte se saiu. Presenca vira
 * `ok`, ausencia vira `not_found`. Nao da para distinguir `timeout` de `error`
 * ali — mas se a resposta foi boa o bastante para ser cacheada, a distincao
 * nao muda nada para quem consome.
 */
function statusesFromCache(sources: CnpjSources): CnpjSourcesResult['statuses'] {
  const status = (value: unknown): SourceStatus => (value === null ? 'not_found' : 'ok');

  return {
    RF: status(sources.rf),
    SN: status(sources.sn),
    ST: status(sources.st),
    PUBLICA: status(sources.publica),
  };
}

/** Coleta com cache (memoria + Master Data) e dedupe. `cnpj` so com digitos. */
export async function fetchCnpjSources(cnpj: string): Promise<CnpjSourcesResult> {
  // L1 — memoria. Inclui o cache negativo (CNPJ que nenhuma fonte conhece).
  const inMemory = cache.get(cnpj) ?? negativeCache.get(cnpj);
  if (inMemory !== null) {
    return {
      ...inMemory.value,
      cache: { hit: true, source: 'memory', ageSeconds: inMemory.ageSeconds },
    };
  }

  const pending = inFlight.get(cnpj);
  if (pending !== undefined) {
    logger.debug({ cnpj }, 'Reaproveitando coleta de CNPJ em andamento');
    return { ...(await pending), cache: { hit: false, source: null } };
  }

  // L2 — Master Data. Evita ate 21s do plugin SN e uma consulta paga.
  if (env.CNPJ_MASTERDATA_TTL_DAYS > 0) {
    const stored = await readCnpjFromMasterData(cnpj);
    if (stored !== null) {
      const result: CachedSources = {
        sources: stored.sources,
        statuses: statusesFromCache(stored.sources),
      };

      // Promove para a memoria: o proximo clique nem chega ao Master Data.
      cache.set(cnpj, result);

      logger.info(
        { cnpj, ageDays: Math.round(stored.ageDays) },
        'CNPJ resolvido pelo cache do Master Data (CB)',
      );

      return { ...result, cache: { hit: true, source: 'masterdata', ageSeconds: stored.ageSeconds } };
    }
  }

  // L3 — as fontes externas.
  const promise = collect(cnpj);
  inFlight.set(cnpj, promise);

  try {
    const result = await promise;

    const hasAnyValue = Object.values(result.sources).some((value) => value !== null);

    if (hasAnyValue) {
      cache.set(cnpj, result);
      // Escrita no CB em segundo plano: quem esta comprando nao precisa
      // esperar o cache ser gravado, e falha ali nao derruba a compra.
      void saveCnpjToMasterData(cnpj, result.sources);
    } else if (Object.values(result.statuses).every((status) => status === 'not_found')) {
      // Resposta negativa DEFINITIVA: as quatro fontes responderam e nenhuma
      // conhece o CNPJ. Fica so na memoria, com TTL curto — gravar "nao
      // existe" numa base sem expiracao envenenaria empresa recem-aberta.
      negativeCache.set(cnpj, result);
    }
    // Falha de rede/timeout nao entra em cache nenhum: prender o CNPJ em erro
    // pelo TTL inteiro seria pior que consultar de novo.

    return { ...result, cache: { hit: false, source: null } };
  } finally {
    inFlight.delete(cnpj);
  }
}

/** Uso em teste/diagnostico. */
export function clearCnpjCache(): void {
  cache.clear();
  negativeCache.clear();
}
