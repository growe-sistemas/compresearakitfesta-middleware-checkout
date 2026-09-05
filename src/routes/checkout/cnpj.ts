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

  const verification = verifyCnpj({ cnpj, sources, fallbackEmail });

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
