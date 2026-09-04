import { randomInt } from 'node:crypto';

/** Alfabeto do `relationName` — igual ao do app original (nanoid). */
const RELATION_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-abcdefghijklmnopqrstuvwxz';
const DIGITS = '0123456789';

/** Sorteio uniforme com `crypto.randomInt` (sem modulo bias). */
function randomFrom(alphabet: string, size: number): string {
  let out = '';
  for (let i = 0; i < size; i += 1) {
    out += alphabet.charAt(randomInt(alphabet.length));
  }
  return out;
}

export interface GiftCardCodes {
  relationName: string;
  customCode: string;
}

/**
 * Gera o par (relationName, customCode) de um gift card.
 * Formato preservado do app original: `searaGCservice-<prefix>-<10 chars>`
 * e `<prefix>-<4 digitos>-<4 digitos>`.
 */
export function generateGiftCardCodes(prefix: string): GiftCardCodes {
  return {
    relationName: `searaGCservice-${prefix}-${randomFrom(RELATION_ALPHABET, 10)}`,
    customCode: `${prefix}-${randomFrom(DIGITS, 4)}-${randomFrom(DIGITS, 4)}`,
  };
}
