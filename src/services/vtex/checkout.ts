import { z } from 'zod';
import { vtexRequest } from './client.js';

/**
 * Checkout API — `customData` do orderForm.
 *
 * Os campos de `customData` sao o contrato com o ERP: e por eles que dado que
 * nao cabe no orderForm nativo (data de nascimento, dados fiscais da PJ,
 * posicao do endereco, data de agendamento) chega ao pedido.
 *
 * Ate agora TODA escrita saia do navegador, com a sessao do proprio comprador
 * (`checkout-ui/.../orderForm.js:155`). Este modulo passa a permitir a escrita
 * pelo servidor, com as credenciais de aplicacao.
 *
 * Duas consequencias de conhecer:
 *
 * 1. O `orderFormId` e a credencial da operacao — quem o tem, escreve. Vale o
 *    mesmo modelo de exposicao de antes (o navegador tambem so precisava
 *    dele), mas agora a escrita usa a AppKey do middleware, nao a sessao do
 *    cliente.
 * 2. O par app/field precisa estar declarado na configuracao de customData do
 *    checkout. Nao estando, a VTEX recusa — o campo nao e criado sozinho.
 */

/**
 * Os campos de `customData` usados pela loja, em UM lugar so.
 *
 * No `checkout-ui` estes nomes so existem como string literal solta em tres
 * arquivos diferentes: um typo criaria um campo novo em silencio e o pedido
 * chegaria ao ERP sem o dado. Aqui eles sao constantes.
 *
 * Em todos, o id do app e o nome do campo sao iguais — e assim que a loja
 * declarou.
 */
export const CUSTOM_DATA_FIELDS = {
  birthDate: { app: 'custom_birth_date', field: 'custom_birth_date' },
  cnpjData: { app: 'custom_cnpj_data', field: 'custom_cnpj_data' },
  addressId: { app: 'current_address_id', field: 'current_address_id' },
  deliveryDate: { app: 'custom_delivery_date', field: 'custom_delivery_date' },
} as const;

export type CustomDataFieldKey = keyof typeof CUSTOM_DATA_FIELDS;

/**
 * `orderFormId` valido. Ele entra no PATH da URL, entao a validacao aqui e
 * barreira contra path traversal — nao so higiene de entrada.
 */
export const orderFormIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9]{16,64}$/, 'orderFormId invalido');

/**
 * A VTEX devolve o orderForm atualizado neste endpoint. O schema e frouxo de
 * proposito: so precisamos do `orderFormId` e dos `customApps` para conferir a
 * gravacao, e um campo novo do orderForm nao pode derrubar a rota.
 */
const orderFormSchema = z
  .object({
    orderFormId: z.string().optional(),
    /** Perfil ja preenchido no passo de dados. Base do merge no fluxo PJ. */
    clientProfileData: z.record(z.unknown()).nullable().optional(),
    customData: z
      .object({
        customApps: z
          .array(
            z
              .object({
                id: z.string().optional(),
                fields: z.record(z.unknown()).optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough()
  // 204 sem corpo tambem e resposta valida: nesse caso nao da para conferir.
  .nullable();

export type OrderFormResponse = z.infer<typeof orderFormSchema>;

export interface CustomDataWriteResult {
  /** Valor lido de volta da resposta da VTEX. `null` = nao deu para conferir. */
  storedValue: string | null;
  /** `true` quando o valor lido bate com o enviado. */
  confirmed: boolean;
  orderFormId: string | null;
}

/** Le `customData.customApps[id=app].fields[field]` da resposta. */
function readCustomField(
  orderForm: OrderFormResponse,
  app: string,
  field: string,
): string | null {
  const apps = orderForm?.customData?.customApps ?? [];
  const found = apps.find((customApp) => customApp.id === app);
  const value = found?.fields?.[field];
  return typeof value === 'string' ? value : null;
}

/**
 * `PUT /api/checkout/pub/orderForm/{id}/customData/{app}/{field}`.
 *
 * O valor vai sempre como STRING — campo de customData na VTEX e texto. Quem
 * precisa gravar objeto serializa antes (e o caso do `custom_cnpj_data`).
 *
 * A gravacao ja e conferida na propria resposta, sem requisicao extra: a VTEX
 * devolve o orderForm atualizado. O `checkout-ui` fazia isso relendo o
 * orderForm depois (`_sendBirthDateCustomData`, `controller.js:1284`).
 */
export async function putCustomData(options: {
  orderFormId: string;
  app: string;
  field: string;
  value: string;
}): Promise<CustomDataWriteResult> {
  const { orderFormId, app, field, value } = options;

  const orderForm = await vtexRequest({
    path: `/api/checkout/pub/orderForm/${orderFormId}/customData/${app}/${field}`,
    method: 'PUT',
    body: { value },
    schema: orderFormSchema,
  });

  const storedValue = readCustomField(orderForm, app, field);

  return {
    storedValue,
    // Sem corpo na resposta nao ha o que conferir; nesse caso o 2xx da VTEX e
    // a unica confirmacao, e `confirmed` fica falso de proposito.
    confirmed: storedValue === value,
    orderFormId: orderForm?.orderFormId ?? null,
  };
}

/** `DELETE` do mesmo recurso. Sem corpo — ao contrario do `checkout-ui`, que manda `{"value":"null"}`. */
export async function deleteCustomData(options: {
  orderFormId: string;
  app: string;
  field: string;
}): Promise<{ orderFormId: string | null }> {
  const { orderFormId, app, field } = options;

  const orderForm = await vtexRequest({
    path: `/api/checkout/pub/orderForm/${orderFormId}/customData/${app}/${field}`,
    method: 'DELETE',
    schema: orderFormSchema,
  });

  return { orderFormId: orderForm?.orderFormId ?? null };
}

/** `GET /api/checkout/pub/orderForm/{id}` — le o orderForm atual. */
export async function getOrderForm(orderFormId: string): Promise<OrderFormResponse> {
  return vtexRequest({
    path: `/api/checkout/pub/orderForm/${orderFormId}`,
    schema: orderFormSchema,
  });
}

/**
 * `POST /api/checkout/pub/orderForm/{id}/attachments/{attachmentId}`.
 *
 * Mesma operacao do `vtexjs.checkout.sendAttachment` do front, do lado do
 * servidor. Usada para `clientProfileData` e `shippingData`.
 */
export async function sendAttachment(options: {
  orderFormId: string;
  attachmentId: string;
  payload: Record<string, unknown>;
}): Promise<OrderFormResponse> {
  const { orderFormId, attachmentId, payload } = options;

  return vtexRequest({
    path: `/api/checkout/pub/orderForm/${orderFormId}/attachments/${attachmentId}`,
    method: 'POST',
    body: payload,
    schema: orderFormSchema,
  });
}

/**
 * Zera o endereco do orderForm.
 *
 * No fluxo PJ isso vem ANTES de gravar o endereco da empresa: sem limpar, o
 * endereco anterior (do PF) pode sobreviver em `availableAddresses` e voltar a
 * ser escolhido no calculo de frete. O `checkout-ui` faz o mesmo
 * (`clearShippingData`, `orderForm.js:52`).
 */
export async function clearShippingData(orderFormId: string): Promise<OrderFormResponse> {
  return sendAttachment({
    orderFormId,
    attachmentId: 'shippingData',
    payload: { address: null, availableAddresses: null, logisticsInfo: null },
  });
}
