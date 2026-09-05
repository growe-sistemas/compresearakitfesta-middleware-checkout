/**
 * Manifesto das rotas sob `/middleware/checkout/*`: path, verbo e visibilidade
 * em um lugar so, longe do handler.
 *
 * Os nomes das rotas vem do app VTEX IO que este servico substitui
 * (`kitfesta-seara/node`) e continuam iguais **de proposito**: enquanto o
 * `checkout-ui` em producao chamar estes paths, renomear um quebra a loja. O
 * prefixo, esse sim, mudou — `/_v1/private/middleware/` virou
 * `/middleware/checkout/`.
 *
 * Alguns nomes tem defeito conhecido (`getAddresState` e `getDataRamdom` com
 * typo, `getInfo`/`setInfo` que nao dizem o que fazem). A padronizacao deles
 * exige migrar o consumidor antes — ver `docs/05-plano-de-migracao.md`.
 *
 * `ALL` marca rota que aceita qualquer verbo. Tambem e comportamento que o
 * front ja depende, nao desleixo.
 */

export type CheckoutRouteMethod = 'GET' | 'POST' | 'ALL';

export interface CheckoutRoute {
  /** Identificador da rota. E a chave do mapa de handlers. */
  readonly name: string;
  /** Path completo, como o front chama. */
  readonly path: string;
  /** Verbos aceitos. `ALL` = qualquer verbo cai no handler. */
  readonly methods: readonly CheckoutRouteMethod[];
  /**
   * De qual arquivo do app VTEX IO a logica veio, na ordem em que rodava.
   * Rastreabilidade para auditar comportamento — nao e dependencia.
   */
  readonly origin: readonly string[];
  /**
   * `true` = sem autenticacao. `false` = exige `x-api-key`, e so vale para
   * rota que o navegador NAO chama: chave em bundle de front nao e segredo.
   */
  readonly isPublic: boolean;
  /** Observacao relevante para quem for mexer na rota. */
  readonly note?: string;
}

export const CHECKOUT_ROUTES = [
  {
    name: 'makeClusterAlive',
    path: '/middleware/checkout/make-cluster-alive',
    isPublic: true,
    methods: ['ALL'],
    origin: ['middlewares/makeClusterAlive.ts'],
    note: 'Keep-alive do cluster VTEX IO. Provavelmente nao faz sentido no Render (nao ha cold start de worker do mesmo tipo).',
  },
  {
    name: 'getAddressPosition',
    path: '/middleware/checkout/getAddressPosition/',
    isPublic: true,
    methods: ['ALL'],
    origin: ['middlewares/getAddressPosition.ts'],
    note: 'Le userId/email/zipCodeCheckout/numberCheckout do CORPO, apesar de aceitar qualquer verbo.',
  },
  {
    name: 'getAddresState',
    path: '/middleware/checkout/getAddresState/',
    isPublic: true,
    methods: ['ALL'],
    origin: ['middlewares/getAddresState.ts'],
    note: 'Typo no nome original ("Addres"). Le userId do CORPO apesar de aceitar qualquer verbo.',
  },
  {
    name: 'getDataSintegraRF',
    path: '/middleware/checkout/getDataSintegraRF/:cnpj',
    isPublic: true,
    methods: ['ALL'],
    origin: ['middlewares/getDataSintegraRF.ts'],
    note: 'Client sintegra.ts com memoryCache (LRU 5000) no app original.',
  },
  {
    name: 'getDataSintegraSN',
    path: '/middleware/checkout/getDataSintegraSN/:cnpj',
    isPublic: true,
    methods: ['ALL'],
    origin: ['middlewares/getDataSintegraSN.ts'],
    note: 'Client sintegra.ts com memoryCache no app original.',
  },
  {
    name: 'getDataSintegraST',
    path: '/middleware/checkout/getDataSintegraST/:cnpj',
    isPublic: true,
    methods: ['ALL'],
    origin: ['middlewares/getDataSintegraST.ts'],
    note: 'Client sintegra.ts com memoryCache no app original.',
  },
  {
    name: 'getDataSintegraCPF',
    path: '/middleware/checkout/getDataSintegraCPF/:cpf/:date',
    isPublic: true,
    methods: ['ALL'],
    origin: ['middlewares/getDataSintegraCPF.ts'],
    note: 'CPF e data de nascimento vao na URL — dado pessoal em path. Rever ao migrar.',
  },
  {
    name: 'getEmployee',
    path: '/middleware/checkout/getEmployee/:cpf',
    isPublic: true,
    methods: ['ALL'],
    origin: ['middlewares/getEmployee.ts'],
    note: 'Existe tambem middlewares/backup-employe.ts no app original.',
  },
  {
    name: 'getDataRamdom',
    path: '/middleware/checkout/getDataRamdom/',
    isPublic: true,
    methods: ['ALL'],
    origin: ['middlewares/getDataRamdom.ts'],
    note: 'Typo no nome original ("Ramdom"). Candidato a renomear.',
  },
  {
    name: 'getBirthDateCL',
    path: '/middleware/checkout/getInfo/:email',
    isPublic: true,
    methods: ['ALL'],
    origin: ['middlewares/getBirthDateCL.ts'],
    note: 'Nome da rota e path divergem (getBirthDateCL vs /getInfo).',
  },
  {
    name: 'setBirthDateCL',
    path: '/middleware/checkout/setInfo/:email/:birthDate',
    isPublic: true,
    methods: ['ALL'],
    origin: ['middlewares/setBirthDateCL.ts'],
    note: 'Escrita via path param e sem metodo declarado — um GET altera dado. Rever ao migrar.',
  },
  {
    name: 'updateDataMD',
    path: '/middleware/checkout/md/update',
    isPublic: true,
    methods: ['POST'],
    origin: ['middlewares/updateDataMD.ts'],
  },
  {
    name: 'createGiftCard',
    path: '/middleware/checkout/createGiftCard/',
    isPublic: false,
    methods: ['POST'],
    origin: [
      'middlewares/generateUniqueGiftCardInfos.ts',
      'middlewares/createGiftCard.ts',
      'middlewares/addGiftCardBalance.ts',
    ],
    note: 'Unica rota com policy no service.json (so b2csearakitfesta.store-theme) e a unica chamada de tela de admin (react/GiftCardAdmin.tsx), nao do checkout. Por isso continua exigindo x-api-key: emite gift card com valor arbitrario.',
  },
  {
    name: 'getGiftCardInfoFromMD',
    path: '/middleware/checkout/getGiftCardInfoFromMD/',
    isPublic: true,
    methods: ['ALL'],
    origin: ['middlewares/getGiftInfoFromMD.ts'],
    note: 'Arquivo do handler chama-se getGiftInfoFromMD.ts (sem "Card").',
  },
  {
    name: 'getDataInMasterData',
    path: '/middleware/checkout/getDataInMasterData',
    isPublic: true,
    methods: ['POST'],
    origin: ['middlewares/getDataInMasterData.ts'],
  },
  {
    name: 'sitemap',
    path: '/middleware/checkout/sitemap/:type?',
    isPublic: true,
    methods: ['GET'],
    origin: ['middlewares/sitemap.ts'],
    note: 'Param opcional. Existe tambem middlewares/sitemap-backup.ts no app original.',
  },
] as const satisfies readonly CheckoutRoute[];

export type CheckoutRouteName = (typeof CHECKOUT_ROUTES)[number]['name'];
