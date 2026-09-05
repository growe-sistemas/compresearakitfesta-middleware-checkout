import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { logger } from '../../config/logger.js';
import { isValidCnpj, verifyCnpj } from '../../mappers/cnpj.js';
import {
  buildCorporateAddress,
  buildCorporateProfile,
  buildReceiverName,
} from '../../mappers/corporateProfile.js';
import { fetchCnpjSources } from '../../services/documents/cnpjSources.js';
import {
  CUSTOM_DATA_FIELDS,
  clearShippingData,
  getOrderForm,
  orderFormIdSchema,
  putCustomData,
  sendAttachment,
} from '../../services/vtex/checkout.js';
import { AppError } from '../../services/vtex/errors.js';

/**
 * POST /v2/checkout/corporate-profile
 *
 * Busca o CNPJ e **popula o orderForm** com os dados de PJ: perfil
 * corporativo, endereco da Junta Comercial e o payload fiscal do ERP.
 *
 * E o `_handleCNPJSearchBtnClickEv` (`checkout-ui/.../controller.js:1512`)
 * inteiro, do lado do servidor: hoje o front dispara 4 consultas de CNPJ,
 * consolida no navegador e depois faz 4 escritas no orderForm. Aqui e uma
 * requisicao.
 *
 * Duas diferencas de comportamento que valem registro:
 *
 * 1. **As escritas sao sequenciais.** O front usa `Promise.all`
 *    (`controller.js:1726`), mas attachments do orderForm sao estado
 *    compartilhado: escritas concorrentes podem se sobrepor e a ultima
 *    resposta nao reflete as outras. Em ordem, cada passo enxerga o anterior.
 * 2. **CNPJ reprovado nao escreve nada.** O front so validava depois de ja ter
 *    limpado o `shippingData`, entao uma reprovacao no meio deixava o
 *    orderForm sem endereco.
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

export const applyCorporateProfile = asyncHandler(async (req, res) => {
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

  const verification = verifyCnpj({ cnpj, sources, fallbackEmail });

  // 2) Reprovado: devolve o motivo SEM tocar no orderForm.
  if (!verification.approved) {
    logger.info(
      { orderFormId, cnpj, reason: verification.reason, sources: statuses },
      'CNPJ reprovado; orderForm intacto',
    );

    res.status(200).json({
      data: { applied: false, verification },
      meta: { cache, sources: statuses, durationMs: Date.now() - startedAt },
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

  // 3) Escritas, em ordem.
  await clearShippingData(orderFormId);

  await sendAttachment({
    orderFormId,
    attachmentId: 'shippingData',
    payload: {
      selectedAddresses: [address],
      // Sem isto, CEP que a VTEX nao reconhece apagaria o endereco recem-gravado.
      clearAddressIfPostalCodeNotFound: false,
    },
  });

  await sendAttachment({
    orderFormId,
    attachmentId: 'clientProfileData',
    payload: { ...profile },
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
    data: {
      applied: true,
      verification,
      /** Exatamente o que foi gravado no orderForm. */
      written: {
        clientProfileData: profile,
        shippingAddress: address,
        customData: { field, value: customDataValue, confirmed: customDataResult.confirmed },
      },
    },
    meta: { cache, sources: statuses, durationMs },
  });
});
