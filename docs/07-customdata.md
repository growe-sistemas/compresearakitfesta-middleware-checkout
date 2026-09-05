# `customData` do orderForm — quem escreve o quê

Levantamento completo dos campos de `orderForm.customData` no fluxo do
Kit Festa Seara. Estes campos são **o contrato com o ERP**: é por eles que dado
que não cabe no orderForm nativo (data de nascimento, dados fiscais da PJ,
posição do endereço) chega ao pedido.

---

## 0. As 4 que importam — lista das requisições

Escopo definido com o time: `custom_birth_date`, `custom_cnpj_data`,
`current_address_id` e `custom_delivery_date`. O `custom_giftcard_prefix` fica
de fora (fluxo desligado).

São **5 requisições** — quatro `PUT` e um `DELETE`. Todas saem do navegador,
todas com `Accept: application/json` e `Content-Type: application/json`, e todas
para o mesmo host da loja.

| # | Requisição | Origem no código | Gatilho |
| --- | --- | --- | --- |
| 1 | `PUT .../customData/custom_birth_date/custom_birth_date` | `controller.js:1302` (`_sendBirthDateCustomData`) | entrar em `#/shipping` ou `#/payment`; clicar em finalizar |
| 2 | `PUT .../customData/custom_cnpj_data/custom_cnpj_data` | `controller.js:1951` (`_sendCorporateClientCustomData`) | busca de CNPJ aprovada |
| 3 | `DELETE .../customData/custom_cnpj_data/custom_cnpj_data` | `controller.js:1961` (`_deleteCorporateClientCustomData`) | desistir do CNPJ (`:1085`); cliente é PF (`:892`) |
| 4 | `PUT .../customData/current_address_id/current_address_id` | `SetAddress/index.js:52` | entrar em `#/payment` |
| 5 | `PUT .../customData/custom_delivery_date/custom_delivery_date` | `Schedule/index.js:73` | `orderFormUpdated.vtex` em `#/shipping` |

Base de todas: `/api/checkout/pub/orderForm/{orderFormId}/customData/{app}/{field}`.

Quem alimenta o valor de cada uma:

| Requisição | De onde vem o valor | Chamada ao middleware |
| --- | --- | --- |
| 1 | input `#client-birthDate` (ou `customData`, ou a entidade CL) | `getInfo/:email` para pré-preencher; `setInfo` para espelhar na CL |
| 2 e 3 | consolidação das fontes de CNPJ | **`POST /middleware/checkout/cnpj/verify`** → `data.erpCustomData` |
| 4 | posição do endereço na lista do cliente | `getAddressPosition` |
| 5 | `logisticsInfo[0].slas[0].deliveryWindow.endDateUtc` do próprio orderForm | nenhuma |

---

## 0.1 O middleware já escreve um deles

`POST /middleware/checkout/custom-data/birth-date` ✅ **implementado e testado**
faz a requisição 1 da tabela acima pelo servidor.

```jsonc
// request
{ "orderFormId": "ed241201694149eca1581915be35c4ce", "birthDate": "24-11-1995" }

// response 200
{
  "updated": true,
  "orderFormId": "ed241201694149eca1581915be35c4ce",
  "field": "custom_birth_date",
  "value": "24/11/1995",        // como ficou gravado
  "birthDate": "1995-11-24",    // ISO, para quem preferir normalizado
  "confirmed": true,            // a VTEX devolveu o valor e ele confere
  "storedValue": "24/11/1995"
}
```

Código: [`src/routes/checkout/customData.ts`](../src/routes/checkout/customData.ts) e
[`src/services/vtex/checkout.ts`](../src/services/vtex/checkout.ts).

O que ele resolve:

- **Formato numa camada só.** `birthDate` aceita `dd-MM-yyyy` ou ISO
  `yyyy-MM-dd`; a conversão para o `dd/mm/yyyy` que o campo guarda acontece
  aqui, uma vez. O ERP não vê diferença.
- **Data inexistente é barrada** (`31-02-1995` → `400`) antes de chegar à VTEX.
- **Confirmação sem custo.** A VTEX devolve o orderForm no próprio `PUT`; a
  rota lê o campo de volta e compara. Se a VTEX aceitar mas gravar outra coisa,
  responde `502 CUSTOM_DATA_NOT_PERSISTED` em vez de dizer que gravou. O front
  fazia isso relendo o orderForm numa segunda requisição.
- **Nome do campo vem de constante** (`CUSTOM_DATA_FIELDS`), não de string
  literal solta — ver 4.4.
- **`orderFormId` validado por regex** antes de entrar no path da URL.

Duas coisas a saber:

1. **A escrita passa a usar a AppKey do middleware**, não a sessão do
   comprador. O `orderFormId` vira a credencial da operação — mesmo modelo de
   antes (o navegador também só precisava dele), mas com credencial nossa.
2. **`orderFormId` inexistente não dá erro.** A VTEX cria um orderForm com o id
   informado e grava nele; a resposta volta `confirmed: true`. Não há como a
   rota distinguir carrinho real de carrinho recém-criado — o front deve sempre
   passar `vtexjs.checkout.orderForm.orderFormId`.

### O `custom_cnpj_data` também já é gravado pelo servidor

`POST /middleware/checkout/corporate-data` ✅ faz a requisição 2 da tabela — e mais:
grava o `clientProfileData` corporativo e o endereço da Junta Comercial na mesma
chamada. Contrato completo em
[04, seção 2.6b](04-contratos-api.md#26b-postdelete-middlewarecheckoutcorporate-data--implementado).

O `DELETE` do `custom_cnpj_data` (requisição 3) também está lá, no mesmo path
com verbo `DELETE`: tudo que é CNPJ entra e sai por um recurso só.

### E o `custom_delivery_date`

`POST /middleware/checkout/custom-data/delivery-date` ✅ faz a requisição 5 da tabela.

```jsonc
// request — aceita dd-MM-yyyy, dd/MM/yyyy, YYYY-MM-DD ou data-e-hora ISO
{ "orderFormId": "cc551425e8a445878344b79b79c48f6d", "deliveryDate": "27-11-2026" }

// response 200
{
  "updated": true,
  "orderFormId": "cc551425e8a445878344b79b79c48f6d",
  "field": "custom_delivery_date",
  "value": "27/11/2026",
  "deliveryDate": "2026-11-27",
  "confirmed": true,
  "storedValue": "27/11/2026"
}
```

Aceitar data-e-hora existe para o front poder mandar o
`logisticsInfo[0].slas[0].deliveryWindow.endDateUtc` cru, sem converter antes.

> ⚠️ **Fuso.** Data-e-hora é convertida no calendário de **São Paulo**, não em
> UTC: `2026-11-27T00:00:00Z` vira `26/11/2026`, que é o dia que o cliente
> brasileiro vê. O `checkout-ui` fazia o mesmo por acidente — usava
> `new Date(iso).getDate()`, ou seja, o fuso do *navegador*. Aqui a regra é
> explícita e não depende de onde o código roda.

### E o `current_address_id`

`POST /middleware/checkout/custom-data/erp-address-id` ✅ faz a requisição 4 da
tabela — e faz sozinha o que hoje são duas etapas no `checkout-ui`: descobrir a
posição do endereço e gravar o campo.

```jsonc
// request — só o orderFormId
{ "orderFormId": "cc551425e8a445878344b79b79c48f6d" }

// response 200
{
  "updated": true, "orderFormId": "…",
  "field": "current_address_id", "value": "1",
  "position": 1, "matched": true, "addressCount": 1, "isCorporate": false,
  "confirmed": true, "storedValue": "1"
}
```

O e-mail e o endereço selecionado saem do próprio orderForm, então não há como
o chamador mandar endereço desatualizado. A cadeia é
`clientProfileData.email → documento CL → AD (userId = id do CL, ordenado por
createdIn ASC) → posição 1-based do que casa CEP + número`.

| Situação | Posição |
| --- | --- |
| Casou CEP + número | índice + 1 |
| Não casou nenhum | `length + 1` (próxima livre) |
| Cliente sem documento CL (convidado) | `1` |
| PJ | `1`, sem consultar a AD |

`position`, `matched` e `addressCount` vão na resposta porque sem eles não dá
para saber se a posição veio de um endereço que casou ou do fallback.

PF sem endereço escolhido no orderForm responde `400 MISSING_SELECTED_ADDRESS`:
chamar antes da escolha é erro de quem chama, e inventar posição seria pior.

**Com isso os quatro campos do escopo são gravados pelo servidor.**

---

## 1. Resposta curta

| Origem | Escreve `customData`? |
| --- | --- |
| `searakifesta-checkout-ui` (o JS do checkout) | **Sim** — os 5 campos. |
| Este middleware | **Sim, os quatro do escopo**: `custom_birth_date`, `custom_cnpj_data`, `custom_delivery_date` e `current_address_id`. |
| App VTEX IO `kitfesta-seara/node` | **Não.** Nenhuma das 16 rotas toca `customData`. |
| store-theme (`kitfesta-seara/react`) | **Não.** |

No `checkout-ui`, toda escrita sai **do navegador direto para a VTEX**, em
`PUT|DELETE /api/checkout/pub/orderForm/{orderFormId}/customData/{app}/{field}`,
autenticada pelo cookie de sessão do próprio cliente.

No middleware, as escritas usam a AppKey da aplicação, e o `orderFormId` do
corpo da requisição é a credencial da operação.

---

## 2. Os cinco campos

Nos cinco, o `app` e o `field` têm o mesmo nome (`custom_birth_date/custom_birth_date`).

| Campo | Valor | Tipo enviado | Quando |
| --- | --- | --- | --- |
| `custom_birth_date` | `"24/11/1995"` | string `dd/mm/yyyy` | portão de `#/shipping` e `#/payment`, e no clique de finalizar |
| `custom_cnpj_data` | `"{\"DS_EMAIL_NFD\":…}"` | **string JSON** (objeto de 11 campos serializado) | busca de CNPJ bem-sucedida |
| `current_address_id` | `3` | **número** | ao entrar em `#/payment` |
| `custom_delivery_date` | `"05/09/2026"` | string `dd/mm/yyyy` | `orderFormUpdated` em `#/shipping` |
| `custom_giftcard_prefix` | `"GIFTCARD"` | string maiúscula | vale-presente aplicado |

### 2.1 `custom_birth_date`

- **Escreve:** `_sendBirthDateCustomData` (`controller.js:1284`), chamado por
  `_birthDateGate` (`:1413`) e pelo guarda do botão finalizar (`:1360`).
- **Formato:** `dd/mm/yyyy`, convertido do input `yyyy-mm-dd` por
  `convertDate(raw, '/')`.
- **Só grava quando muda:** compara com o valor já em memória antes do `PUT`, e
  depois relê o orderForm para **confirmar** que gravou (retorna `true`/`false`).
- **Lê de volta:** `_getBirthDateFromCustomData` (`:1235`), procurando o primeiro
  `customApps[].fields.custom_birth_date`.
- **DELETE:** existe (`_deleteClientBirthDateCustomData`, `:1969`) mas **as três
  chamadas estão comentadas** (`:825`, `:897`, `:1730`). Na prática, nunca é
  apagado.

### 2.2 `custom_cnpj_data`

- **Escreve:** `_sendCorporateClientCustomData` (`:1948`), dentro do
  `Promise.all` da busca de CNPJ (`:1729`).
- **Apaga:** `_deleteCorporateClientCustomData` (`:1960`), em dois pontos — ao
  desistir do CNPJ (`:1085`) e quando o cliente é PF (`:892`).
- **Formato:** objeto → `JSON.stringify` → vai como **string** dentro de `value`.
  Ou seja, o valor final é uma string JSON escapada, e quem lê precisa de
  `JSON.parse`.
- **Conteúdo:** os 11 campos fiscais. Composição campo a campo, com os valores
  reais medidos, em [06](06-sintegra-e-orderform.md#33-customdatacustom_cnpj_data--o-payload-do-erp).

### 2.3 `current_address_id`

- **Escreve:** `SetAddress()` (`components/SetAddress/index.js:52`), registrada
  para rodar ao entrar em `#/payment`.
- **Valor:** posição 1-based do endereço na lista do cliente. **PJ recebe sempre
  `1`**; PF consulta `getAddressPosition`.
- **Tipo:** este é o único que envia **número**, não string —
  `JSON.stringify({ value: index || 1 })` (`SetAddress/index.js:44`). Ver 4.1.

### 2.4 `custom_delivery_date`

- **Escreve:** `setScheduleDateCheckout` (`components/Schedule/index.js:73`),
  disparado por `orderFormUpdated.vtex` quando o hash é `#/shipping`.
- **Valor:** `logisticsInfo[0].slas[0].deliveryWindow.endDateUtc` convertido para
  `dd/mm/yyyy`.
- **Só grava quando muda:** compara com o valor já em `customApps`.
- Mostra um modal *"Salvando a data do agendamento"* durante a gravação.

### 2.5 `custom_giftcard_prefix`

- **Escreve:** `attachCustomData` interno ao fluxo de vale-presente
  (`controller.js:659`), com `giftInputText.value.split('-', 1)[0].toUpperCase()`.
- **Apaga:** quando o vale é removido e não sobra nenhum (`:607`).
- **Irmão fora do `customData`:** o mesmo fluxo grava o `openTextField` do
  orderForm com `"prefixo do cupom: <PREFIXO>"` (`:462`) e o limpa na remoção
  (`:561`).
- ⚠️ **Todo esse fluxo está desligado**: a única chamada de
  `_createCustomGiftSection` está comentada no `hashchange` (`:70-74`).

---

## 3. Formato HTTP exato

Duas funções montam o corpo, e elas **não concordam**.

`attachCustomData` (`components/Sintegra/orderForm.js:155`) — usada por
`custom_birth_date`, `custom_cnpj_data` e `custom_giftcard_prefix`:

```js
if (typeof bodyData === 'object') {
  body = JSON.stringify({ value: JSON.stringify(bodyData) })  // objeto vira STRING
} else {
  body = JSON.stringify({ value: bodyData })                  // escalar vai cru
}
```

```http
PUT /api/checkout/pub/orderForm/{orderFormId}/customData/custom_birth_date/custom_birth_date
Content-Type: application/json
Accept: application/json

{"value":"24/11/1995"}
```

```http
PUT /api/checkout/pub/orderForm/{orderFormId}/customData/custom_cnpj_data/custom_cnpj_data

{"value":"{\"DS_EMAIL_NFD\":\"contato@groweag.com\",\"ID_OPTANTE_SIMPLES\":1,…}"}
```

`SetAddress` monta o corpo por conta própria (`SetAddress/index.js:44`):

```http
PUT /api/checkout/pub/orderForm/{orderFormId}/customData/current_address_id/current_address_id

{"value":3}
```

---

## 4. Problemas encontrados

### 4.1 `current_address_id` envia número, todos os outros enviam string

Quatro campos mandam `"value": "texto"`; este manda `"value": 3`. Campo de
`customData` na VTEX é texto — o número é coagido. Funciona, mas é a única
exceção do conjunto e quem consome do lado do ERP recebe tipo diferente
conforme o campo.

### 4.2 `DELETE` manda corpo `{"value":"null"}`

Em `attachCustomData`, `bodyData` tem default `null` — e `typeof null === 'object'`
em JavaScript. Então o `DELETE` cai no ramo do objeto e envia
`{"value":"null"}` (a **string** `"null"`, não o valor nulo). A VTEX ignora
corpo em `DELETE`, então não quebra; mas se um dia passar a considerar, o campo
vira a string `"null"` em vez de sumir.

### 4.3 `custom_cnpj_data` é JSON duplamente codificado

O objeto vira string antes de entrar em `value`. Quem lê precisa de
`JSON.parse` no valor do campo — passo extra que os outros quatro não exigem, e
que não está documentado em lugar nenhum do código.

### 4.4 Não existe fonte única do que cada campo significa

Os cinco nomes só existem espalhados como string literal no `controller.js`, no
`SetAddress` e no `Schedule`. Não há constante, tipo, nem validação: um typo em
`'custom_bith_date/custom_bith_date'` criaria um campo novo silenciosamente, e o
pedido chegaria ao ERP sem a data de nascimento.

### 4.5 O `custom_birth_date` nunca é apagado

As três chamadas do `DELETE` estão comentadas. Se o cliente troca de conta na
mesma sessão de checkout, a data anterior permanece no orderForm até o pedido
fechar.

---

## 5. Onde o middleware entra (hoje e no plano)

Hoje, em **nenhum** ponto: ele nunca chama a API de `customData`.

O que ele já faz é entregar conteúdo pronto para um dos campos:

| Campo | Middleware entrega | Rota |
| --- | --- | --- |
| `custom_cnpj_data` | `data.erpCustomData`, os 11 campos montados e validados | `POST /middleware/checkout/cnpj/verify` ✅ |
| `current_address_id` | a posição do endereço | `getAddressPosition` / `POST /middleware/checkout/customers/addresses/lookup` (proposto) |
| `custom_birth_date` | — | a data vem do próprio cliente |
| `custom_delivery_date` | — | vem do SLA do orderForm |
| `custom_giftcard_prefix` | o prefixo já calculado | `POST /middleware/checkout/gift-cards/lookup` (proposto) |

**Manter assim é a escolha certa.** Escrever `customData` exige a sessão do
comprador (cookie do orderForm), que é do navegador — mover isso para o servidor
significaria o middleware agir em nome do cliente numa sessão que não é dele.
A divisão continua sendo: **o middleware decide e monta, o front grava**.

O que vale corrigir junto com a migração do front:

1. centralizar os cinco nomes em uma constante única no `checkout-ui`;
2. mandar sempre string (resolve 4.1);
3. passar `bodyData` explicitamente ausente no `DELETE` (resolve 4.2);
4. decidir se `custom_birth_date` deve ou não ser apagado (4.5) — é uma pergunta
   de negócio, ver [05](05-plano-de-migracao.md#5-pendências-que-bloqueiam-decisões).
