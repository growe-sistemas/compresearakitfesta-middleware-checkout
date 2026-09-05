import type { MasterDataDocument } from '../services/vtex/masterdata.js';

/** Deixa so digitos — CEP e numero sao comparados normalizados. */
function digits(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^0-9]/g, '') : '';
}

/**
 * Posicao (1-based) do endereco que casa com CEP + numero informados no
 * checkout. Nao achando, devolve o proximo indice livre — mesmo comportamento de
 * `middlewares/getAddressPosition.ts`.
 *
 * A lista de enderecos ja vem ordenada por `createdIn ASC` do Master Data.
 */
export function findAddressPosition(
  addresses: readonly MasterDataDocument[] | null | undefined,
  zipCodeCheckout: string,
  numberCheckout: string,
): number {
  if (addresses === null || addresses === undefined) return 1;

  const targetZip = digits(zipCodeCheckout);
  const targetNumber = digits(numberCheckout);

  const matchIndex = addresses.findIndex(
    (address) =>
      digits(address['postalCode']) === targetZip && digits(address['number']) === targetNumber,
  );

  return matchIndex >= 0 ? matchIndex + 1 : addresses.length + 1;
}
