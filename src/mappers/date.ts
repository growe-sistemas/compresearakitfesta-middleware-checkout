/**
 * Conversao de data — funcoes puras, um lugar so.
 *
 * Os formatos circulam misturados por aqui: o `checkout-ui` monta
 * `dd-MM-yyyy`, a SintegraWS devolve `dd/mm/yyyy`, o `customData` do orderForm
 * guarda `dd/mm/yyyy`, a entidade CL guarda ISO, e a API deste servico fala
 * ISO. Concentrar a conversao evita a quarta implementacao ligeiramente
 * diferente das outras tres.
 */

/** Fuso das datas de negocio da loja. */
export const STORE_TIME_ZONE = 'America/Sao_Paulo';

/** `YYYY-MM-DD` no calendario de Sao Paulo. `en-CA` ja formata assim. */
const SAO_PAULO_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: STORE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** A data existe no calendario? (`31-02-1995` nao existe.) */
function isRealDate(year: number, month: number, day: number): boolean {
  // `Date.UTC` normaliza excesso — 31/02 vira 03/03. Comparar de volta pega.
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Normaliza para `YYYY-MM-DD`, aceitando o que circula na loja:
 *
 * - `dd-MM-yyyy` — o que o `checkout-ui` monta
 * - `dd/MM/yyyy` — o que a SintegraWS devolve e o `customData` guarda
 * - `YYYY-MM-DD` — ISO, o formato da API deste servico
 * - `YYYY-MM-DDTHH:mm:ssZ` — data e hora, como o `deliveryWindow.endDateUtc`
 *
 * Nao ha ambiguidade entre os tres primeiros: o grupo de 4 digitos diz onde
 * esta o ano.
 *
 * Data que nao existe no calendario devolve `null`, e nao uma data deslocada.
 *
 * **Data e hora e convertida no fuso de Sao Paulo**, nao em UTC nem no fuso do
 * servidor. O `checkout-ui` faz `new Date(iso).getDate()`, que usa o fuso do
 * NAVEGADOR — entao uma janela de entrega em UTC vira o dia anterior no Brasil.
 * Aqui a regra e explicita: a data de entrega e uma data de negocio brasileira.
 */
export function parseFlexibleDate(value: string): string | null {
  const trimmed = value.trim();

  const dateTime = /^\d{4}-\d{2}-\d{2}T/.exec(trimmed);
  if (dateTime !== null) {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return SAO_PAULO_DATE.format(parsed);
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const brazilian = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(trimmed);

  const parts =
    iso !== null
      ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
      : brazilian !== null
        ? {
            year: Number(brazilian[3]),
            month: Number(brazilian[2]),
            day: Number(brazilian[1]),
          }
        : null;

  if (parts === null) return null;
  if (!isRealDate(parts.year, parts.month, parts.day)) return null;

  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

/** `YYYY-MM-DD` -> `dd/mm/yyyy`, o formato que o `customData` e o ERP guardam. */
export function toBrazilianDate(isoDate: string | null): string | null {
  if (isoDate === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return null;
  return `${match[3]}/${match[2]}/${match[1]}`;
}
