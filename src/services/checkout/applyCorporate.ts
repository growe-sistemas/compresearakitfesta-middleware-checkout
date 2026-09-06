import { logger } from '../../config/logger.js';
import {
  buildCorporateAddress,
  buildCorporateProfile,
  buildReceiverName,
  type CorporateAddress,
  type CorporateClientProfileData,
  type PersonalData,
} from '../../mappers/corporateProfile.js';
import {
  CUSTOM_DATA_FIELDS,
  clearShippingData,
  putCustomData,
  sendAttachment,
} from '../vtex/checkout.js';
import { AppError } from '../vtex/errors.js';
import type { CnpjVerification } from '../../types/api.js';

/**
 * Aplica um CNPJ ja verificado ao orderForm.
 *
 * Extraido para ser usado por duas rotas: o `corporate-data` (cliente digita o
 * CNPJ) e o `customer-setup` (cliente PJ recorrente, CNPJ vindo da CL). Sao
 * gatilhos diferentes para exatamente a mesma escrita — duplicar seria pedir
 * para as duas divergirem na primeira correcao.
 */
export interface CorporateWriteResult {
  clientProfileData: CorporateClientProfileData;
  shippingAddress: CorporateAddress;
  customData: { field: string; value: string; confirmed: boolean };
}

export async function applyCorporateToOrderForm(options: {
  orderFormId: string;
  verification: CnpjVerification;
  currentProfile: Record<string, unknown> | null | undefined;
  personal: PersonalData;
}): Promise<CorporateWriteResult> {
  const { orderFormId, verification, currentProfile, personal } = options;

  const profile = buildCorporateProfile({ verification, currentProfile, personal });
  const address = buildCorporateAddress({
    verification,
    receiverName: buildReceiverName(profile),
  });

  // A ORDEM IMPORTA.
  //
  // O perfil vem PRIMEIRO de proposito: gravar `clientProfileData` com um
  // e-mail que tem cadastro faz a VTEX carregar sozinha os enderecos daquele
  // cliente para dentro de `selectedAddresses` e `availableAddresses`.
  // (Verificado: um POST so de clientProfileData, sem tocar em shippingData,
  // ja traz o endereco pessoal do comprador.)
  //
  // Gravando o endereco da empresa antes, esse carregamento entraria DEPOIS e
  // o pedido PJ terminaria com o endereco residencial do comprador junto — as
  // vezes ate como o escolhido.
  await sendAttachment({
    orderFormId,
    attachmentId: 'clientProfileData',
    payload: { ...profile },
  });

  // Limpa o que a VTEX acabou de carregar do perfil, e o endereco anterior do
  // orderForm. Sem isto o endereco do PF sobrevive em `availableAddresses` e
  // pode voltar no calculo de frete.
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
  const value = JSON.stringify(verification.erpCustomData);
  const result = await putCustomData({ orderFormId, app, field, value });

  if (result.storedValue !== null && !result.confirmed) {
    throw new AppError(
      502,
      'CUSTOM_DATA_NOT_PERSISTED',
      `A VTEX aceitou a gravacao de ${field} mas devolveu outro valor`,
    );
  }

  logger.info(
    {
      orderFormId,
      cnpj: verification.company.cnpj,
      corporateName: verification.company.corporateName,
      customDataConfirmed: result.confirmed,
    },
    'Perfil corporativo aplicado ao orderForm',
  );

  return {
    clientProfileData: profile,
    shippingAddress: address,
    customData: { field, value, confirmed: result.confirmed },
  };
}
