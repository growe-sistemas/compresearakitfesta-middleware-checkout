/**
 * Inventario das rotas declaradas no app VTEX IO
 * `C:\Growe\stores\kitfesta-seara\node\service.json`.
 *
 * Copia fiel: path exatamente como esta no service.json, metodo conforme o
 * `index.ts` do app. Onde o app NAO envolveu o handler em `method({...})`,
 * a rota aceita qualquer verbo no VTEX IO — aqui isso vira `ALL` em vez de
 * chutar GET.
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
  /** Observacao relevante para quando formos reescrever a rota. */
  readonly note?: string;
}

export const LEGACY_ROUTES = [
  {
    name: 'makeClusterAlive',
    path: '/_v1/make-cluster-alive',
    methods: ['ALL'],
    handlers: ['middlewares/makeClusterAlive.ts'],
    note: 'Keep-alive do cluster VTEX IO. Provavelmente nao faz sentido no Render (nao ha cold start de worker do mesmo tipo).',
  },
  {
    name: 'getAddressPosition',
    path: '/_v1/private/middleware/getAddressPosition/',
    methods: ['ALL'],
    handlers: ['middlewares/getAddressPosition.ts'],
    note: 'Le userId/email/zipCodeCheckout/numberCheckout do CORPO, apesar de aceitar qualquer verbo.',
  },
  {
    name: 'getAddresState',
    path: '/_v1/private/middleware/getAddresState/',
    methods: ['ALL'],
    handlers: ['middlewares/getAddresState.ts'],
    note: 'Typo no nome original ("Addres"). Le userId do CORPO apesar de aceitar qualquer verbo.',
  },
  {
    name: 'getDataSintegraRF',
    path: '/_v1/private/middleware/getDataSintegraRF/:cnpj',
    methods: ['ALL'],
    handlers: ['middlewares/getDataSintegraRF.ts'],
    note: 'Client sintegra.ts com memoryCache (LRU 5000) no app original.',
  },
  {
    name: 'getDataSintegraSN',
    path: '/_v1/private/middleware/getDataSintegraSN/:cnpj',
    methods: ['ALL'],
    handlers: ['middlewares/getDataSintegraSN.ts'],
    note: 'Client sintegra.ts com memoryCache no app original.',
  },
  {
    name: 'getDataSintegraST',
    path: '/_v1/private/middleware/getDataSintegraST/:cnpj',
    methods: ['ALL'],
    handlers: ['middlewares/getDataSintegraST.ts'],
    note: 'Client sintegra.ts com memoryCache no app original.',
  },
  {
    name: 'getDataSintegraCPF',
    path: '/_v1/private/middleware/getDataSintegraCPF/:cpf/:date',
    methods: ['ALL'],
    handlers: ['middlewares/getDataSintegraCPF.ts'],
    note: 'CPF e data de nascimento vao na URL — dado pessoal em path. Rever ao migrar.',
  },
  {
    name: 'getEmployee',
    path: '/_v1/private/middleware/getEmployee/:cpf',
    methods: ['ALL'],
    handlers: ['middlewares/getEmployee.ts'],
    note: 'Existe tambem middlewares/backup-employe.ts no app original.',
  },
  {
    name: 'getDataRamdom',
    path: '/_v1/private/middleware/getDataRamdom/',
    methods: ['ALL'],
    handlers: ['middlewares/getDataRamdom.ts'],
    note: 'Typo no nome original ("Ramdom"). Candidato a renomear.',
  },
  {
    name: 'getBirthDateCL',
    path: '/_v1/private/middleware/getInfo/:email',
    methods: ['ALL'],
    handlers: ['middlewares/getBirthDateCL.ts'],
    note: 'Nome da rota e path divergem (getBirthDateCL vs /getInfo).',
  },
  {
    name: 'setBirthDateCL',
    path: '/_v1/private/middleware/setInfo/:email/:birthDate',
    methods: ['ALL'],
    handlers: ['middlewares/setBirthDateCL.ts'],
    note: 'Escrita via path param e sem metodo declarado — um GET altera dado. Rever ao migrar.',
  },
  {
    name: 'updateDataMD',
    path: '/_v1/private/middleware/md/update',
    methods: ['POST'],
    handlers: ['middlewares/updateDataMD.ts'],
  },
  {
    name: 'createGiftCard',
    path: '/_v1/private/middleware/createGiftCard/',
    methods: ['POST'],
    handlers: [
      'middlewares/generateUniqueGiftCardInfos.ts',
      'middlewares/createGiftCard.ts',
      'middlewares/addGiftCardBalance.ts',
    ],
    note: 'Unica rota com policy no service.json: so b2csearakitfesta.store-theme (post/get). Cadeia de 3 handlers em sequencia.',
  },
  {
    name: 'getGiftCardInfoFromMD',
    path: '/_v1/private/middleware/getGiftCardInfoFromMD/',
    methods: ['ALL'],
    handlers: ['middlewares/getGiftInfoFromMD.ts'],
    note: 'Arquivo do handler chama-se getGiftInfoFromMD.ts (sem "Card").',
  },
  {
    name: 'getDataInMasterData',
    path: '/_v1/private/middleware/getDataInMasterData',
    methods: ['POST'],
    handlers: ['middlewares/getDataInMasterData.ts'],
  },
  {
    name: 'sitemap',
    path: '/_v/sitemap/:type?',
    methods: ['GET'],
    handlers: ['middlewares/sitemap.ts'],
    note: 'Param opcional. Existe tambem middlewares/sitemap-backup.ts no app original.',
  },
] as const satisfies readonly LegacyRoute[];

export type LegacyRouteName = (typeof LEGACY_ROUTES)[number]['name'];
