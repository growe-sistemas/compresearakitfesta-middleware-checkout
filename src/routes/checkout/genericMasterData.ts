import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { logger } from '../../config/logger.js';
import { MASTERDATA_ACCEPT, vtexRequest } from '../../services/vtex/client.js';
import { UpstreamError } from '../../services/vtex/errors.js';

const documentListSchema = z.array(z.record(z.unknown()));

/**
 * Estas duas rotas recebem entidade, condicao e campos direto do corpo da
 * requisicao e repassam para o Master Data. E um proxy generico: quem chama
 * escolhe o que ler e escrever.
 *
 * ATENCAO: no VTEX IO isso ficava atras da policy do proprio VTEX IO. Aqui a
 * unica barreira e o `x-api-key`. Quem tem a chave le e escreve QUALQUER
 * entidade do Master Data da conta. Vale restringir a uma allowlist de
 * entidades quando formos melhorar.
 */

const getDataBody = z.object({
  entity: z.string().min(1),
  condition: z.string().min(1),
  fieldsToReturn: z.string().min(1),
});

/**
 * getDataInMasterData — porte de `middlewares/getDataInMasterData.ts`.
 * Devolve o PRIMEIRO documento encontrado, ou `success: false`.
 * O original engolia qualquer erro e devolvia `null`; aqui erro de rede ou
 * credencial sobe, mas "nao encontrou" continua sendo 200 com success falso.
 */
export const getDataInMasterData = asyncHandler(async (req, res) => {
  const { entity, condition, fieldsToReturn } = getDataBody.parse(req.body);

  const documents = await vtexRequest({
    path: `/api/dataentities/${entity}/search?${condition}&_fields=${fieldsToReturn}`,
    schema: documentListSchema,
    headers: { Accept: MASTERDATA_ACCEPT },
  });

  const first = documents[0] ?? null;

  if (first === null) {
    res.status(200).json({
      success: false,
      message: 'Nenhum dado localizado no masterdata.',
      data: null,
    });
    return;
  }

  res.status(200).json({
    success: true,
    message: 'Dados retornados com sucesso.',
    data: first,
  });
});

const updateBody = z.object({
  acronym: z.string().min(1),
  getCondition: z.string().min(1),
  payload: z.record(z.unknown()),
});

/**
 * updateDataMD — porte de `middlewares/updateDataMD.ts`.
 *
 * Busca o documento pela condicao, aplica PATCH e relê para devolver o estado
 * final (sem o `id`, como no original).
 */
export const updateDataMD = asyncHandler(async (req, res) => {
  const { acronym, getCondition, payload } = updateBody.parse(req.body);

  const find = async (): Promise<Record<string, unknown> | null> => {
    const documents = await vtexRequest({
      path: `/api/dataentities/${acronym}/search?${getCondition}`,
      schema: documentListSchema,
      headers: { Accept: MASTERDATA_ACCEPT },
    });
    return documents[0] ?? null;
  };

  const current = await find();

  if (current === null) {
    // Mensagem preservada do original (o front faz match nela).
    res.status(200).json('ID não encontrado no MD');
    return;
  }

  const id = current['id'];
  if (typeof id !== 'string' || id === '') {
    throw new UpstreamError(
      'VTEX',
      502,
      'MASTERDATA_DOCUMENT_WITHOUT_ID',
      `Documento de ${acronym} veio sem id`,
    );
  }

  await vtexRequest({
    path: `/api/dataentities/${acronym}/documents/${id}`,
    method: 'PATCH',
    body: payload,
    schema: z.null(),
    headers: { Accept: MASTERDATA_ACCEPT },
  });

  const updated = await find();
  if (updated === null) {
    logger.warn({ acronym, id }, 'Documento sumiu logo apos o PATCH');
    res.status(200).json({});
    return;
  }

  const { id: _id, ...withoutId } = updated;

  res.set('Cache-Control', 'public, max-age=120'); // 2 minutos, como no original
  res.status(200).json(withoutId);
});
