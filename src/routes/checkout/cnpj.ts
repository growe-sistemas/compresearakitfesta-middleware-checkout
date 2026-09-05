import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { logger } from '../../config/logger.js';
import { isValidCnpj, verifyCnpj } from '../../mappers/cnpj.js';
import { fetchCnpjSources } from '../../services/documents/cnpjSources.js';

/**
 * POST /middleware/checkout/cnpj/verify
 *
 * Uma requisicao no lugar das quatro que o checkout dispara hoje
 * (`getDataSintegraRF` + `getDataSintegraSN` + `getDataSintegraST` +
 * `publica.cnpj.ws` chamada do navegador), com a consolidacao, a validacao e o
 * payload do ERP prontos.
 *
 * ---------------------------------------------------------------------------
 * REQUEST
 * ---------------------------------------------------------------------------
 * ```json
 * {
 *   "cnpj": "50.972.373/0001-00",
 *   "fallbackEmail": "cliente@dominio.com"
 * }
 * ```
 * - `cnpj`          obrigatorio. Com ou sem mascara.
 * - `fallbackEmail` opcional, mas o checkout deve sempre mandar: vira
 *                   `DS_EMAIL_NFD` quando a empresa nao tem e-mail proprio.
 *
 * ---------------------------------------------------------------------------
 * RESPONSE 200 — aprovado (objeto plano, sem envelope)
 * ---------------------------------------------------------------------------
 * ```json
 * {
 *   "approved": true,
 *   "reason": null,
 *   "message": null,
 *   "missingFiscalFields": [],
 *   "company": {
 *     "cnpj": "50972373000100",
 *     "corporateName": "GROWE LTDA",
 *     "tradeName": "GROWE LTDA",
 *     "stateInscription": null,
 *     "registrationStatus": "ativa",
 *     "phone": "+551199398511",
 *     "email": "contato@groweag.com",
 *     "foundedAt": "2023-06-07",
 *     "legalNature": "206-2 - Sociedade Empresaria Limitada",
 *     "size": "ME",
 *     "simplesNacional": true,
 *     "mei": false,
 *     "mainActivityCode": "9511800",
 *     "icmsTaxpayer": null
 *   },
 *   "address": {
 *     "postalCode": "04563000",
 *     "postalCodeFormatted": "04563-000",
 *     "street": "AV PDE ANTONIO JOSE DOS SANTOS",
 *     "number": "258",
 *     "complement": "APT 43",
 *     "neighborhood": "CIDADE MONCOES",
 *     "city": "Sao Paulo",
 *     "state": "SP",
 *     "country": "BRA"
 *   },
 *   "erpCustomData": {
 *     "DS_EMAIL_NFD": "contato@groweag.com",
 *     "ID_INS_ESTADUAL_SBT_TRB": null,
 *     "ID_OPTANTE_SIMPLES": 1,
 *     "DT_FUNDACAO": "07/06/2023",
 *     "ID_INSCRICAO_ESTADUAL": "Isento",
 *     "CD_CNA": "9511800",
 *     "ID_CONTRIBUINTE_ICMS": null,
 *     "ID_CALCULA_ICR": 0,
 *     "NATUREZA_JURIDICA": "206-2 - Sociedade Empresaria Limitada",
 *     "ID_MICRO_EMPRESA": 1,
 *     "ID_MEI": 0
 *   },
 *   "sources": { "RF": "ok", "SN": "ok", "ST": "not_found", "PUBLICA": "ok" },
 *   "cache": { "hit": false },
 *   "durationMs": 1178
 * }
 * ```
 *
 * `erpCustomData` e exatamente o payload de `custom_cnpj_data`: quem chama
 * grava sem transformar nada.
 *
 * ---------------------------------------------------------------------------
 * RESPONSE 200 — reprovado (reprovacao de negocio NAO e erro HTTP)
 * ---------------------------------------------------------------------------
 * ```json
 * {
 *   "approved": false,
 *   "reason": "REGISTRATION_INACTIVE",
 *   "message": "A situacao cadastral do CNPJ informado consta como irregular...",
 *   "missingFiscalFields": [],
 *   "company": {}, "address": {}, "erpCustomData": {},
 *   "sources": {}, "cache": {}, "durationMs": 0
 * }
 * ```
 * `reason`:
 * - `DOCUMENT_NOT_FOUND`     as quatro fontes responderam e nenhuma conhece o
 *                            CNPJ. Tentar de novo NAO adianta.
 * - `SOURCES_UNAVAILABLE`    nenhuma fonte conseguiu responder (rede/timeout).
 *                            Aqui sim vale tentar de novo.
 * - `REGISTRATION_INACTIVE`  situacao cadastral diferente de "ativa"
 *                            (ex.: empresa baixada).
 * - `INCOMPLETE_FISCAL_DATA` falta campo obrigatorio; quais, em
 *                            `missingFiscalFields`.
 * - `MISSING_POSTAL_CODE`    sem CEP em nenhuma fonte.
 *
 * `sources` diz como cada fonte se saiu: `ok` | `not_found` | `timeout` |
 * `error` | `unavailable`. `ST: "not_found"` e resposta legitima — significa
 * empresa sem inscricao estadual.
 *
 * ---------------------------------------------------------------------------
 * ERROS
 * ---------------------------------------------------------------------------
 * - `400 VALIDATION_ERROR`       CNPJ curto ou com digito verificador errado
 *                                (barrado antes de gastar consulta paga)
 * - `502`/`504 SINTEGRA_*`       provedor fora ou lento
 * - `503 SERVICE_NOT_CONFIGURED` sem `SINTEGRA_TOKEN`
 *
 * O contrato esta em `docs/04-contratos-api.md`; o porque de cada regra, em
 * `docs/06-sintegra-e-orderform.md`.
 */
const verifyCnpjBody = z.object({
  cnpj: z
    .string()
    .transform((value) => value.replace(/\D/g, ''))
    .refine((value) => value.length === 14, 'CNPJ deve ter 14 digitos')
    // Digito verificador conferido antes de gastar consulta paga.
    .refine(isValidCnpj, 'CNPJ invalido'),
  /**
   * E-mail do cliente, usado em `DS_EMAIL_NFD` quando a empresa nao tem
   * e-mail proprio nas fontes. Opcional: sem ele, o campo pode ficar nulo e a
   * verificacao reprova com `INCOMPLETE_FISCAL_DATA` — que e exatamente o que
   * o ERP precisa saber.
   */
  fallbackEmail: z.string().email().optional(),
});

export const verifyCnpjRoute = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const { cnpj, fallbackEmail } = verifyCnpjBody.parse(req.body);

  const { sources, statuses, cache } = await fetchCnpjSources(cnpj);

  const verification = verifyCnpj({ cnpj, sources, statuses, fallbackEmail });

  const durationMs = Date.now() - startedAt;

  logger.info(
    {
      cnpj,
      approved: verification.approved,
      reason: verification.reason,
      missingFiscalFields: verification.missingFiscalFields,
      sources: statuses,
      cacheHit: cache.hit,
      durationMs,
    },
    'Verificacao de CNPJ concluida',
  );

  // Reprovacao e resposta valida de negocio: 200, com `approved: false`.
  res.status(200).json({
    ...verification,
    sources: statuses,
    cache,
    durationMs,
  });
});
