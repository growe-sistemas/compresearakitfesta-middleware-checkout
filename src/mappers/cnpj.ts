import type { PublicaCnpjResponse } from '../services/publicacnpj/client.js';
import type {
  CnpjAddress,
  CnpjCompany,
  CnpjErpCustomData,
  CnpjVerification,
  CnpjVerificationReason,
} from '../types/api.js';

/**
 * Consolidacao de CNPJ — funcao pura.
 *
 * Recebe o que cada fonte devolveu (ou `null`, se falhou) e produz UMA visao:
 * empresa, endereco e o payload fiscal do ERP. Todo o de/para que hoje esta
 * espalhado no `checkout-ui` (`_convertSintegraDataToCustomData`, os sete
 * getters de endereco, `convertPJtoDesiredInterface`) mora aqui.
 *
 * Regras que valem para o arquivo inteiro:
 *
 * - **Precedencia por campo, nao por fonte.** O antigo escolhia a fonte inteira
 *   ("se tem PUBLICA, usa PUBLICA") e por isso o mesmo CNPJ virava dado
 *   diferente conforme quem respondia primeiro. Aqui cada campo tem a sua
 *   ordem, e a Receita (RF) ganha quando as duas tem o dado.
 * - **Valor mascarado nao conta.** A SintegraWS devolve `*` no lugar do que nao
 *   tem (`"********"`, `"***.364.658-**"`). Isso e ausencia, e cai para a
 *   proxima fonte.
 * - **Ausencia e `null` explicito, nunca `undefined`.** No antigo, um
 *   `undefined` passava pela validacao (que so testava `=== null`) e depois
 *   sumia no `JSON.stringify`, mandando o payload para o ERP sem a chave.
 */

/** Como cada fonte se saiu na consulta. Vai no `meta.sources` da resposta. */
export type SourceStatus = 'ok' | 'not_found' | 'error' | 'timeout' | 'unavailable';

export interface CnpjSources {
  /** Receita Federal (plugin RF da SintegraWS). */
  rf: Record<string, unknown> | null;
  /** Simples Nacional (plugin SN). */
  sn: Record<string, unknown> | null;
  /** Substituicao Tributaria / Sintegra estadual (plugin ST). */
  st: Record<string, unknown> | null;
  /** Base publica da Receita (publica.cnpj.ws). */
  publica: PublicaCnpjResponse | null;
}

/** Campos do `erpCustomData` que o fluxo PJ exige preenchidos. */
export const REQUIRED_FISCAL_FIELDS = [
  'DS_EMAIL_NFD',
  'ID_OPTANTE_SIMPLES',
  'DT_FUNDACAO',
  'ID_INSCRICAO_ESTADUAL',
  'CD_CNA',
  'NATUREZA_JURIDICA',
  'ID_MICRO_EMPRESA',
  'ID_MEI',
] as const satisfies readonly (keyof CnpjErpCustomData)[];

// ---------------------------------------------------------------------------
// Leitura defensiva (as respostas das fontes sao `unknown` por schema aberto)
// ---------------------------------------------------------------------------

function readString(source: Record<string, unknown> | null, key: string): string | null {
  if (source === null) return null;
  const value = source[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readBoolean(source: Record<string, unknown> | null, key: string): boolean | null {
  if (source === null) return null;
  const value = source[key];
  return typeof value === 'boolean' ? value : null;
}

/** Igual a `readString`, mas descarta valor mascarado com `*` pela SintegraWS. */
function readUnmasked(source: Record<string, unknown> | null, key: string): string | null {
  const value = readString(source, key);
  if (value === null || value.includes('*')) return null;
  return value;
}

function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Primeiro candidato nao nulo. E o operador de precedencia deste arquivo. */
function firstOf(...candidates: readonly (string | null)[]): string | null {
  for (const candidate of candidates) {
    if (candidate !== null) return candidate;
  }
  return null;
}

function digitsOnly(value: string | null): string | null {
  if (value === null) return null;
  const digits = value.replace(/\D/g, '');
  return digits === '' ? null : digits;
}

/**
 * Minusculas e sem acento, para comparar texto vindo das fontes.
 * As duas escrevem a mesma coisa de jeitos diferentes ("NÃO enquadrado",
 * "Não", "Micro Empresa"), entao comparacao crua nao serve.
 */
function foldAccents(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

// ---------------------------------------------------------------------------
// Normalizadores de formato
// ---------------------------------------------------------------------------

/** `dd/mm/yyyy` ou `yyyy-mm-dd` -> `yyyy-mm-dd`. */
export function toIsoDate(value: string | null): string | null {
  if (value === null) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (match === null) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/** `yyyy-mm-dd` -> `dd/mm/yyyy` (formato que o ERP recebe hoje). */
export function toBrazilianDate(isoDate: string | null): string | null {
  if (isoDate === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return null;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Natureza juridica em UM formato so: `206-2 - Descricao`.
 *
 * A RF ja devolve assim; a publica.cnpj.ws devolve o codigo colado (`2062`).
 * Sem esta normalizacao o ERP recebia formato diferente conforme a fonte.
 */
export function formatLegalNatureCode(code: string): string {
  const digits = code.replace(/\D/g, '');
  if (digits.length !== 4) return code;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

function normalizeLegalNature(value: string): string {
  const separatorIndex = value.indexOf(' - ');
  if (separatorIndex === -1) return value;

  const code = value.slice(0, separatorIndex);
  const description = value.slice(separatorIndex + 3);
  return `${formatLegalNatureCode(code)} - ${description}`;
}

/**
 * Porte em UM vocabulario so: `ME` / `EPP` / `DEMAIS`.
 *
 * A RF devolve `"ME"`; a publica devolve `"Micro Empresa"`. O antigo comparava
 * `porte === 'ME'` direto, entao a mesma empresa virava `ID_MICRO_EMPRESA` 1
 * (via RF) ou 0 (via publica).
 */
export function normalizeCompanySize(value: string | null): string | null {
  if (value === null) return null;

  const normalized = foldAccents(value);

  if (normalized === 'me' || normalized.includes('micro empresa') || normalized === 'microempresa') {
    return 'ME';
  }
  if (normalized === 'epp' || normalized.includes('pequeno porte')) return 'EPP';
  if (normalized.includes('demais')) return 'DEMAIS';

  return value.trim().toUpperCase();
}

/** Telefone brasileiro em E.164. Fora de 10/11 digitos, devolve `null`. */
function toE164(value: string | null): string | null {
  const digits = digitsOnly(value);
  if (digits === null) return null;

  const national = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
  if (national.length !== 10 && national.length !== 11) return null;

  return `+55${national}`;
}

/** Remove pontuacao do complemento e colapsa espaco (a publica manda `"APT   43"`). */
function cleanComplement(value: string | null): string | null {
  if (value === null) return null;
  const cleaned = value.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned;
}

/** `"Sim"`/`"Não"` da publica.cnpj.ws -> booleano. */
function yesNo(value: string | null): boolean | null {
  if (value === null) return null;
  const normalized = foldAccents(value);
  if (normalized === 'sim') return true;
  if (normalized === 'nao') return false;
  return null;
}

/** Frase da SintegraWS que comeca com "NÃO" -> `false`; senao `true`. */
function affirmativePhrase(value: string | null): boolean | null {
  if (value === null) return null;
  const normalized = foldAccents(value);

  if (normalized.startsWith('nao ') || normalized.includes('nao existe')) return false;
  if (normalized.startsWith('optante') || normalized.includes('enquadrado')) return true;
  return null;
}

// ---------------------------------------------------------------------------
// Extracao por campo
// ---------------------------------------------------------------------------

function publicaEstablishment(publica: PublicaCnpjResponse | null): Record<string, unknown> | null {
  const establishment = publica?.estabelecimento;
  return establishment === null || establishment === undefined
    ? null
    : (establishment as Record<string, unknown>);
}

function rfMainActivityCode(rf: Record<string, unknown> | null): string | null {
  if (rf === null) return null;
  const activities = rf['atividade_principal'];
  if (!Array.isArray(activities) || activities.length === 0) return null;

  const first: unknown = activities[0];
  if (typeof first !== 'object' || first === null) return null;
  return text((first as Record<string, unknown>)['code']);
}

/**
 * Inscricao estadual — o motivo de o plugin ST existir.
 *
 * Nem RF, nem SN devolvem este campo, e a rota `getDataSintegraST` antiga
 * chamava o plugin RF por engano: `stateInscription` caia sempre em `Isento`.
 *
 * O plugin ST responde `code: "1"` com a mensagem "Nenhum estabelecimento
 * encontrado no SINTEGRA" para empresa **sem** inscricao estadual. Isso e uma
 * resposta legitima ("nao e contribuinte"), nao uma falha — e por isso a
 * ausencia aqui vira `Isento`, nao erro.
 */
function stateInscription(sources: CnpjSources): string | null {
  const fromSt = readUnmasked(sources.st, 'inscricao_estadual');
  if (fromSt !== null) return fromSt;

  const registrations = publicaEstablishment(sources.publica)?.['inscricoes_estaduais'];
  if (!Array.isArray(registrations)) return null;

  const active = registrations.find((item: unknown) => {
    if (typeof item !== 'object' || item === null) return false;
    return (item as Record<string, unknown>)['ativo'] === true;
  });

  if (active === undefined) return null;
  return text((active as Record<string, unknown>)['inscricao_estadual']);
}

function buildCompany(sources: CnpjSources, cnpj: string, fallbackEmail: string | null): CnpjCompany {
  const { rf, sn, st, publica } = sources;
  const establishment = publicaEstablishment(publica);

  const legalNatureFromRf = readUnmasked(rf, 'natureza_juridica');
  const publicaNatureId = text(publica?.natureza_juridica?.id);
  const publicaNatureDescription = text(publica?.natureza_juridica?.descricao);

  const legalNature =
    legalNatureFromRf !== null
      ? normalizeLegalNature(legalNatureFromRf)
      : publicaNatureId !== null && publicaNatureDescription !== null
        ? `${formatLegalNatureCode(publicaNatureId)} - ${publicaNatureDescription}`
        : publicaNatureDescription;

  const size = normalizeCompanySize(
    firstOf(readUnmasked(rf, 'porte'), text(publica?.porte?.descricao)),
  );

  // Simples Nacional: o SN e a fonte oficial; a publica confirma.
  // Diferenca de comportamento proposital em relacao ao antigo, que fazia
  // `includes('NÃO') ? 0 : 1` — ou seja, tratava resposta ilegivel como
  // "optante". Aqui, sem informacao, o campo fica `null` e a compra e barrada
  // com motivo explicito, em vez de mandar regime tributario errado ao ERP.
  const simplesNacional =
    affirmativePhrase(readString(sn, 'situacao_simples_nacional')) ??
    yesNo(text(publica?.simples?.simples));

  const mei =
    affirmativePhrase(readString(sn, 'situacao_simei')) ??
    yesNo(text(publica?.simples?.mei)) ??
    (readUnmasked(rf, 'sigla_natureza_juridica')?.toLowerCase() === 'mei' ? true : null);

  const registrationStatus = firstOf(
    readUnmasked(rf, 'situacao'),
    text(establishment?.['situacao_cadastral']),
  );

  const email = firstOf(
    readUnmasked(rf, 'email'),
    text(establishment?.['email']),
    fallbackEmail,
  );

  const publicaPhone = (() => {
    const areaCode = text(establishment?.['ddd1']);
    const number = text(establishment?.['telefone1']);
    return areaCode !== null && number !== null ? `${areaCode}${number}` : null;
  })();

  return {
    cnpj,
    corporateName: firstOf(readUnmasked(rf, 'nome'), text(publica?.razao_social)),
    tradeName: firstOf(readUnmasked(rf, 'fantasia'), text(establishment?.['nome_fantasia'])),
    stateInscription: stateInscription(sources),
    registrationStatus: registrationStatus === null ? null : registrationStatus.toLowerCase(),
    phone: toE164(firstOf(readUnmasked(rf, 'telefone'), publicaPhone)),
    email: email === null ? null : email.toLowerCase(),
    foundedAt: toIsoDate(
      firstOf(readUnmasked(rf, 'abertura'), text(establishment?.['data_inicio_atividade'])),
    ),
    legalNature,
    size,
    simplesNacional,
    mei,
    mainActivityCode: firstOf(
      rfMainActivityCode(rf),
      text(publica?.estabelecimento?.atividade_principal?.id),
    ),
    // Disponivel so pelo plugin ST. Nao vai para o `erpCustomData` (o campo
    // `ID_CONTRIBUINTE_ICMS` segue fixo em `null`, como hoje), mas fica exposto
    // porque o ERP pode passar a querer.
    icmsTaxpayer: readBoolean(st, 'contribuinte_icms'),
  };
}

function buildAddress(sources: CnpjSources): CnpjAddress {
  const { rf, publica } = sources;
  const establishment = publicaEstablishment(publica);

  // A publica separa tipo e nome do logradouro ("AVENIDA" + "PDE ANTONIO...");
  // a RF ja entrega junto e abreviado. O antigo usava so o nome, entao o
  // endereco vindo da publica perdia o "AVENIDA".
  const publicaStreet = (() => {
    const type = text(establishment?.['tipo_logradouro']);
    const name = text(establishment?.['logradouro']);
    if (name === null) return null;
    return type === null ? name : `${type} ${name}`;
  })();

  const postalCode = digitsOnly(
    firstOf(readUnmasked(rf, 'cep'), text(establishment?.['cep'])),
  );

  return {
    postalCode,
    postalCodeFormatted:
      postalCode !== null && postalCode.length === 8
        ? `${postalCode.slice(0, 5)}-${postalCode.slice(5)}`
        : null,
    street: firstOf(readUnmasked(rf, 'logradouro'), publicaStreet),
    number: firstOf(digitsOnly(readUnmasked(rf, 'numero')), digitsOnly(text(establishment?.['numero']))) ?? '0',
    complement:
      firstOf(
        cleanComplement(readUnmasked(rf, 'complemento')),
        cleanComplement(text(establishment?.['complemento'])),
      ) ?? 'NC',
    neighborhood: firstOf(readUnmasked(rf, 'bairro'), text(establishment?.['bairro'])) ?? 'NC',
    city: firstOf(readUnmasked(rf, 'municipio'), text(publica?.estabelecimento?.cidade?.nome)),
    state: firstOf(readUnmasked(rf, 'uf'), text(publica?.estabelecimento?.estado?.sigla)),
    country: 'BRA',
  };
}

/**
 * Payload de `orderForm.customData.custom_cnpj_data`.
 *
 * O formato de cada valor e o mesmo que o ERP ja recebe hoje (data em
 * `dd/mm/yyyy`, booleano como `0`/`1`) — o que muda e a **origem** e a
 * **consistencia** deles.
 */
function buildErpCustomData(company: CnpjCompany): CnpjErpCustomData {
  return {
    DS_EMAIL_NFD: company.email,
    ID_INS_ESTADUAL_SBT_TRB: null,
    ID_OPTANTE_SIMPLES: company.simplesNacional === null ? null : company.simplesNacional ? 1 : 0,
    DT_FUNDACAO: toBrazilianDate(company.foundedAt),
    // Empresa sem inscricao estadual e "Isento" — resposta legitima do plugin
    // ST, nao ausencia de dado. Por isso o campo nunca fica nulo.
    ID_INSCRICAO_ESTADUAL: company.stateInscription ?? 'Isento',
    CD_CNA: company.mainActivityCode,
    ID_CONTRIBUINTE_ICMS: null,
    ID_CALCULA_ICR: 0,
    NATUREZA_JURIDICA: company.legalNature,
    ID_MICRO_EMPRESA: company.size === null ? null : company.size === 'ME' ? 1 : 0,
    ID_MEI: company.mei === null ? null : company.mei ? 1 : 0,
  };
}

const REASON_MESSAGES: Record<CnpjVerificationReason, string> = {
  SOURCES_UNAVAILABLE:
    'Não conseguimos consultar os dados deste CNPJ agora. Tente novamente em alguns minutos.',
  REGISTRATION_INACTIVE:
    'A situação cadastral do CNPJ informado consta como irregular na Receita Federal. Informe um CNPJ com situação regular.',
  MISSING_POSTAL_CODE:
    'Não encontramos o CEP registrado para esta empresa. Atualize os dados na Junta Comercial.',
  INCOMPLETE_FISCAL_DATA:
    'Não conseguimos recuperar todos os dados fiscais desta empresa. Tente novamente em alguns minutos.',
};

/**
 * Consolida as fontes e decide se o CNPJ pode seguir na compra.
 *
 * A ordem das reprovacoes segue a do fluxo antigo (fonte -> situacao ->
 * dados fiscais -> CEP), para nao mudar a mensagem que o cliente ja conhece
 * em cada caso.
 */
export function verifyCnpj(options: {
  cnpj: string;
  sources: CnpjSources;
  fallbackEmail?: string | undefined;
}): CnpjVerification {
  const { cnpj, sources } = options;
  const fallbackEmail = options.fallbackEmail ?? null;

  const hasAnySource =
    sources.rf !== null || sources.sn !== null || sources.st !== null || sources.publica !== null;

  const company = buildCompany(sources, cnpj, fallbackEmail);
  const address = buildAddress(sources);
  const erpCustomData = buildErpCustomData(company);

  const missingFiscalFields = REQUIRED_FISCAL_FIELDS.filter(
    (field) => erpCustomData[field] === null,
  );

  const reason: CnpjVerificationReason | null = !hasAnySource
    ? 'SOURCES_UNAVAILABLE'
    : company.registrationStatus !== 'ativa'
      ? 'REGISTRATION_INACTIVE'
      : missingFiscalFields.length > 0
        ? 'INCOMPLETE_FISCAL_DATA'
        : address.postalCode === null
          ? 'MISSING_POSTAL_CODE'
          : null;

  return {
    approved: reason === null,
    reason,
    message: reason === null ? null : REASON_MESSAGES[reason],
    missingFiscalFields,
    company,
    address,
    erpCustomData,
  };
}

/**
 * Validacao de CNPJ pelos digitos verificadores.
 *
 * Existe para nao gastar cota paga com erro de digitacao: no fluxo antigo,
 * qualquer string ia para as tres consultas da SintegraWS.
 */
export function isValidCnpj(value: string): boolean {
  const cnpj = value.replace(/\D/g, '');
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const checkDigit = (length: number): number => {
    let weight = length - 7;
    let sum = 0;

    for (let index = 0; index < length; index += 1) {
      sum += Number(cnpj[index]) * weight;
      weight -= 1;
      if (weight < 2) weight = 9;
    }

    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  return checkDigit(12) === Number(cnpj[12]) && checkDigit(13) === Number(cnpj[13]);
}
