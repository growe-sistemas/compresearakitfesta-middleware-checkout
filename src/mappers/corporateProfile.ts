import { AppError } from '../services/vtex/errors.js';
import type { CnpjVerification } from '../types/api.js';

/**
 * Monta o que vai para o orderForm no fluxo PJ — funcao pura.
 *
 * E o de/para que hoje vive dentro de `_handleCNPJSearchBtnClickEv`
 * (`checkout-ui/.../controller.js:1673-1712`), lendo valores do DOM. Aqui a
 * entrada e explicita: a verificacao do CNPJ e os dados de pessoa fisica que
 * ja existem no orderForm (ou que o chamador informou).
 */

/** Dados de PF que o orderForm ja tem, ou que o chamador quer sobrescrever. */
export interface PersonalData {
  email?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  /** CPF, so digitos. */
  document?: string | undefined;
  /** Telefone do comprador, em E.164 ou so digitos. */
  phone?: string | undefined;
}

export interface CorporateClientProfileData {
  email: string;
  firstName: string | null;
  lastName: string | null;
  document: string | null;
  documentType: 'cpf';
  phone: string | null;
  corporateName: string | null;
  tradeName: string | null;
  corporateDocument: string;
  stateInscription: string;
  corporatePhone: string | null;
  isCorporate: true;
  profileCompleteOnLoading: false;
  profileErrorOnLoading: false;
  customerClass: null;
}

export interface CorporateAddress {
  addressType: 'residential';
  country: 'BRA';
  postalCode: string;
  city: string | null;
  complement: string;
  neighborhood: string;
  state: string | null;
  street: string | null;
  number: string;
  receiverName: string | null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * A VTEX devolve o `clientProfileData` MASCARADO quando o comprador nao esta
 * autenticado na sessao:
 *
 * ```json
 * { "firstName": "G***", "document": "***41", "corporateName": "G*** S*** D***" }
 * ```
 *
 * Esses valores nao podem ser reaproveitados: gravar `firstName: "G***"` de
 * volta corrompe o cadastro com um dado que PARECE valido. Aqui mascarado vale
 * como ausente — o valor real vem da entidade CL, ou o campo fica nulo.
 */
export function isMasked(value: unknown): boolean {
  return typeof value === 'string' && value.includes('***');
}

/** `text`, mas descartando valor mascarado pela VTEX. */
function unmasked(value: unknown): string | null {
  const parsed = text(value);
  return parsed === null || isMasked(parsed) ? null : parsed;
}

/** Telefone em E.164. Aceita ja formatado ou so digitos. */
function toE164(value: string | null): string | null {
  if (value === null) return null;
  const digits = value.replace(/\D/g, '');
  if (digits === '') return null;

  const national = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
  if (national.length !== 10 && national.length !== 11) return null;

  return `+55${national}`;
}

/**
 * Le um campo de PF, com tres fontes em ordem de confianca:
 *
 * 1. `override` — o que o chamador mandou (o valor da tela). O front lia do
 *    DOM porque, na hora da busca de CNPJ, o passo de perfil pode nao ter
 *    sido submetido ainda.
 * 2. `current` — o `clientProfileData` do orderForm, **se nao estiver
 *    mascarado**.
 * 3. `masterData` — o documento CL, a fonte de verdade do cadastro.
 *
 * Nenhuma das tres tendo o valor, devolve `null`. Nulo e melhor que `"G***"`:
 * ausencia honesta em vez de dado corrompido com cara de valido.
 */
function pickPersonal(
  override: string | undefined,
  current: Record<string, unknown> | null | undefined,
  masterData: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  return text(override) ?? unmasked(current?.[key]) ?? unmasked(masterData?.[key]);
}

/**
 * `clientProfileData` do cliente PJ.
 *
 * Campos de PF (email, nome, CPF, telefone) sao preservados — a compra PJ
 * continua tendo um comprador pessoa fisica por tras. O que se acrescenta sao
 * os campos corporativos e o `isCorporate: true`.
 */
export function buildCorporateProfile(options: {
  verification: CnpjVerification;
  currentProfile: Record<string, unknown> | null | undefined;
  /** Documento CL do cliente. Fonte de verdade quando o orderForm vem mascarado. */
  masterDataProfile?: Record<string, unknown> | null | undefined;
  personal: PersonalData;
}): CorporateClientProfileData {
  const { verification, currentProfile, personal } = options;
  const masterDataProfile = options.masterDataProfile ?? null;
  const { company } = verification;

  const email = pickPersonal(personal.email, currentProfile, masterDataProfile, 'email');
  if (email === null) {
    // Falta de dado do chamador, nao falha do servico: 400, com o que fazer.
    throw new AppError(
      400,
      'MISSING_CLIENT_EMAIL',
      'Nao foi possivel identificar o e-mail do cliente: o orderForm ainda nao tem clientProfileData e a requisicao nao enviou personal.email',
    );
  }

  // A CL guarda o telefone em `phone` e, em cadastros antigos, em `homePhone`.
  const phone =
    pickPersonal(personal.phone, currentProfile, masterDataProfile, 'phone') ??
    pickPersonal(undefined, null, masterDataProfile, 'homePhone');

  return {
    email,
    firstName: pickPersonal(personal.firstName, currentProfile, masterDataProfile, 'firstName'),
    lastName: pickPersonal(personal.lastName, currentProfile, masterDataProfile, 'lastName'),
    document: (
      pickPersonal(personal.document, currentProfile, masterDataProfile, 'document') ?? ''
    ).replace(/\D/g, '') || null,
    documentType: 'cpf',
    phone: toE164(phone),

    corporateName: company.corporateName,
    // PARIDADE COM O FRONT: ele grava a razao social aqui, nao o nome fantasia
    // (`controller.js:1704` usa `data?.nome` nos dois campos). O valor correto
    // seria `company.tradeName`. Mantido como esta ate o time do ERP decidir —
    // trocar e uma linha. Ver docs/06.
    tradeName: company.corporateName,
    corporateDocument: company.cnpj,
    // Empresa sem inscricao estadual e "Isento": resposta legitima do plugin
    // ST, nao ausencia de dado.
    stateInscription: company.stateInscription ?? 'Isento',
    // Sem telefone da empresa, cai no do comprador — mesmo fallback do front.
    corporatePhone: company.phone ?? toE164(phone),

    isCorporate: true,
    profileCompleteOnLoading: false,
    profileErrorOnLoading: false,
    customerClass: null,
  };
}

/**
 * Endereco de entrega da PJ: o da Junta Comercial.
 *
 * `addressType: 'residential'` e `country: 'BRA'` sao fixos, como no front.
 * (O tipo `residential` para uma empresa e estranho, mas e o que a loja usa
 * hoje — mudar afetaria calculo de frete.)
 */
export function buildCorporateAddress(options: {
  verification: CnpjVerification;
  receiverName: string | null;
}): CorporateAddress {
  const { address } = options.verification;

  return {
    addressType: 'residential',
    country: 'BRA',
    // `MISSING_POSTAL_CODE` ja barra a verificacao antes daqui, entao o CEP
    // existe quando esta funcao roda.
    postalCode: address.postalCode ?? '',
    city: address.city,
    complement: address.complement,
    neighborhood: address.neighborhood,
    state: address.state,
    street: address.street,
    number: address.number,
    receiverName: options.receiverName,
  };
}

/** Campos que valem buscar na CL quando o orderForm vem mascarado. */
export const CLIENT_PROFILE_FIELDS = [
  'id',
  'email',
  'firstName',
  'lastName',
  'document',
  'phone',
  'homePhone',
] as const;

/**
 * Precisa consultar a entidade CL?
 *
 * So quando algum campo de PF esta mascarado ou ausente no orderForm. Comprador
 * autenticado traz tudo em claro e a consulta e pulada — a CL so entra para
 * consertar o que veio como `"G***"`.
 */
export function needsMasterDataProfile(
  currentProfile: Record<string, unknown> | null | undefined,
  personal: PersonalData,
): boolean {
  const faltando = (chave: keyof PersonalData, campo: string): boolean =>
    text(personal[chave]) === null && unmasked(currentProfile?.[campo]) === null;

  return (
    faltando('firstName', 'firstName') ||
    faltando('lastName', 'lastName') ||
    faltando('document', 'document') ||
    faltando('phone', 'phone')
  );
}

/** `Nome Sobrenome` do comprador, para o `receiverName` do endereco. */
export function buildReceiverName(profile: CorporateClientProfileData): string | null {
  const parts = [profile.firstName, profile.lastName].filter(
    (part): part is string => part !== null,
  );
  return parts.length === 0 ? null : parts.join(' ');
}

/**
 * `clientProfileData` de volta para pessoa fisica.
 *
 * Usado quando o cliente desiste do CNPJ. Zera os campos corporativos e
 * preserva os de PF — e o que `_handleDiscardCNPJ` faz
 * (`checkout-ui/.../controller.js:1063`), so que sem depender de o orderForm
 * ja estar carregado no navegador.
 */
export function buildPersonalProfileReset(
  currentProfile: Record<string, unknown> | null | undefined,
  masterDataProfile?: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const md = masterDataProfile ?? null;
  const email = unmasked(currentProfile?.['email']) ?? unmasked(md?.['email']);
  if (email === null) {
    throw new AppError(
      400,
      'MISSING_CLIENT_EMAIL',
      'O orderForm nao tem clientProfileData: nao ha perfil corporativo para desfazer',
    );
  }

  return {
    email,
    // Mesma regra do perfil corporativo: mascarado nao e reaproveitado.
    firstName: unmasked(currentProfile?.['firstName']) ?? unmasked(md?.['firstName']),
    lastName: unmasked(currentProfile?.['lastName']) ?? unmasked(md?.['lastName']),
    document: unmasked(currentProfile?.['document']) ?? unmasked(md?.['document']),
    documentType: 'cpf',
    phone:
      unmasked(currentProfile?.['phone']) ??
      unmasked(md?.['phone']) ??
      unmasked(md?.['homePhone']),

    corporateName: null,
    tradeName: null,
    corporateDocument: null,
    stateInscription: null,
    corporatePhone: null,

    isCorporate: false,
    profileCompleteOnLoading: false,
    profileErrorOnLoading: false,
    customerClass: null,
  };
}
