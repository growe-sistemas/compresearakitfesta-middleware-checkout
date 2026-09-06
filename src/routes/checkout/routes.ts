import type { RequestHandler } from 'express';
import { discardCorporateData, setCorporateData } from './corporateData.js';
import {
  setBirthDateCustomData,
  setCnpjCustomData,
  setDeliveryDateCustomData,
  setErpAddressIdCustomData,
} from './customData.js';
import { getEmployee } from './employee.js';
import { getDataInMasterData, updateDataMD } from './genericMasterData.js';
import {
  getAddresState,
  getAddressPosition,
  getBirthDateCL,
  setBirthDateCL,
  setBirthDateCLFromBody,
} from './masterdata.js';
import { makeClusterAlive } from './misc.js';
import {
  getDataSintegraCPF,
  getDataSintegraRF,
  getDataSintegraSN,
  getDataSintegraST,
} from './sintegra.js';

/**
 * Tabela de rotas do middleware. **Uma rota, uma entrada, um lugar.**
 *
 * Antes, declarar uma rota exigia tres lugares — o manifesto (path, verbo,
 * visibilidade), um mapa `name -> handler`, e o import — e as rotas novas nem
 * passavam por ai: eram registradas na mao no fim do `index.ts`. Duas
 * convencoes concorrentes para a mesma coisa.
 *
 * Agora tudo que define uma rota esta na entrada dela, inclusive o handler.
 * O `index.ts` so percorre esta lista.
 *
 * Para adicionar uma rota: importe o handler e acrescente uma entrada. Nao ha
 * segundo passo.
 */
export type HttpVerb = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'ALL';

export interface CheckoutRoute {
  /** Path completo, como o consumidor chama. */
  readonly path: string;
  /**
   * Verbos aceitos. `ALL` responde a qualquer um — nao e desleixo, e
   * comportamento herdado do app VTEX IO de que o `checkout-ui` ja depende.
   */
  readonly methods: readonly HttpVerb[];
  readonly handler: RequestHandler;
  /**
   * `public` = sem autenticacao. `apiKey` = exige `x-api-key`, e so vale para
   * rota que o navegador NAO chama: chave em bundle de front nao e segredo.
   *
   * Declarado em toda rota de proposito. Antes, as rotas registradas fora do
   * manifesto herdavam "publica" por omissao — dava no mesmo, mas ninguem
   * lendo o codigo sabia se aquilo tinha sido decidido ou esquecido.
   */
  readonly auth: 'public' | 'apiKey';
  /** Uma linha sobre o que a rota faz. Aparece em `docs/` e no README. */
  readonly summary: string;
  /** Preenchido = rota a caminho da remocao. O texto diz o que usar no lugar. */
  readonly deprecated?: string;
}

/**
 * Anotada, nao `as const`: com literais, `auth` viraria o tipo exato de cada
 * entrada e `deprecated` sumiria das que nao declaram — o consumidor teria de
 * fazer cast para percorrer a lista. Era essa a ginastica do manifesto antigo.
 */
export const CHECKOUT_ROUTES: readonly CheckoutRoute[] = [
  // -------------------------------------------------------------------------
  // Rotas novas — contrato consistente, dado pessoal fora da URL, verbo que
  // declara o que a chamada faz.
  // -------------------------------------------------------------------------
  {
    path: '/middleware/checkout/corporate-data',
    methods: ['POST'],
    handler: setCorporateData,
    auth: 'public',
    summary: 'Consulta o CNPJ e popula o orderForm: perfil corporativo, endereco da Junta Comercial e payload fiscal.',
  },
  {
    path: '/middleware/checkout/corporate-data',
    methods: ['DELETE'],
    handler: discardCorporateData,
    auth: 'public',
    summary: 'Desfaz o perfil corporativo: devolve o orderForm para pessoa fisica.',
  },
  {
    path: '/middleware/checkout/custom-data/birth-date',
    methods: ['POST'],
    handler: setBirthDateCustomData,
    auth: 'public',
    summary: 'Grava a data de nascimento em customData.custom_birth_date e confere a gravacao.',
  },
  {
    path: '/middleware/checkout/custom-data/cnpj',
    methods: ['POST'],
    handler: setCnpjCustomData,
    auth: 'public',
    summary: 'Consulta o CNPJ e grava SO customData.custom_cnpj_data, sem tocar em shippingData nem no perfil.',
  },
  {
    path: '/middleware/checkout/custom-data/delivery-date',
    methods: ['POST'],
    handler: setDeliveryDateCustomData,
    auth: 'public',
    summary: 'Grava a data de entrega escolhida em customData.custom_delivery_date e confere a gravacao.',
  },
  {
    path: '/middleware/checkout/custom-data/erp-address-id',
    methods: ['POST'],
    handler: setErpAddressIdCustomData,
    auth: 'public',
    summary: 'Descobre a posicao do endereco de entrega na lista do cliente e grava em customData.current_address_id.',
  },
  {
    path: '/middleware/checkout/setInfo',
    methods: ['POST', 'PUT'],
    handler: setBirthDateCLFromBody,
    auth: 'public',
    summary: 'Grava a data de nascimento na entidade CL, lendo { email, birthDate } do corpo.',
  },

  // -------------------------------------------------------------------------
  // Rotas herdadas do app VTEX IO (`kitfesta-seara/node`).
  //
  // Os nomes continuam iguais de proposito: enquanto o `checkout-ui` em
  // producao chamar estes paths, renomear um quebra a loja. A padronizacao
  // deles exige migrar o consumidor antes — ver `docs/05-plano-de-migracao.md`.
  // -------------------------------------------------------------------------
  {
    path: '/middleware/checkout/getAddresState/',
    methods: ['ALL'],
    handler: getAddresState,
    auth: 'public',
    summary: 'Enderecos do cliente (entidade AD), com userIdCL anexado. Le userId do CORPO.',
  },
  {
    path: '/middleware/checkout/getAddressPosition/',
    methods: ['ALL'],
    handler: getAddressPosition,
    auth: 'public',
    summary: 'Posicao 1-based do endereco do checkout na lista do cliente. Le do CORPO.',
  },
  {
    path: '/middleware/checkout/getInfo/:email',
    methods: ['ALL'],
    handler: getBirthDateCL,
    auth: 'public',
    summary: 'Data de nascimento gravada na entidade CL.',
  },
  {
    path: '/middleware/checkout/setInfo/:email/:birthDate',
    methods: ['ALL'],
    handler: setBirthDateCL,
    auth: 'public',
    summary: 'Grava a data de nascimento na entidade CL via parametros de URL.',
    deprecated:
      'Dado pessoal em path e um GET que escreve. Use POST|PUT /middleware/checkout/setInfo.',
  },
  {
    path: '/middleware/checkout/getDataInMasterData',
    methods: ['POST'],
    handler: getDataInMasterData,
    auth: 'public',
    summary: 'Proxy de leitura do Master Data: entidade, condicao e campos vem do corpo.',
  },
  {
    path: '/middleware/checkout/md/update',
    methods: ['POST'],
    handler: updateDataMD,
    auth: 'public',
    summary: 'Proxy de escrita do Master Data: entidade, condicao e payload vem do corpo.',
  },
  {
    path: '/middleware/checkout/getDataSintegraRF/:cnpj',
    methods: ['ALL'],
    handler: getDataSintegraRF,
    auth: 'public',
    summary: 'CNPJ na Receita Federal, resposta crua da SintegraWS.',
  },
  {
    path: '/middleware/checkout/getDataSintegraSN/:cnpj',
    methods: ['ALL'],
    handler: getDataSintegraSN,
    auth: 'public',
    summary: 'CNPJ no Simples Nacional, resposta crua da SintegraWS.',
  },
  {
    path: '/middleware/checkout/getDataSintegraST/:cnpj',
    methods: ['ALL'],
    handler: getDataSintegraST,
    auth: 'public',
    summary: 'Chama o plugin RF, nao o ST — bug herdado, preservado para nao mudar a resposta.',
  },
  {
    path: '/middleware/checkout/getDataSintegraCPF/:cpf/:date',
    methods: ['ALL'],
    handler: getDataSintegraCPF,
    auth: 'public',
    summary: 'CPF na SintegraWS. CPF e data de nascimento vao na URL.',
    deprecated: 'Dado pessoal em path de URL. Deve virar POST com corpo.',
  },
  {
    path: '/middleware/checkout/getEmployee/:cpf',
    methods: ['ALL'],
    handler: getEmployee,
    auth: 'public',
    summary: 'B2E: dados do colaborador Seara pelo CPF.',
    deprecated: 'CPF em path de URL. Deve virar POST com corpo.',
  },
  {
    path: '/middleware/checkout/make-cluster-alive',
    methods: ['ALL'],
    handler: makeClusterAlive,
    auth: 'public',
    summary: 'Keep-alive herdado do VTEX IO.',
    deprecated: 'Nao existe cold start de worker no Render. Use GET /health.',
  },
];
