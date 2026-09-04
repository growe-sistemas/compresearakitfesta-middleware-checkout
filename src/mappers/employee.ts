import type { SearaEmployeeRow } from '../services/seara/client.js';

export interface EmployeeFound {
  found: true;
  message: string;
  data: {
    name: string;
    email: string;
    firstName: string;
    codInfluenciador: string;
  };
}

export interface EmployeeNotFound {
  found: false;
  message: string;
}

export type EmployeeResult = EmployeeFound | EmployeeNotFound;

/** "JOAO DA SILVA" -> "Joao Da Silva" (mesma regra do app original). */
export function toFullName(name: string): string {
  return name
    .toLowerCase()
    .split(' ')
    .map((word) => (word === '' ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

/** "JOAO DA SILVA" -> "Joao". */
export function toFirstName(name: string): string {
  const first = name.split(' ')[0]?.toLowerCase() ?? '';
  return first === '' ? '' : first.charAt(0).toUpperCase() + first.slice(1);
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

/**
 * Traduz a linha crua do XML da Seara para o contrato de saida.
 * `TRANSACTION_ERROR` presente = CPF nao encontrado, como no app original.
 */
export function mapEmployee(row: SearaEmployeeRow): EmployeeResult {
  if (row.TRANSACTION_ERROR !== undefined && row.TRANSACTION_ERROR !== '') {
    return { found: false, message: 'CPF não encontrado.' };
  }

  const name = asString(row.NOME);

  return {
    found: true,
    message: 'Dados do colaborador retornados.',
    data: {
      name: toFullName(name),
      email: asString(row.EMAIL),
      firstName: toFirstName(name),
      codInfluenciador: asString(row.CODIGO_INFLUENCIADOR),
    },
  };
}
