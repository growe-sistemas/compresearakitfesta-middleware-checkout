import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import {
  createDocument,
  searchDocuments,
  updateDocument,
} from '../vtex/masterdata.js';
import type { CnpjSources } from '../../mappers/cnpj.js';

/**
 * Cache durável de CNPJ na entidade `CB` do Master Data.
 *
 * Consultar a SintegraWS custa cota e ate 21s (o plugin SN). O `checkout-ui`
 * ja resolvia isso guardando a resposta no CB e lendo de la nas proximas
 * compras — so que a partir do navegador. Aqui a mesma camada roda no
 * servidor.
 *
 * ---------------------------------------------------------------------------
 * INTEROPERABILIDADE COM O FRONT
 * ---------------------------------------------------------------------------
 * O formato gravado e **exatamente** o que o `checkout-ui` grava e le
 * (`controller.js:1545` e `:1618`):
 *
 * ```json
 * { "cnpj": "50972373000100", "cnpjInfo": { "RF": {}, "SN": {}, "IE": {}, "PUBLICA": {} } }
 * ```
 *
 * Isso e deliberado, e vale nos dois sentidos: o middleware aproveita os anos
 * de CNPJ que o front ja acumulou, e o front continua lendo o que o middleware
 * escrever. Mudar o formato quebraria os dois lados.
 *
 * Detalhe de schema: `cnpjInfo` e declarado `type: string` no CB, mas a VTEX
 * devolve o valor **ja parseado como objeto**. Por isso o `JSON.parse` esta
 * comentado no front. A leitura aqui aceita os dois casos.
 *
 * Mapeamento de chaves: a chave `IE` do front corresponde ao plugin **ST**
 * (inscricao estadual). O nome ficou assim porque a rota antiga que a
 * alimentava chamava o plugin errado — ver `docs/06`.
 */

/** Nome da entidade e dos campos, em um lugar so. */
const ENTITY = 'CB';
const FIELDS = ['id', 'cnpjInfo', 'updatedIn', 'createdIn'] as const;

export interface CachedCnpjDocument {
  documentId: string;
  sources: CnpjSources;
  /** Idade do documento em dias, de `updatedIn` ou, faltando, `createdIn`. */
  ageDays: number;
  ageSeconds: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * `cnpjInfo` -> as quatro fontes.
 *
 * Aceita objeto (o que a VTEX devolve) e string JSON (caso o schema mude ou
 * algum documento antigo tenha sido gravado serializado).
 */
function parseCnpjInfo(value: unknown): CnpjSources | null {
  let payload: unknown = value;

  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    try {
      payload = JSON.parse(value);
    } catch {
      return null;
    }
  }

  const info = asRecord(payload);
  if (info === null) return null;

  const sources: CnpjSources = {
    rf: asRecord(info['RF']),
    sn: asRecord(info['SN']),
    // `IE` no front = plugin ST aqui. Ver o cabecalho deste arquivo.
    st: asRecord(info['IE']),
    publica: asRecord(info['PUBLICA']) as CnpjSources['publica'],
  };

  // Documento sem nenhuma fonte util nao serve de cache.
  const hasAnyValue = Object.values(sources).some((source) => source !== null);
  return hasAnyValue ? sources : null;
}

/** As quatro fontes -> `cnpjInfo`, no formato que o front espera ler. */
function buildCnpjInfo(sources: CnpjSources): Record<string, unknown> {
  return {
    RF: sources.rf,
    SN: sources.sn,
    IE: sources.st,
    PUBLICA: sources.publica,
  };
}

function ageInDays(document: Record<string, unknown>): number | null {
  // `updatedIn` so existe depois de um PATCH: documento criado e nunca
  // atualizado tem o campo nulo, e ai vale a data de criacao.
  const raw = document['updatedIn'] ?? document['createdIn'];
  if (typeof raw !== 'string' || raw === '') return null;

  const timestamp = new Date(raw).getTime();
  if (Number.isNaN(timestamp)) return null;

  return (Date.now() - timestamp) / (24 * 60 * 60 * 1000);
}

/** Documento mais recente do CNPJ. Duplicados existem — vale o ultimo. */
async function findDocument(cnpj: string): Promise<Record<string, unknown> | null> {
  const documents = await searchDocuments(ENTITY, FIELDS, `cnpj=${cnpj}`, {
    page: 1,
    pageSize: 1,
  }, { sort: 'createdIn DESC' });

  return documents[0] ?? null;
}

/**
 * Le o CNPJ do CB, se existir e estiver dentro da validade.
 *
 * Documento mais velho que `CNPJ_MASTERDATA_TTL_DAYS` e ignorado de proposito:
 * situacao cadastral muda, e e ela que decide se a venda passa. O documento
 * nao e apagado — a proxima consulta bem-sucedida o atualiza.
 *
 * Falha de leitura NAO propaga: cache indisponivel vira consulta normal, nunca
 * erro para quem esta comprando.
 */
export async function readCnpjFromMasterData(cnpj: string): Promise<CachedCnpjDocument | null> {
  try {
    const document = await findDocument(cnpj);
    if (document === null) return null;

    const documentId = document['id'];
    if (typeof documentId !== 'string' || documentId === '') return null;

    const sources = parseCnpjInfo(document['cnpjInfo']);
    if (sources === null) {
      logger.warn({ cnpj, documentId }, 'Documento CB sem cnpjInfo utilizavel; ignorando o cache');
      return null;
    }

    const ageDays = ageInDays(document);
    if (ageDays === null) {
      logger.warn({ cnpj, documentId }, 'Documento CB sem data; tratando como vencido');
      return null;
    }

    if (ageDays > env.CNPJ_MASTERDATA_TTL_DAYS) {
      logger.info(
        { cnpj, documentId, ageDays: Math.round(ageDays), ttlDays: env.CNPJ_MASTERDATA_TTL_DAYS },
        'CNPJ no CB esta vencido; consultando as fontes de novo',
      );
      return null;
    }

    return {
      documentId,
      sources,
      ageDays,
      ageSeconds: Math.round(ageDays * 24 * 60 * 60),
    };
  } catch (error) {
    logger.warn({ err: error, cnpj }, 'Falha ao ler o CNPJ no CB; seguindo para as fontes');
    return null;
  }
}

/**
 * Grava (ou atualiza) o CNPJ no CB.
 *
 * `PATCH` quando o documento ja existe, `POST` quando nao. O front sempre cria
 * — por isso ha CNPJ com dois documentos na base, criados com um minuto de
 * diferenca pelo mesmo cliente clicando "Buscar" duas vezes. Atualizar tambem
 * e o que faz o `updatedIn` existir, e e dele que a regra de validade depende.
 *
 * Falha de escrita NAO propaga: perder o cache e aceitavel, derrubar a compra
 * do cliente por causa disso nao.
 */
export async function saveCnpjToMasterData(cnpj: string, sources: CnpjSources): Promise<void> {
  try {
    const existing = await findDocument(cnpj);
    const documentId = existing?.['id'];
    const cnpjInfo = buildCnpjInfo(sources);

    if (typeof documentId === 'string' && documentId !== '') {
      await updateDocument(ENTITY, documentId, { cnpj, cnpjInfo });
      logger.info({ cnpj, documentId }, 'CNPJ atualizado no CB');
      return;
    }

    const created = await createDocument(ENTITY, { cnpj, cnpjInfo });
    logger.info({ cnpj, documentId: created.Id ?? created.DocumentId }, 'CNPJ gravado no CB');
  } catch (error) {
    logger.warn({ err: error, cnpj }, 'Falha ao gravar o CNPJ no CB; a consulta seguiu normal');
  }
}
