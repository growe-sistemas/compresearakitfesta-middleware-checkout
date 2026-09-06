import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { logger } from '../../config/logger.js';
import { isValidCnpj, verifyCnpj } from '../../mappers/cnpj.js';
import {
  buildCorporateAddress,
  buildCorporateProfile,
  buildPersonalProfileReset,
  buildReceiverName,
} from '../../mappers/corporateProfile.js';
import { fetchCnpjSources } from '../../services/documents/cnpjSources.js';
import {
  CUSTOM_DATA_FIELDS,
  clearShippingData,
  deleteCustomData,
  getOrderForm,
  orderFormIdSchema,
  putCustomData,
  sendAttachment,
} from '../../services/vtex/checkout.js';
import { AppError } from '../../services/vtex/errors.js';

/**
 * POST /middleware/checkout/corporate-data
 *
 * Busca o CNPJ e **popula o orderForm** com os dados de PJ: perfil
 * corporativo, endereco da Junta Comercial e o payload fiscal do ERP.
 *
 * E o `_handleCNPJSearchBtnClickEv` (`checkout-ui/.../controller.js:1512`)
 * inteiro, do lado do servidor: hoje o front consulta o cache no Master Data,
 * dispara 4 consultas de CNPJ, consolida no navegador e depois faz 4 escritas
 * no orderForm. Aqui e UMA requisicao.
 *
 * E a unica porta de entrada para CNPJ: a antiga `/middleware/checkout/cnpj/verify`
 * fazia a mesma consulta sem gravar e foi removida por redundancia.
 *
 * Duas diferencas de comportamento que valem registro:
 *
 * 1. **As escritas sao sequenciais, e a ORDEM importa.** O front usa
 *    `Promise.all` (`controller.js:1726`), mas attachments do orderForm sao
 *    estado compartilhado. Pior: gravar `clientProfileData` com um e-mail
 *    cadastrado faz a VTEX carregar os enderecos DAQUELE cliente para dentro
 *    do `shippingData`. Por isso a sequencia e perfil -> limpar -> endereco da
 *    empresa: so assim o endereco da Junta Comercial e a ultima palavra.
 * 2. **CNPJ reprovado nao escreve nada.** O front so validava depois de ja ter
 *    limpado o `shippingData`, entao uma reprovacao no meio deixava o
 *    orderForm sem endereco.
 *
 * ---------------------------------------------------------------------------
 * DE ONDE VEM O CNPJ: TRES CAMADAS
 * ---------------------------------------------------------------------------
 * Consultar a SintegraWS custa cota e ate 21s (o plugin SN sozinho). Por isso
 * esta rota so chega nas fontes externas em ultimo caso:
 *
 * | | Camada | Alcance | Medido |
 * | --- | --- | --- | --- |
 * | L1 | memoria (`CNPJ_CACHE_TTL_MS`, 24h) | por instancia | ~0,4s |
 * | L2 | Master Data `CB` (`CNPJ_MASTERDATA_TTL_DAYS`, 90d) | compartilhado, duravel | ~1,0s |
 * | L3 | SintegraWS + publica.cnpj.ws | externo, cota paga | ate ~26s |
 *
 * O L2 e a MESMA entidade que o `checkout-ui` ja usa, no MESMO formato
 * (`{ cnpj, cnpjInfo: { RF, SN, IE, PUBLICA } }`). Vale nos dois sentidos: a
 * rota aproveita os CNPJ que o front acumulou desde sempre, e o front continua
 * lendo o que a rota grava. Detalhes em `services/documents/cnpjCache.ts`.
 *
 * `cache.source` na resposta diz de onde veio: `memory`, `masterdata` ou
 * `null` (consultou as fontes).
 *
 * Tres regras que valem a pena conhecer:
 *
 * 1. **Documento com mais de 90 dias e ignorado.** Situacao cadastral muda, e
 *    e ela que decide se a venda PJ passa — cache eterno venderia para empresa
 *    baixada. O documento nao e apagado: a consulta seguinte o ATUALIZA.
 * 2. **Atualiza em vez de duplicar.** O front faz `POST` sempre, e por isso ha
 *    CNPJ com dois documentos no CB criados com um minuto de diferenca pelo
 *    mesmo cliente. Aqui e `PATCH` quando o documento existe — o que tambem e
 *    o que faz o `updatedIn` existir, e e dele que a regra de 90 dias depende.
 * 3. **CNPJ inexistente NAO vai para o CB.** Fica so no cache negativo em
 *    memoria (10 min): gravar "nao existe" numa base sem expiracao envenenaria
 *    a consulta de uma empresa recem-aberta.
 *
 * Falha de leitura ou escrita no CB nunca derruba a requisicao — vira log e a
 * consulta segue pelas fontes.
 *
 * ---------------------------------------------------------------------------
 * REQUEST
 * ---------------------------------------------------------------------------
 * ```json
 * {
 *   "orderFormId": "cc551425e8a445878344b79b79c48f6d",
 *   "cnpj": "50.972.373/0001-00",
 *   "personal": {
 *     "email": "cliente@dominio.com",
 *     "firstName": "Gustavo",
 *     "lastName": "Borges",
 *     "document": "12345678909",
 *     "phone": "11999998888"
 *   }
 * }
 * ```
 * - `orderFormId` obrigatorio. E a credencial da operacao.
 * - `cnpj`        obrigatorio. Com ou sem mascara.
 * - `personal`    opcional, e cada campo dentro dele tambem. Sem ele valem os
 *                 dados que ja estao no `clientProfileData` do orderForm. O
 *                 e-mail precisa existir em algum dos dois lados, senao a rota
 *                 responde `400 MISSING_CLIENT_EMAIL`.
 *
 * ---------------------------------------------------------------------------
 * RESPONSE 200 — aplicado (objeto plano, sem envelope)
 * ---------------------------------------------------------------------------
 * ```json
 * {
 *   "applied": true,
 *   "orderFormId": "cc551425e8a445878344b79b79c48f6d",
 *   "verification": { "...consolidacao das quatro fontes, ver types/api.ts..." },
 *   "written": {
 *     "clientProfileData": {
 *       "email": "cliente@dominio.com",
 *       "firstName": "Gustavo",
 *       "lastName": "Borges",
 *       "document": "12345678909",
 *       "documentType": "cpf",
 *       "phone": "+5511999998888",
 *       "corporateName": "GROWE LTDA",
 *       "tradeName": "GROWE LTDA",
 *       "corporateDocument": "50972373000100",
 *       "stateInscription": "Isento",
 *       "corporatePhone": "+551199398511",
 *       "isCorporate": true,
 *       "profileCompleteOnLoading": false,
 *       "profileErrorOnLoading": false,
 *       "customerClass": null
 *     },
 *     "shippingAddress": {
 *       "addressType": "residential",
 *       "country": "BRA",
 *       "postalCode": "04563000",
 *       "city": "Sao Paulo",
 *       "complement": "APT 43",
 *       "neighborhood": "CIDADE MONCOES",
 *       "state": "SP",
 *       "street": "AV PDE ANTONIO JOSE DOS SANTOS",
 *       "number": "258",
 *       "receiverName": "Gustavo Borges"
 *     },
 *     "customData": {
 *       "field": "custom_cnpj_data",
 *       "value": "string JSON com os 11 campos fiscais",
 *       "confirmed": true
 *     }
 *   },
 *   "sources": { "RF": "ok", "SN": "ok", "ST": "not_found", "PUBLICA": "ok" },
 *   "cache": { "hit": false, "source": null },
 *   "durationMs": 3123
 * }
 * ```
 * Vindo do cache, `sources` e derivado por presenca (`ok` / `not_found`): o
 * documento guarda as respostas, nao como cada fonte se saiu na epoca.
 * `written` e exatamente o que foi gravado no orderForm — da para conferir sem
 * reler o orderForm.
 *
 * ---------------------------------------------------------------------------
 * RESPONSE 200 — CNPJ reprovado, NADA gravado
 * ---------------------------------------------------------------------------
 * ```json
 * {
 *   "applied": false,
 *   "orderFormId": "cc551425e8a445878344b79b79c48f6d",
 *   "verification": { "approved": false, "reason": "...", "message": "..." },
 *   "sources": {}, "cache": {}, "durationMs": 0
 * }
 * ```
 * Sem `written`: o orderForm nao foi tocado — nem quando o CNPJ nao existe,
 * nem quando esta baixado. Os `reason` possiveis: `DOCUMENT_NOT_FOUND`,
 * `SOURCES_UNAVAILABLE`, `REGISTRATION_INACTIVE`, `INCOMPLETE_FISCAL_DATA` e
 * `MISSING_POSTAL_CODE`.
 *
 * ---------------------------------------------------------------------------
 * ERROS
 * ---------------------------------------------------------------------------
 * - `400 VALIDATION_ERROR`          CNPJ ou `orderFormId` fora do formato
 * - `400 MISSING_CLIENT_EMAIL`      sem e-mail no orderForm nem em `personal`
 * - `502 CUSTOM_DATA_NOT_PERSISTED` a VTEX aceitou mas gravou outro valor
 */
const corporateProfileBody = z.object({
  orderFormId: orderFormIdSchema,
  cnpj: z
    .string()
    .transform((value) => value.replace(/\D/g, ''))
    .refine((value) => value.length === 14, 'CNPJ deve ter 14 digitos')
    .refine(isValidCnpj, 'CNPJ invalido'),
  /**
   * Dados de pessoa fisica da tela. Opcionais: sem eles, valem os que ja
   * estao no `clientProfileData` do orderForm. Existem porque, na hora em que
   * o cliente clica em "Buscar", o passo de perfil pode nao ter sido
   * submetido ainda — foi por isso que o front lia do DOM.
   */
  personal: z
    .object({
      email: z.string().email().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      document: z.string().optional(),
      phone: z.string().optional(),
    })
    .optional(),
});

export const setCorporateData = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const { orderFormId, cnpj, personal } = corporateProfileBody.parse(req.body);

  // 1) Consulta e consolida o CNPJ (com cache e dedupe, como na rota de verify).
  const { sources, statuses, cache } = await fetchCnpjSources(cnpj);

  // O orderForm entra como base do perfil: a compra PJ continua tendo um
  // comprador PF por tras, e esses campos nao podem ser perdidos.
  const orderForm = await getOrderForm(orderFormId);
  const currentProfile = orderForm?.clientProfileData ?? null;

  const fallbackEmail =
    personal?.email ??
    (typeof currentProfile?.['email'] === 'string' ? currentProfile['email'] : undefined);

  const verification = verifyCnpj({ cnpj, sources, statuses, fallbackEmail });

  // 2) Reprovado: devolve o motivo SEM tocar no orderForm.
  if (!verification.approved) {
    logger.info(
      { orderFormId, cnpj, reason: verification.reason, sources: statuses },
      'CNPJ reprovado; orderForm intacto',
    );

    res.status(200).json({
      applied: false,
      orderFormId,
      verification,
      sources: statuses,
      cache,
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  const profile = buildCorporateProfile({
    verification,
    currentProfile,
    personal: personal ?? {},
  });
  const address = buildCorporateAddress({
    verification,
    receiverName: buildReceiverName(profile),
  });

  // 3) Escritas, em ordem. A ORDEM IMPORTA — ver o bloco abaixo.
  //
  // O perfil vem PRIMEIRO de proposito: gravar `clientProfileData` com um
  // e-mail que tem cadastro faz a VTEX carregar sozinha os enderecos daquele
  // cliente para dentro de `selectedAddresses` e `availableAddresses`.
  // (Verificado: um POST so de clientProfileData, sem tocar em shippingData,
  // ja traz o endereco pessoal do comprador.)
  //
  // Se o endereco da empresa fosse gravado antes, esse carregamento entraria
  // DEPOIS e o pedido PJ terminaria com o endereco residencial do comprador
  // junto — as vezes ate como o escolhido.
  await sendAttachment({
    orderFormId,
    attachmentId: 'clientProfileData',
    payload: { ...profile },
  });

  // Limpa o que a VTEX acabou de carregar do perfil, e tambem o endereco
  // anterior do orderForm. Sem isto o endereco do PF sobrevive em
  // `availableAddresses` e pode voltar no calculo de frete.
  await clearShippingData(orderFormId);

  // Endereco da Junta Comercial — a ultima palavra sobre a entrega.
  await sendAttachment({
    orderFormId,
    attachmentId: 'shippingData',
    payload: {
      selectedAddresses: [address],
      // Sem isto, CEP que a VTEX nao reconhece apagaria o endereco recem-gravado.
      clearAddressIfPostalCodeNotFound: false,
    },
  });

  const { app, field } = CUSTOM_DATA_FIELDS.cnpjData;
  // `custom_cnpj_data` guarda o objeto SERIALIZADO — campo de customData e
  // texto. E o mesmo formato que o ERP ja recebe.
  const customDataValue = JSON.stringify(verification.erpCustomData);
  const customDataResult = await putCustomData({
    orderFormId,
    app,
    field,
    value: customDataValue,
  });

  if (customDataResult.storedValue !== null && !customDataResult.confirmed) {
    throw new AppError(
      502,
      'CUSTOM_DATA_NOT_PERSISTED',
      `A VTEX aceitou a gravacao de ${field} mas devolveu outro valor`,
    );
  }

  const durationMs = Date.now() - startedAt;

  logger.info(
    {
      orderFormId,
      cnpj,
      corporateName: verification.company.corporateName,
      customDataConfirmed: customDataResult.confirmed,
      sources: statuses,
      cacheHit: cache.hit,
      durationMs,
    },
    'Perfil corporativo aplicado ao orderForm',
  );

  res.status(200).json({
    applied: true,
    orderFormId,
    verification,
    /** Exatamente o que foi gravado no orderForm. */
    written: {
      clientProfileData: profile,
      shippingAddress: address,
      customData: { field, value: customDataValue, confirmed: customDataResult.confirmed },
    },
    sources: statuses,
    cache,
    durationMs,
  });
});

const discardBody = z.object({ orderFormId: orderFormIdSchema });

/**
 * DELETE /middleware/checkout/corporate-data
 *
 * O inverso da rota acima: o cliente desistiu do CNPJ e volta a comprar como
 * pessoa fisica. Desfaz as tres escritas, na ordem inversa do que o
 * `_handleDiscardCNPJ` faz no front (`checkout-ui/.../controller.js:1063`).
 *
 * Fica no mesmo path de proposito: tudo que e CNPJ entra e sai por aqui.
 *
 * ---------------------------------------------------------------------------
 * REQUEST
 * ---------------------------------------------------------------------------
 * ```json
 * { "orderFormId": "cc551425e8a445878344b79b79c48f6d" }
 * ```
 *
 * ---------------------------------------------------------------------------
 * RESPONSE 200
 * ---------------------------------------------------------------------------
 * ```json
 * {
 *   "discarded": true,
 *   "orderFormId": "cc551425e8a445878344b79b79c48f6d",
 *   "written": {
 *     "clientProfileData": {
 *       "email": "cliente@dominio.com",
 *       "firstName": "Gustavo",
 *       "lastName": "Borges",
 *       "document": "12345678909",
 *       "documentType": "cpf",
 *       "phone": "+5511999998888",
 *       "corporateName": null,
 *       "tradeName": null,
 *       "corporateDocument": null,
 *       "stateInscription": null,
 *       "corporatePhone": null,
 *       "isCorporate": false,
 *       "profileCompleteOnLoading": false,
 *       "profileErrorOnLoading": false,
 *       "customerClass": null
 *     }
 *   },
 *   "durationMs": 1383
 * }
 * ```
 *
 * ERROS
 * - `400 VALIDATION_ERROR`     `orderFormId` fora do formato
 * - `400 MISSING_CLIENT_EMAIL` orderForm sem `clientProfileData`: nao ha
 *                              perfil corporativo para desfazer
 *
 * LIMITACAO CONHECIDA: depois do DELETE, `address` fica `null` e
 * `selectedAddresses` vazio, mas o endereco da empresa **sobrevive em
 * `availableAddresses`** como disposable. Testado: a VTEX ignora
 * `availableAddresses: null` e `[]` no attachment. O front tem o mesmo residuo.
 */
export const discardCorporateData = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const { orderFormId } = discardBody.parse(req.body);

  const orderForm = await getOrderForm(orderFormId);
  const profile = buildPersonalProfileReset(orderForm?.clientProfileData);

  const { app, field } = CUSTOM_DATA_FIELDS.cnpjData;

  // 1) tira o payload fiscal
  await deleteCustomData({ orderFormId, app, field });

  // 2) devolve o perfil para PF
  await sendAttachment({
    orderFormId,
    attachmentId: 'clientProfileData',
    payload: profile,
  });

  // 3) zera o endereco da empresa — senao ele sobrevive e vira o endereco de
  //    entrega do PF, que e exatamente o que a trava de endereco unico proibe.
  await clearShippingData(orderFormId);

  const durationMs = Date.now() - startedAt;

  logger.info({ orderFormId, durationMs }, 'Perfil corporativo removido do orderForm');

  res.status(200).json({
    discarded: true,
    orderFormId,
    written: { clientProfileData: profile },
    durationMs,
  });
});
