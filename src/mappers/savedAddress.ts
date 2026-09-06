import type { MasterDataDocument } from '../services/vtex/masterdata.js';

/**
 * Endereco salvo do cliente (entidade AD) -> endereco do `shippingData`.
 *
 * Os dois formatos sao parecidos mas nao iguais: a AD guarda campos de
 * cadastro (`addressName`, `userId`, `createdIn`) que o orderForm nao aceita,
 * e o orderForm exige `country` e `addressType` que a AD nem sempre tem.
 * Mandar o documento da AD cru para o attachment faz a VTEX recusar ou ignorar
 * campos em silencio.
 */
export interface ShippingAddress {
  addressType: string;
  country: string;
  postalCode: string;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  receiverName: string | null;
  /** Referencia do endereco na VTEX. Mantido para o orderForm reconhecer o cadastro. */
  addressId: string | null;
  geoCoordinates: readonly number[];
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** `receiverName` cai no nome do comprador quando o endereco nao tem o seu. */
function receiverFrom(address: MasterDataDocument, fallback: string | null): string | null {
  return text(address['receiverName']) ?? fallback;
}

/**
 * Converte um documento da AD no formato aceito por
 * `shippingData.selectedAddresses`.
 *
 * `geoCoordinates` vai como array vazio quando o cadastro nao tem: a VTEX
 * aceita vazio, mas nao aceita `null`.
 */
export function toShippingAddress(
  address: MasterDataDocument,
  options?: { receiverName?: string | null },
): ShippingAddress {
  const digits = (value: unknown): string | null => {
    const parsed = text(value);
    return parsed === null ? null : parsed.replace(/\D/g, '') || null;
  };

  const coordinates = address['geoCoordinates'];

  return {
    // A AD costuma trazer `residential`; sem valor, o mesmo default do front.
    addressType: text(address['addressType']) ?? 'residential',
    country: text(address['country']) ?? 'BRA',
    postalCode: digits(address['postalCode']) ?? '',
    city: text(address['city']),
    state: text(address['state']),
    neighborhood: text(address['neighborhood']),
    street: text(address['street']),
    number: text(address['number']),
    complement: text(address['complement']),
    receiverName: receiverFrom(address, options?.receiverName ?? null),
    addressId: text(address['id']),
    geoCoordinates: Array.isArray(coordinates) ? (coordinates as readonly number[]) : [],
  };
}
