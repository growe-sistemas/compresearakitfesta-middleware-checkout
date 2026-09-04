/**
 * Inventario das rotas portadas do app VTEX IO
 * `C:\Growe\stores\kitfesta-seara\node\service.json`.
 *
 * PATHS RENOMEADOS: o prefixo `/_v1/private/middleware/` do VTEX IO virou
 * `/middleware/checkout/`. O nome de cada rota e o resto do path seguem
 * identicos, entao migrar o front e um find-and-replace do prefixo.
 * `/_v1/make-cluster-alive` e `/_v/sitemap` tambem foram para baixo do mesmo
 * prefixo.
 *
 * O metodo segue o `index.ts` do app: onde ele NAO envolveu o handler em
 * `method({...})`, a rota aceita qualquer verbo no VTEX IO — aqui isso vira
 * `ALL` em vez de chutar GET.
 *
 * A logica de cada rota foi portada dos handlers originais em
 * `node/middlewares/*.ts`. O campo `handlers` guarda a origem de cada uma.
 */

export type LegacyMethod = 'GET' | 'POST' | 'ALL';

export interface LegacyRoute {
  /** Chave da rota no service.json / index.ts. */
  readonly name: string;
  /** Path exatamente como declarado no service.json. */
  readonly path: string;
  /**
   * Verbos aceitos. `ALL` = o app original nao declarou `method({...})`,
   * entao qualquer verbo cai no handler.
   */
  readonly methods: readonly LegacyMethod[];
  /** Arquivo(s) de handler no app VTEX IO, na ordem em que rodam. */
  readonly handlers: readonly string[];
  /**
   * `true` = sem autenticacao, como o `public: true` do service.json.
   * `false` = exige `x-api-key`. So vale para rota que o navegador NAO chama:
   * chave em bundle de front nao e segredo.
   */
  readonly isPublic: boolean;
  /** Observacao relevante para quando formos reescrever a rota. */
  readonly note?: string;
}

export const LEGACY_ROUTES = [
  {
    name: 'makeClusterAlive',
    path: '/middleware/checkout/make-cluster-alive',
    isPublic: true,
    methods: ['ALL'],
    handlers: ['middlewares/makeClusterAlive.ts'],
    note: 'Keep-alive do cluster VTEX IO. Provavelmente nao faz sentido no Render (nao ha cold start de worker do mesmo tipo).',
  },
  {
    name: 'getAddressPosition',
    path: '/middleware/checkout/getAddressPosition/',
    isPublic: true,
    methods: ['ALL'],
    handlers: ['middlewares/getAddressPosition.ts'],
    note: 'Le userId/email/zipCodeCheckout/numberCheckout do CORPO, apesar de aceitar qualquer verbo.',
  },
  {
    name: 'getAddresState',
    path: '/middleware/checkout/getAddresState/',
    isPublic: true,
    methods: ['ALL'],
    handlers: ['middlewares/getAddresState.ts'],
    note: 'Typo no nome original ("Addres"). Le userId do CORPO apesar de aceitar qualquer verbo.',
  },
  {
    name: 'getDataSintegraRF',
    path: '/middleware/checkout/getDataSintegraRF/:cnpj',
    isPublic: true,
    methods: ['ALL'],
    handlers: ['middlewares/getDataSintegraRF.ts'],
    note: 'Client sintegra.ts com memoryCache (LRU 5000) no app original.',
  },
  {
    name: 'getDataSintegraSN',
    path: '/middleware/checkout/getDataSintegraSN/:cnpj',
    isPublic: true,
    methods: ['ALL'],
    handlers: ['middlewares/getDataSintegraSN.ts'],
    note: 'Client sintegra.ts com memoryCache no app original.',
  },
  {
    name: 'getDataSintegraST',
    path: '/middleware/checkout/getDataSintegraST/:cnpj',
    isPublic: true,
    methods: ['ALL'],
    handlers: ['middlewares/getDataSintegraST.ts'],
    note: 'Client sintegra.ts com memoryCache no app original.',
  },
  {
    name: 'getDataSintegraCPF',
    path: '/middleware/checkout/getDataSintegraCPF/:cpf/:date',
    isPublic: true,
    methods: ['ALL'],
    handlers: ['middlewares/getDataSintegraCPF.ts'],
    note: 'CPF e data de nascimento vao na URL — dado pessoal em path. Rever ao migrar.',
  },
  {
    name: 'getEmployee',
    path: '/middleware/checkout/getEmployee/:cpf',
    isPublic: true,
    methods: ['ALL'],
    handlers: ['middlewares/getEmployee.ts'],
    note: 'Existe tambem middlewares/backup-employe.ts no app original.',
  },
  {
    name: 'getDataRamdom',
    path: '/middleware/checkout/getDataRamdom/',
    isPublic: true,
    methods: ['ALL'],
    handlers: ['middlewares/getDataRamdom.ts'],
    note: 'Typo no nome original ("Ramdom"). Candidato a renomear.',
  },
  {
    name: 'getBirthDateCL',
    path: '/middleware/checkout/getInfo/:email',
    isPublic: true,
    methods: ['ALL'],
    handlers: ['middlewares/getBirthDateCL.ts'],
    note: 'Nome da rota e path divergem (getBirthDateCL vs /getInfo).',
  },
  {
    name: 'setBirthDateCL',
    path: '/middleware/checkout/setInfo/:email/:birthDate',
    isPublic: true,
    methods: ['ALL'],
    handlers: ['middlewares/setBirthDateCL.ts'],
    note: 'Escrita via path param e sem metodo declarado — um GET altera dado. Rever ao migrar.',
  },
  {
    name: 'updateDataMD',
    path: '/middleware/checkout/md/update',
    isPublic: true,
    methods: ['POST'],
    handlers: ['middlewares/updateDataMD.ts'],
  },
  {
    name: 'createGiftCard',
    path: '/middleware/checkout/createGiftCard/',
    isPublic: false,
    methods: ['POST'],
    handlers: [
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
    handlers: ['middlewares/getGiftInfoFromMD.ts'],
    note: 'Arquivo do handler chama-se getGiftInfoFromMD.ts (sem "Card").',
  },
  {
    name: 'getDataInMasterData',
    path: '/middleware/checkout/getDataInMasterData',
    isPublic: true,
    methods: ['POST'],
    handlers: ['middlewares/getDataInMasterData.ts'],
  },
  {
    name: 'sitemap',
    path: '/middleware/checkout/sitemap/:type?',
    isPublic: true,
    methods: ['GET'],
    handlers: ['middlewares/sitemap.ts'],
    note: 'Param opcional. Existe tambem middlewares/sitemap-backup.ts no app original.',
  },
] as const satisfies readonly LegacyRoute[];

export type LegacyRouteName = (typeof LEGACY_ROUTES)[number]['name'];
