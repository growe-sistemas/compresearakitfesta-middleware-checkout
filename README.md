# compresearakitfesta-middleware-checkout

Middleware **de/para** entre a API da VTEX e consumidores externos: recebe
requisições em um contrato próprio, consulta a VTEX através de um cliente
compartilhado e devolve os dados normalizados.

- Node 20 LTS + TypeScript `strict`
- Express 4 + zod (validação de entrada **e** parse das respostas VTEX)
- pino (logs estruturados), helmet, cors
- Deploy no Render via Blueprint (`render.yaml`)

> **Status:** base pronta (config, clients, auth, erros, health, deploy) e as
> **16 rotas do app VTEX IO `kitfesta-seara/node` portadas com a lógica delas**.
> As rotas do orderForm ainda não existem — o de/para sai do payload real da
> requisição. Ver [Endpoints](#endpoints) e [Mapeamento](#mapeamento-depara).

📚 **[`docs/`](docs/README.md)** — regra de negócio do checkout, mapa das
chamadas do front, diagnóstico do legado e os
[contratos da API v2](docs/04-contratos-v2.md) (proposta das requisições novas).

---

## Rodando local

Pré-requisitos: **Node 20** (`node -v`). O projeto usa **npm** (não pnpm).

```bash
npm install
```

```bash
cp .env.example .env
```

Preencha o `.env` com as credenciais reais e suba:

```bash
npm run dev
```

Verificação de tipos:

```bash
npm run typecheck
```

### Scripts

| Script | O que faz |
| --- | --- |
| `npm run dev` | `tsx watch src/index.ts` — reload a cada alteração |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | `node dist/index.js` (o que o Render executa) |
| `npm run typecheck` | `tsc --noEmit` |

---

## Variáveis de ambiente

Validadas com zod **no boot**: falta ou valor inválido derruba o processo antes
de abrir a porta, com a lista do que está errado no stderr.

Localmente o arquivo `.env` na raiz do projeto é carregado automaticamente
(dotenv). Ele **não sobrescreve** variável já definida no ambiente, então no
Render — onde não existe `.env` — quem manda são as variáveis do dashboard.

### Obrigatórias

| Variável | Descrição |
| --- | --- |
| `VTEX_APPKEY` | AppKey da VTEX (header `X-VTEX-API-AppKey`) |
| `VTEX_APPTOKEN` | AppToken da VTEX (header `X-VTEX-API-AppToken`) |
| `VTEX_ACCOUNT` | Nome da conta VTEX |
| `VTEX_BASE_URL` | URL base, ex.: `https://acmestore.vtexcommercestable.com.br` (barra final é normalizada) |
| `PORT` | Porta HTTP (default `3000`; no Render vem injetada) |

### Opcionais

| Variável | Default | Descrição |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `LOG_LEVEL` | `info` | Nível do pino (`silent` … `trace`) |
| `CORS_ORIGINS` | `*` | Lista separada por vírgula; `*` libera geral |
| `VTEX_TIMEOUT_MS` | `10000` | Timeout **por tentativa** na VTEX |
| `VTEX_MAX_RETRIES` | `3` | Retentativas em 408/429/5xx e falha de rede |
| `API_KEY` | — | Protege `createGiftCard` (mínimo 16 caracteres). Sem ela, essa rota responde 503 |
| `SINTEGRA_TIMEOUT_MS` | `30000` | Timeout por consulta na SintegraWS. Folgado de propósito: o plugin `SN` já foi medido em **21 s** |
| `PUBLICA_CNPJ_BASE_URL` | `https://publica.cnpj.ws/cnpj` | Base pública da Receita, usada como fonte complementar de CNPJ |
| `PUBLICA_TIMEOUT_MS` | `8000` | Timeout da `publica.cnpj.ws` |
| `CNPJ_CACHE_TTL_MS` | `86400000` (24 h) | Validade do cache de consolidação de CNPJ. `0` desliga o cache |
| `CNPJ_CACHE_MAX_ENTRIES` | `1000` | Teto de CNPJs no cache em memória |

### Integrações externas herdadas

Estas alimentam rotas específicas. **Sem elas o serviço sobe normalmente** — só
a rota correspondente responde `503 SERVICE_NOT_CONFIGURED`, em vez de derrubar
o boot inteiro.

| Variável | Usada por | Descrição |
| --- | --- | --- |
| `SINTEGRA_TOKEN` | `getDataSintegra*` | Token da SintegraWS |
| `SINTEGRA_BASE_URL` | `getDataSintegra*` | Default: `https://www.sintegraws.com.br/api/v1/execute-api.php` |
| `SEARA_ENDPOINT` | `getEmployee` | URL da integração "controle" (B2E) |
| `SEARA_USER` | `getEmployee` | Usuário da autenticação XML |
| `SEARA_KEY` | `getEmployee` | Chave da autenticação XML |
| `SEARA_COOKIE` | `getEmployee` | Cookie exigido pelo proxy (opcional) |

> ⚠️ **Estes valores estavam hardcoded no fonte do app VTEX IO** — token da
> Sintegra em `clients/sintegra.ts`, usuário/chave/cookie da Seara em
> `middlewares/getEmployee.ts`. Não foram copiados para cá. Como estão no
> histórico do outro repositório, **devem ser rotacionados** antes de entrar em
> produção aqui.

O `.env` está no `.gitignore`. **Nunca commite credenciais reais** — o
`.env.example` só tem valores fictícios.

---

## Autenticação

**Quase todas as rotas são públicas**, replicando o `public: true` do
`service.json` do app VTEX IO. Isso não é uma flexibilização: elas são chamadas
pelo **navegador** (checkout e componentes React da loja) com `fetch` sem
header nenhum. Uma chave dentro de bundle de front não é segredo — apareceria
no DevTools de qualquer visitante.

A visibilidade de cada rota fica no campo `isPublic` de
[`src/routes/legacy/manifest.ts`](src/routes/legacy/manifest.ts).

Uma única rota exige autenticação:

| Rota | Por quê |
| --- | --- |
| `createGiftCard` | Era a **única com `policies`** no `service.json` (restrita ao app `b2csearakitfesta.store-theme`), é chamada de uma tela de admin (`react/GiftCardAdmin.tsx`) e não do checkout, e emite gift card com valor arbitrário. |

Para chamá-la:

```
x-api-key: <valor de API_KEY>
```

A comparação é feita em tempo constante (`timingSafeEqual`), e o valor recebido
nunca é logado. Sem `API_KEY` definida no ambiente, essa rota responde
`503 SERVICE_NOT_CONFIGURED` — o serviço sobe normalmente.

`GET /health` também é público (é o health check do Render).

---

## Endpoints

### `GET /health` — público

```json
{ "status": "ok", "uptimeSeconds": 42, "timestamp": "2026-09-04T12:00:00.000Z" }
```

Responde sobre **este processo**, sem tocar na VTEX — assim uma instabilidade
da VTEX não faz o Render derrubar o serviço.

### API v2 — rotas novas

Contrato consistente (envelope `{ data, meta }`, erro único, dado pessoal fora
da URL, decisão pronta em vez de dado bruto). Detalhes em
[`docs/04-contratos-v2.md`](docs/04-contratos-v2.md).

| Rota | Método | Auth | Substitui |
| --- | --- | --- | --- |
| `/v2/documents/cnpj/verify` | POST | pública | `getDataSintegraRF` + `getDataSintegraSN` + `getDataSintegraST` + a chamada do navegador à `publica.cnpj.ws` |

```bash
curl -X POST http://localhost:3000/v2/documents/cnpj/verify -H 'Content-Type: application/json' -d '{"cnpj":"50.972.373/0001-00","fallbackEmail":"cliente@dominio.com"}'
```

Uma requisição no lugar de quatro, com as quatro fontes consultadas em paralelo
no servidor, cache de 24 h por CNPJ, dedupe de requisição em voo, dígito
verificador conferido antes de gastar consulta paga, e o payload
`custom_cnpj_data` do ERP montado pronto. `meta.sources` diz como cada fonte se
saiu; `missingFiscalFields` diz exatamente o que faltou quando reprova.

> ⚠️ Ao ligar no `checkout-ui`, três campos mudam de valor no ERP
> (`ID_MICRO_EMPRESA`, `ID_MEI`, `NATUREZA_JURIDICA`) e `ID_INSCRICAO_ESTADUAL`
> passa a chegar sempre. Tabela completa em
> [`docs/04`, seção 2.6](docs/04-contratos-v2.md#26-post-v2documentscnpjverify--implementado).

### Rotas portadas do app VTEX IO

As 16 rotas declaradas em `kitfesta-seara/node/service.json` foram copiadas
para [`src/routes/legacy/manifest.ts`](src/routes/legacy/manifest.ts) — path e
verbo **exatamente** como no original — e registradas em
[`src/routes/legacy/index.ts`](src/routes/legacy/index.ts).

**Os paths foram renomeados**: o prefixo `/_v1/private/middleware/` do VTEX IO
virou `/middleware/checkout/`. O nome de cada rota e o resto do path seguem
idênticos, então migrar o front é um find-and-replace do prefixo.
`/_v1/make-cluster-alive` e `/_v/sitemap` também foram para baixo do mesmo
prefixo.

A **lógica de cada uma foi portada** dos handlers originais em
`kitfesta-seara/node/middlewares/`. O que mudou de infraestrutura:

- `ctx.vtex.authToken` + settings do `store-theme` → `VTEX_APPKEY`/`VTEX_APPTOKEN`
  do `.env`, injetados pelo cliente VTEX compartilhado.
- `axios` avulso em cada handler → o mesmo cliente, com timeout, retry e erro
  mapeado.
- `co-body` dentro do handler → `express.json` no router.
- `nanoid` → `crypto.randomInt` (mesmo formato de código, sem dependência ESM).
- `xml2js` → `fast-xml-parser`.

`ALL` = o app original não envolveu o handler em `method({...})`, então a rota
aceita qualquer verbo no VTEX IO. Foi copiado assim em vez de assumir `GET`.

| Rota | Método | Auth | Path | Handler original |
| --- | --- | --- | --- | --- |
| `makeClusterAlive` | ALL | pública | `/middleware/checkout/make-cluster-alive` | `makeClusterAlive.ts` |
| `getAddressPosition` | ALL | pública | `/middleware/checkout/getAddressPosition/` | `getAddressPosition.ts` |
| `getAddresState` | ALL | pública | `/middleware/checkout/getAddresState/` | `getAddresState.ts` |
| `getDataSintegraRF` | ALL | pública | `/middleware/checkout/getDataSintegraRF/:cnpj` | `getDataSintegraRF.ts` |
| `getDataSintegraSN` | ALL | pública | `/middleware/checkout/getDataSintegraSN/:cnpj` | `getDataSintegraSN.ts` |
| `getDataSintegraST` | ALL | pública | `/middleware/checkout/getDataSintegraST/:cnpj` | `getDataSintegraST.ts` |
| `getDataSintegraCPF` | ALL | pública | `/middleware/checkout/getDataSintegraCPF/:cpf/:date` | `getDataSintegraCPF.ts` |
| `getEmployee` | ALL | pública | `/middleware/checkout/getEmployee/:cpf` | `getEmployee.ts` |
| `getDataRamdom` | ALL | pública | `/middleware/checkout/getDataRamdom/` | `getDataRamdom.ts` |
| `getBirthDateCL` | ALL | pública | `/middleware/checkout/getInfo/:email` | `getBirthDateCL.ts` |
| `setBirthDateCL` | ALL | pública | `/middleware/checkout/setInfo/:email/:birthDate` | `setBirthDateCL.ts` |
| `updateDataMD` | POST | pública | `/middleware/checkout/md/update` | `updateDataMD.ts` |
| `createGiftCard` | POST | 🔑 `x-api-key` | `/middleware/checkout/createGiftCard/` | `generateUniqueGiftCardInfos.ts` → `createGiftCard.ts` → `addGiftCardBalance.ts` |
| `getGiftCardInfoFromMD` | ALL | pública | `/middleware/checkout/getGiftCardInfoFromMD/` | `getGiftInfoFromMD.ts` |
| `getDataInMasterData` | POST | pública | `/middleware/checkout/getDataInMasterData` | `getDataInMasterData.ts` |
| `sitemap` | GET | pública | `/middleware/checkout/sitemap/:type?` | `sitemap.ts` |

A visibilidade é a mesma do `service.json`: todas `public: true`, exceto
`createGiftCard`, a única que tinha `policies`. **A exposição não mudou** — no
VTEX IO essas rotas também respondiam a qualquer requisição, só que no domínio
da loja.

O que isso implica, e vale ter em mente:

- `getDataInMasterData` e `updateDataMD` são **proxy genérico** do Master Data:
  qualquer um lê e escreve qualquer entidade da conta. Era assim no VTEX IO
  também. Uma allowlist de entidades resolveria.
- As rotas Sintegra consomem **cota paga por consulta**. Público significa que
  um terceiro pode queimar a cota. Rate limit por IP resolveria.
- `getDataSintegraCPF` e `getEmployee` devolvem **dado pessoal** (CPF, nome,
  e-mail) sem autenticação.

Mitigação disponível hoje sem mudar contrato: apontar `CORS_ORIGINS` para o
domínio da loja. Isso só barra navegador — `curl` continua passando.

#### O que foi corrigido no porte

- **Loop infinito** em `createGiftCard`: o original fazia
  `while (mdResult.length > 0)` regenerando os códigos **sem reconsultar** o
  Master Data — a condição nunca mudava, então qualquer colisão pendurava o
  worker. Agora a busca é refeita a cada tentativa, com limite de 10.
- **Erros engolidos**: `createGiftCard` e `addGiftCardBalance` faziam
  `catch (e) { console.log(e) }` e seguiam como se tivesse dado certo. Agora o
  erro sobe e vira resposta de erro.
- **Injeção de XML** em `getEmployee`: o CPF era concatenado cru no payload.
  Agora é escapado.
- **Credenciais hardcoded** movidas para env (ver abaixo).
- Valores do sitemap passaram a ser escapados, e produto sem seller não
  derruba mais a geração inteira.

#### Divergências preservadas de propósito

- `getDataSintegraST` chama o plugin **RF**, não o ST — é um bug de
  copiar-e-colar do original (`getDataFromST` existia no client e nunca era
  usado). Mantido para não mudar a resposta de quem já consome; para corrigir,
  troque por `getCnpjFromST` em [`src/routes/legacy/sintegra.ts`](src/routes/legacy/sintegra.ts).
- `getDataRamdom` só devolve `{"ok":"ok"}` — no original ele carregava as
  settings do app e descartava. Sem VTEX IO não há settings; virou um segundo
  health check.
- `createGiftCard` não preenche mais `profileId`. No VTEX IO ele vinha de um
  `GET /api/vtexid/pub/authenticated/user` com o `adminUserAuthToken`, que não
  existe fora do VTEX IO (AppKey/AppToken não tem usuário associado).

#### Pontos a rever quando formos melhorar

- `getDataSintegraCPF` recebe **CPF e data de nascimento no path** — dado
  pessoal em URL, que vaza para log de proxy e histórico.
- `setBirthDateCL` **escreve** dado e aceita qualquer verbo: um `GET` altera
  registro.
- `getDataInMasterData` e `updateDataMD` são **proxy genérico** do Master Data:
  quem tem a `x-api-key` lê e escreve qualquer entidade da conta. Vale uma
  allowlist de entidades.
- Typos herdados nos nomes: `getAddresState`, `getDataRamdom`.
- Nome × path divergentes: `getBirthDateCL` → `/getInfo`,
  `setBirthDateCL` → `/setInfo`.
- `makeClusterAlive` é keep-alive de worker do VTEX IO; provavelmente não faz
  sentido no Render.

### Rotas do orderForm — a definir

O recurso VTEX é o **Checkout / orderForm**; o de/para de campos sai do payload
real da requisição, não de inferência.

---

## Mapeamento (de/para)

**A definir.** Cada recurso precisa de uma tabela `campo VTEX → campo de saída`
com tipo e regra de transformação, confirmada contra uma resposta real da VTEX
(ou a documentação do recurso) — nada de inferir nome de campo.

Convenções já fixadas:

- Cada mapper é **função pura** em `src/mappers/`, isolada da camada HTTP.
- O payload de entrada do mapper é o tipo inferido de um schema zod em
  `src/types/vtex.ts` — a resposta da VTEX já chega validada.
- O contrato de saída fica em `src/types/api.ts`.
- Sem `any` e sem cast: se a VTEX devolver algo fora do schema, o cliente
  levanta `VTEX_CONTRACT_MISMATCH` (502) em vez de propagar lixo adiante.

---

## Cliente VTEX

`src/services/vtex/client.ts` é o **único** ponto de acesso à VTEX. Ele:

- injeta `X-VTEX-API-AppKey` / `X-VTEX-API-AppToken` (headers passados por fora
  não conseguem sobrescrever as credenciais);
- aplica timeout por tentativa (`VTEX_TIMEOUT_MS`);
- retenta 408/429/5xx e falha de rede com backoff exponencial + jitter,
  respeitando `Retry-After` quando a VTEX manda;
- valida a resposta com o schema zod recebido;
- traduz qualquer falha em `VtexApiError` com o status já mapeado.

Uso:

```ts
import { z } from 'zod';
import { vtexRequest } from '../services/vtex/client.js';

const schema = z.object({ orderFormId: z.string() });

const data = await vtexRequest({
  path: '/api/checkout/pub/orderForm/123',
  schema,
});
```

### Mapeamento de status VTEX → middleware

| VTEX | Middleware | Código | Motivo |
| --- | --- | --- | --- |
| 400 | 502 | `VTEX_BAD_REQUEST` | a requisição errada foi montada por nós |
| 401 / 403 | 502 | `VTEX_UNAUTHORIZED` | credencial nossa inválida — não é erro do cliente |
| 404 | 404 | `VTEX_NOT_FOUND` | recurso realmente não existe |
| 408 / timeout | 504 | `VTEX_TIMEOUT` | upstream não respondeu a tempo |
| 429 | 503 | `VTEX_RATE_LIMITED` | rate limit após esgotar as retentativas |
| 5xx | 502 | `VTEX_UPSTREAM_ERROR` | upstream quebrado |

### Formato de erro

```json
{
  "error": {
    "code": "VTEX_NOT_FOUND",
    "message": "VTEX respondeu 404 em GET /api/...",
    "requestId": "0f1c..."
  }
}
```

Em `production`, erros 5xx respondem mensagem genérica — o detalhe fica só no
log. O `x-request-id` é aceito do cliente ou gerado, e volta no header e no
corpo do erro para correlacionar com os logs.

---

## Logs

pino estruturado em JSON (pretty em `development`). O `appToken`, o `appKey` e
o `x-api-key` são **redigidos** (`[REDACTED]`) em headers e em campos de
objeto — nenhum segredo entra no log.

---

## Deploy no Render (Blueprint)

O `render.yaml` na raiz descreve o serviço: web service Node, região `oregon`,
plano `free`, `healthCheckPath: /health`, `NODE_VERSION=20`, e todos os
segredos com `sync: false` (o Render pede os valores em vez de versioná-los).

Passo a passo:

1. **Suba o repo** para o GitHub/GitLab (branch `main`).
2. No [dashboard do Render](https://dashboard.render.com), clique
   **New +** → **Blueprint**.
3. **Conecte o repositório** e selecione a branch `main`. O Render detecta o
   `render.yaml` e mostra o serviço `compresearakitfesta-middleware-checkout`.
4. Clique **Apply**. O Render vai pedir os valores das variáveis marcadas
   `sync: false` — preencha:
   - `VTEX_APPKEY`, `VTEX_APPTOKEN`, `VTEX_ACCOUNT`, `VTEX_BASE_URL`
   - `API_KEY` — gere uma aleatória de 64 caracteres com o comando abaixo
   - `CORS_ORIGINS` (`*` ou a lista de domínios)
5. Aguarde o build (`npm ci && npm run build`) e o start (`npm run start`).
   O deploy só entra no ar depois que `/health` responder 200.
6. Valide o serviço no ar chamando `/health` na URL do Render.

Para gerar a `API_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Para validar o deploy:

```bash
curl -s https://SEU-SERVICO.onrender.com/health
```

**Não** defina `PORT` no dashboard: o Render injeta essa variável e o app já lê
`process.env.PORT`, com bind em `0.0.0.0`.

Alterações no `render.yaml` são aplicadas em **Manual Sync** no dashboard;
commits na `main` disparam deploy automático (`autoDeploy: true`).

> Plano `free` hiberna após ~15 min sem tráfego — a primeira requisição depois
> disso leva alguns segundos.

---

## Estrutura

```
src/
├─ config/        env (zod, fail-fast) e logger (pino, com redaction)
├─ middleware/    auth por x-api-key, errorHandler, request-id + log HTTP
├─ routes/        health (público), router protegido e legacy/ (rotas portadas)
├─ services/
│  ├─ http/       núcleo HTTP: timeout, retry com backoff, parse por schema
│  ├─ vtex/       cliente VTEX + masterdata, catalog, giftcard
│  ├─ sintegra/   SintegraWS (CPF/CNPJ)
│  └─ seara/      integração "controle" B2E, protocolo XML
├─ mappers/       funções puras (employee, sitemap, endereço, códigos)
├─ types/         schemas/tipos VTEX e contrato de saída    (orderForm a definir)
├─ app.ts         montagem do Express
└─ index.ts       listen em 0.0.0.0 + graceful shutdown (SIGTERM/SIGINT)
```
