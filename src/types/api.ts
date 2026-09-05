/**
 * Contrato de saida deste middleware (o que os consumidores externos veem).
 *
 * Convencoes (ver `docs/04-contratos-api.md`):
 * - resposta de sucesso e um objeto plano, sem envelope;
 * - ausencia de valor e `null` explicito, nunca chave omitida;
 * - documento so digitos, data em ISO `YYYY-MM-DD`, telefone em E.164;
 * - reprovacao de negocio e HTTP 200 com `approved: false`, nao erro HTTP;
 * - erro e sempre `{ error: { code, message, requestId, details? } }`.
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

// ---------------------------------------------------------------------------
// POST /middleware/checkout/cnpj/verify
// ---------------------------------------------------------------------------

export type CnpjVerificationReason =
  /**
   * Todas as fontes responderam, e todas disseram que o CNPJ nao existe.
   * Diferente de `SOURCES_UNAVAILABLE`: aqui tentar de novo nao adianta.
   */
  | 'DOCUMENT_NOT_FOUND'
  /** Nenhuma fonte conseguiu responder (rede, timeout, provedor fora). */
  | 'SOURCES_UNAVAILABLE'
  /** Situacao cadastral diferente de "ativa". */
  | 'REGISTRATION_INACTIVE'
  /** Falta algum campo obrigatorio do payload fiscal. */
  | 'INCOMPLETE_FISCAL_DATA'
  /** Sem CEP em nenhuma fonte (nem mascarado). */
  | 'MISSING_POSTAL_CODE';

export interface CnpjCompany {
  /** So digitos. */
  cnpj: string;
  corporateName: string | null;
  /** Nome fantasia. O front hoje grava a razao social aqui — ver docs/06. */
  tradeName: string | null;
  /** `null` = empresa sem inscricao estadual (o ERP recebe "Isento"). */
  stateInscription: string | null;
  /** Minusculo: `ativa`, `baixada`, `suspensa`, ... */
  registrationStatus: string | null;
  /** E.164. */
  phone: string | null;
  email: string | null;
  /** ISO `YYYY-MM-DD`. */
  foundedAt: string | null;
  /** Formato unico `206-2 - Descricao`, venha de onde vier. */
  legalNature: string | null;
  /** Vocabulario unico: `ME` | `EPP` | `DEMAIS`. */
  size: string | null;
  simplesNacional: boolean | null;
  mei: boolean | null;
  mainActivityCode: string | null;
  /**
   * Contribuinte de ICMS, do plugin ST. Dado novo: nao vai para o
   * `erpCustomData` (onde `ID_CONTRIBUINTE_ICMS` segue fixo em `null`, como
   * hoje), mas fica disponivel caso o ERP passe a querer.
   */
  icmsTaxpayer: boolean | null;
}

export interface CnpjAddress {
  /** So digitos. */
  postalCode: string | null;
  /** `00000-000`. */
  postalCodeFormatted: string | null;
  street: string | null;
  /** Default `'0'`, como no fluxo antigo. */
  number: string;
  /** Default `'NC'`, como no fluxo antigo. */
  complement: string;
  /** Default `'NC'`, como no fluxo antigo. */
  neighborhood: string;
  city: string | null;
  state: string | null;
  country: 'BRA';
}

/**
 * Payload de `orderForm.customData.custom_cnpj_data` — o contrato com o ERP.
 * Os nomes e os formatos sao os que o ERP ja recebe hoje.
 */
export interface CnpjErpCustomData {
  DS_EMAIL_NFD: string | null;
  ID_INS_ESTADUAL_SBT_TRB: null;
  ID_OPTANTE_SIMPLES: 0 | 1 | null;
  /** `dd/mm/yyyy`. */
  DT_FUNDACAO: string | null;
  ID_INSCRICAO_ESTADUAL: string | null;
  CD_CNA: string | null;
  ID_CONTRIBUINTE_ICMS: null;
  ID_CALCULA_ICR: 0;
  NATUREZA_JURIDICA: string | null;
  ID_MICRO_EMPRESA: 0 | 1 | null;
  ID_MEI: 0 | 1 | null;
}

export interface CnpjVerification {
  approved: boolean;
  reason: CnpjVerificationReason | null;
  /** Texto pronto para a tela, em pt-BR. `null` quando aprovado. */
  message: string | null;
  /** Campos fiscais que ficaram sem valor. Vazio quando aprovado. */
  missingFiscalFields: string[];
  company: CnpjCompany;
  address: CnpjAddress;
  erpCustomData: CnpjErpCustomData;
}

/**
 * Diagnostico que acompanha a resposta das rotas de CNPJ. Vai no mesmo nivel
 * do resultado, nao dentro de um envelope.
 */
export interface CnpjVerificationDiagnostics {
  cache: { hit: boolean; ageSeconds?: number };
  /** Como cada fonte se saiu — diagnostico que o fluxo antigo nao dava. */
  sources: Record<'RF' | 'SN' | 'ST' | 'PUBLICA', string>;
  /** Tempo total da consolidacao. */
  durationMs: number;
}
