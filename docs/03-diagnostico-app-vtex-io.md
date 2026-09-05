# Diagnóstico do app VTEX IO

O que está inconsistente, quebrado ou perigoso na dupla
`checkout-ui` + app VTEX IO — e o que já foi resolvido neste repositório. Cada item vira um requisito da v2.

---

## A. Segurança e privacidade

### A1. Vazamento de dado pessoal de terceiro

`getDataInMasterData` é um **proxy genérico**: o corpo escolhe entidade,
condição e campos. O checkout usa isso para checar CPF duplicado
(`entity: "CL", condition: "document=<cpf>", fieldsToReturn: "document,email,firstName"`)
e recebe de volta **o e-mail e o nome de outro cliente**. Qualquer pessoa com
`curl` faz o mesmo enumerando CPFs.

> **Requisito v2:** o front nunca recebe dado de terceiro. A rota devolve
> `{ available: false }` — a decisão, não os dados.

### A2. Escrita genérica no Master Data

`md/update` aceita `acronym` + `payload` livres: escreve **qualquer campo de
qualquer entidade** da conta. No VTEX IO era `public: true`.

> **Requisito v2:** allowlist de entidades e campos, ou rotas específicas por
> caso de uso.

### A3. Dado pessoal em path de URL

`getDataSintegraCPF/:cpf/:date` e `getEmployee/:cpf` levam CPF (e data de
nascimento) na URL — que vai para log de proxy, log de acesso, histórico do
navegador e Referer.

> **Requisito v2:** CPF e data no **corpo** da requisição, sempre POST.

### A4. `GET` que escreve — ✅ resolvido

`setInfo/:email/:birthDate` altera a entidade CL e no VTEX IO aceitava qualquer
verbo. Um pré-fetch de link ou um crawler altera dado. Ainda por cima, e-mail e
data de nascimento iam na URL (mesmo problema de A3).

> **Resolvido:** `POST|PUT /middleware/checkout/setInfo` faz a mesma operação
> lendo `{ email, birthDate }` do corpo, com verbo declarado e data validada.
> A versão por path segue no ar, depreciada e logando `warn`, até o
> `checkout-ui` migrar.

### A5. Cota paga exposta

As quatro rotas Sintegra são públicas e cada chamada consome **cota paga por
consulta**. Um terceiro pode queimar a cota do cliente.

> **Requisito v2:** cache server-side + rate limit por IP/sessão.

### A6. Navegador escrevendo no Master Data

O front grava a entidade `CB` (cache Sintegra) e `GF` (uso de vale-presente)
direto via `/api/dataentities`. Cache e controle de uso de vale são regra de
retaguarda; no navegador são adulteráveis.

> **Requisito v2:** cache e baixa de vale-presente ficam **dentro** do
> middleware.

### A7. Credenciais hardcoded (já corrigido)

Token da SintegraWS e usuário/senha/cookie da integração Seara estavam no
fonte do app VTEX IO. Já foram movidos para env neste repositório —
**mas os valores antigos continuam no histórico do outro repo e precisam ser
rotacionados.**

---

## B. Bugs

| # | Onde | Bug | Situação |
| --- | --- | --- | --- |
| B1 | `middlewares/getDataSintegraST.ts` | chama `getDataFromRF`, não `getDataFromST` — a chave `IE` do front é preenchida com dados da RF | **preservado** em `routes/checkout/sintegra.ts`, para não mudar a resposta |
| B2 | `middlewares/generateUniqueGiftCardInfos.ts` | `while (mdResult.length > 0)` regenerava códigos **sem reconsultar** o Master Data → laço infinito na primeira colisão | **corrigido** (rebusca a cada tentativa, limite de 10) |
| B3 | `createGiftCard` / `addGiftCardBalance` | `catch { console.log }` e seguia como se tivesse dado certo | **corrigido** (erro sobe) |
| B4 | `getEmployee` | CPF concatenado cru no XML → injeção | **corrigido** (escapado) |
| B5 | `getAddressPosition` | `getAddresInfo` faz `auxClientData[0].id` sem guarda → `TypeError` quando o CL não existe (só o `getAddresState` recebeu a correção) | **corrigido** aqui |
| B6 | `controller.js:252` | `=` no lugar de `===` na checagem de hash | **aberto** (front) |
| B7 | `controller.js:1573` | `PUBLICA?.situacao_cadastral` não existe no objeto convertido (é `situacao`) | **aberto** (front) |
| B8 | `controller.js:1893` | ramo `if (RF)` de `get_NATUREZA_JURIDICA` devolve `PUBLICA?.natureza_juridica` | **aberto** (front) |
| B9 | `controller.js:428` | `.toUpperCase` sem `()` | **aberto** (front, código desligado) |
| B10 | `GiftCard/index.js:78` | `insertAdjacentHTML` sem receptor — arquivo não compila logicamente | **aberto** (código morto) |
| B11 | `controller.js:1893` + B8 | consequência **comprovada em teste**: sem a `publica.cnpj.ws`, `NATUREZA_JURIDICA` vira `null`, a validação dos 8 campos reprova e **ninguém compra como PJ** | **aberto** |
| B12 | `controller.js:1901` vs `sintegra.js:81` | `ID_MICRO_EMPRESA` compara `porte === 'ME'`; a RF devolve `"ME"` (→1) e o conversor da PUBLICA devolve `"Micro Empresa"` (→0). **A mesma empresa entra no ERP com valor diferente conforme a fonte** | **aberto** |
| B13 | `controller.js:1913` vs `sintegra.js:69` | `ID_MEI` lê `sigla_natureza_juridica`, que pela PUBLICA recebe a **descrição completa** da natureza jurídica — `=== 'mei'` nunca é verdade | **aberto** |
| B14 | `controller.js:1873` + `1481` | sem PUBLICA, `ID_INSCRICAO_ESTADUAL` vira `undefined`; a validação só testa `=== null`, então passa, e o `JSON.stringify` **remove a chave** do payload do ERP | **aberto** |

Os quatro últimos foram confirmados com chamada real ao provedor —
detalhe e payloads em [06](06-sintegra-e-orderform.md).

---

## C. Inconsistência de contrato

Cada rota do app VTEX IO inventou o seu formato. Hoje convivem **cinco** estilos de
resposta:

| Estilo | Exemplo |
| --- | --- |
| array cru | `getAddresState`, `getGiftCardInfoFromMD` |
| objeto sem envelope | `{ "position": 3 }`, `{ "birthDate": null }` |
| envelope `success/message/data` | `getDataInMasterData` |
| envelope `found/message/data` | `getEmployee` |
| **string solta** | `"ID não encontrado no MD"` (`md/update`) |

E **quatro** convenções de erro:

| Estilo | Exemplo |
| --- | --- |
| HTTP 200 com `{ error: true, message }` | `getEmployee` |
| HTTP 200 com `{ error: "mensagem" }` | rotas Sintegra (o `ctx.status` é definido **antes** do `throw`, mas o `catch` sobrescreve o body e o status volta a 200 em vários caminhos) |
| status real (403/408) | Sintegra, quando o fluxo não cai no `catch` |
| exceção não tratada → 500 do VTEX IO | `getAddressPosition` sem CL |

Nomes também não seguem padrão: `getAddresState` (typo), `getDataRamdom`
(typo), `getInfo`/`setInfo` (nome não diz o que é), `md/update`
(`snake`/`path` misturado), `getGiftCardInfoFromMD` (expõe a fonte no nome).

> **Requisito v2:** um envelope só, um formato de erro só, nomes de recurso.

---

## D. Desenho que gera latência

| Problema | Custo |
| --- | --- |
| Busca de CNPJ dispara **4 requisições** do navegador (3 ao middleware + 1 à `publica.cnpj.ws`), depois consolida no cliente | latência somada + a UX mostra "aguarde alguns minutos" |
| Consulta de CB (cache) é uma 5ª requisição, feita antes | round-trip extra em todo clique |
| `getAddresState` e `getAddressPosition` leem **os mesmos dois documentos** (CL + AD) em chamadas separadas | 4 requisições ao Master Data para uma informação |
| `_controlPfUniqueCEP` roda em todo `hashchange` para `#/shipping` | reconsulta a lista de endereços a cada navegação |
| Sem cache HTTP útil: `Cache-Control: public, max-age=120` em rota **POST** (não é cacheável) | o header não faz nada |

> **Requisito v2:** uma requisição por decisão de negócio. Consolidação e cache
> no servidor.

---

## E. Regra de negócio espalhada e desligada

- A conferência de CPF na Sintegra (`_handleClientBirthDate`) está **desligada**
  por uma linha comentada. Ninguém percebe pela API: a rota continua existindo.
- A checagem de 18 anos existe **só** no validador do formulário — o portão de
  `#/shipping`/`#/payment` teve a checagem comentada.
- O bloqueio por faixa de CEP (`listZipCodeBlock`, ~500 faixas) está em arquivo
  fora do bundle.
- A mesma regra de "endereço único do PF" aparece em **três** implementações
  (`PF.checkMultipleAddresses`, `addressPF.checkMultAddress`,
  `_controlPfUniqueCEP`), duas delas mortas.

> **Requisito v2:** regra que decide compra fica no servidor, versionada e
> testável. Ligar/desligar vira configuração explícita, não comentário.

---

## F. O que este repositório já resolveu

Vale registrar para não refazer:

- cliente HTTP único com **timeout, retry com backoff + jitter** e erro
  traduzido (`services/http/request.ts`);
- toda resposta de upstream passa por **schema zod** — nada de `any`
  (`VTEX_CONTRACT_MISMATCH` em vez de propagar lixo);
- formato de erro único no `errorHandler` (`{ error: { code, message, requestId, details? } }`);
- `x-request-id` propagado e correlacionado no log;
- credenciais em env, com boot que falha se faltar o obrigatório;
- rotas que dependem de integração não configurada respondem
  `503 SERVICE_NOT_CONFIGURED` em vez de derrubar o processo.

A v2 herda tudo isso — o que falta é **o desenho das rotas**.
