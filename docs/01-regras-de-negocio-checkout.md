# Regras de negócio do checkout (estado atual)

Tudo aqui foi lido de `C:\Growe\checkout\searakifesta-checkout-ui\src\checkout`.
As referências `arquivo:linha` apontam para aquele repositório.

---

## 0. Como o código entra em execução

`index-checkout.js` importa `components/Sintegra/index.js`, que instancia
`CheckoutUIController` (`components/CheckoutUI/controller.js`). O controller é o
**único orquestrador**: 2.029 linhas com todas as regras.

A ordem é:

1. `VTEXOrderForm.init()` (`Sintegra/orderForm.js:9`) fica em *polling* de 500 ms
   até `vtexjs.checkout.orderFormId` existir e então dispara o evento customizado
   `orderFormLoaded`.
2. `controller.build()` escuta esse evento e roda a sequência de setup
   (`controller.js:29-67`).
3. `VTEXCheckoutRouter` (`Sintegra/checkoutrouter.js`) registra callbacks por
   hash (`#/cart`, `#/email`, `#/profile`, `#/shipping`, `#/payment`, `every`) e
   força o passo inicial: **quem entra fora de `#/cart` é jogado para
   `#/profile`** (`checkoutrouter.js:88`).

Consequência de arquitetura: o front **não confia** no fluxo nativo da VTEX — ele
bloqueia XHR nativo, força hash, injeta campos e reescreve o `orderForm`. Isso
explica a quantidade de guardas redundantes descritas abaixo.

---

## 1. Login obrigatório

`_handleUserSignIn` (`controller.js:242`):

- `GET /api/io/_v/private/profile` → se `IsUserDefined === false`, chama
  `vtexid.start({ returnUrl: '/checkout#/cart', forceReload: true })`.
- Se o `fetch` falhar (`!query.ok`), a página **recarrega**.

> ⚠️ **Bug ativo** — `controller.js:252-253` usa `=` no lugar de `===`:
>
> ```js
> const isAtEmailHash = (window.location.hash = '#/email')
> const isAtProfileHash = (window.location.hash = '#/profile')
> ```
>
> Isso não compara nada: *atribui* o hash duas vezes e as duas constantes ficam
> com string truthy. A condição seguinte é sempre verdadeira e o hash é forçado
> para `#/profile` como efeito colateral.

**Regra de negócio real:** compra só é permitida para usuário logado — é o que
sustenta as travas de endereço e CPF, que dependem de `userProfileId`.

---

## 2. Trava de CPF duplicado

`_blockDuplicateDocument` (`controller.js:70`), disparada a cada `input` em
`#client-document` com 14+ caracteres:

1. Consulta a entidade **CL** por `document=<cpf>` pedindo `document,email,firstName`.
2. Se existe um CL com aquele CPF **e** `email` diferente do e-mail do
   `orderForm`:
   - limpa o campo,
   - exibe `.modalck-duplicate` por 5 s,
   - envia `clientProfileData` com `document: null` (mantendo o e-mail).

**Regra:** um CPF não pode ser usado por duas contas. O CPF fica preso ao
primeiro e-mail que o cadastrou.

> 🔓 Hoje essa checagem devolve **o e-mail de outro cliente para o navegador**.
> Ver [diagnóstico](03-diagnostico-legado.md).

---

## 3. Data de nascimento — a trava mais elaborada

É a regra com mais camadas. Existem **três fontes de verdade** e o front tenta
mantê-las sincronizadas:

| Fonte | Formato | Quem escreve |
| --- | --- | --- |
| `#client-birthDate` (input injetado) | `yyyy-mm-dd` (input `date`) | usuário |
| `orderForm.customData.custom_birth_date` | `dd/mm/yyyy` | `_sendBirthDateCustomData` |
| Entidade **CL**, campo `birthDate` | ISO `yyyy-mm-ddT00:00:00+00:00` | rota `setInfo` |

### 3.1 Preenchimento

- O campo não existe no checkout nativo: é criado por
  `view.forms.profile.actions.createBirthDateInputEl()` (`controller.js:336`).
- `_setPreviousBirthDateOnInput` (`controller.js:906`) busca o valor já salvo na
  CL (`getInfo/:email`) e preenche o input.

### 3.2 Validação (`_validateBirthDateInput`, `controller.js:783`)

Regras declaradas no `just-validate`:

1. obrigatório;
2. `meetsMinimumAge(date, 18)` — **venda proibida para menores de 18**;
3. o CPF precisa estar preenchido (14+ caracteres);
4. conferência contra a Sintegra.

> ⚠️ **A regra 4 está desligada.** Em `controller.js:858` a linha
> `isValid = await this._handleClientBirthDate(val)` está comentada e substituída
> por `isValid = true`. Ou seja: **hoje nenhuma consulta Sintegra de CPF acontece
> no checkout**, e `getDataSintegraCPF` está sem consumidor real. O código da
> regra continua inteiro em `_handleClientBirthDate` (`controller.js:1105`) —
> ver 3.5.

### 3.3 Gravação e confirmação (`_sendBirthDateCustomData`, `controller.js:1284`)

Só grava se o valor no `customData` **em memória** for diferente do novo (evita
reescrever a cada `hashchange`), e depois **relê o orderForm para confirmar** que
gravou. Retorna `true`/`false`.

### 3.4 Os dois portões

- `_birthDateGate` (`controller.js:1391`) roda em `hashchange` para `#/shipping`
  e `#/payment`. Resolve a data pela ordem **input → customData → CL**
  (`_resolveBirthDate`, `controller.js:1241`), grava no `customData`, sincroniza
  a CL (`_ensureBirthDateOnCL`) e, faltando qualquer coisa, devolve o cliente
  para `#/profile` com SweetAlert.
- `_guardBirthDateOnPaymentSubmit` (`controller.js:1330`) intercepta o clique em
  `#payment-data-submit` **na fase de captura** (antes do handler Knockout da
  VTEX) e cancela o submit se `custom_birth_date` não estiver no orderForm.
  Existe porque `hashchange` não dispara quando o cliente dá F5 direto em
  `#/payment`.

> A checagem de 18 anos dentro do `_birthDateGate` também está **comentada**
> (`controller.js:1404-1417`). A idade só é barrada pelo validador do formulário.

### 3.5 Conferência Sintegra do CPF (código presente, desligado)

`_handleClientBirthDate` (`controller.js:1105`) faz, quando ligado:

1. procura na entidade **CB** um registro com `birthDate=<data>` (campos
   `cnpjInfo,cpf,cpfInfo,email`);
2. se não existe (**primeira vez**), consulta `getDataSintegraCPF/:cpf/:date`
   e usa `cpfInfo`;
3. reprova se `data_nascimento` da Sintegra ≠ data digitada
   → *"A data de nascimento informada não bate com o CPF informado"*;
4. reprova se `situacao_cadastral !== 'regular'` **ou** `ano_obito !== ''`
   → *"CPF Baixado"*;
5. sendo primeira vez, grava o payload cru da Sintegra na CB
   (`birthDate`, `cpf`, `cpfInfo` como string JSON, `email`).

**A entidade CB é um cache de consultas Sintegra mantido pelo navegador.**

---

## 4. Fluxo PF — endereço único

O PF **não pode comprar em endereço novo**. Isso aparece em três lugares:

### 4.1 Carregar os endereços conhecidos

`PF.syncStorageAddressesWithOrderformAddresses` (`services/PF.js:47`) e
`addressPF()` (`components/addressPF/index.js:3`) chamam `getAddresState` com
`{ userId: orderForm.userProfileId }` e guardam a lista em
`sessionStorage['@clientAddressList']` / `['@addressList']` / `['pfUniqueAddress']`
— três chaves para a mesma coisa, escritas por caminhos diferentes.

### 4.2 Forçar o endereço salvo

`_controlPfUniqueCEP` (`controller.js:154`), chamado no load e em cada
`hashchange` para `#/shipping`:

- se **existe** endereço salvo → trava o formulário (`setIsLockedAttribute('true')`)
  e, se o CEP selecionado ≠ CEP salvo, **sobrescreve o `shippingData`** com o
  primeiro endereço da lista via `POST .../attachments/shippingData`;
- se **não existe** → primeira compra, deixa o cliente preencher.

> A comparação normaliza o CEP (`replace(/\D/g,'')`) — sem isso `09540-500` ≠
> `09540500`, a guarda nunca cortava, o endereço era regravado a cada chamada e
> gerava **loop de requisições** em `getAddresState`. O comentário no código
> registra o incidente.

### 4.3 Barrar no passo de pagamento

`_handleClientAddressValidation` (`controller.js:2006`) → `PF.checkMultipleAddresses`
(`services/PF.js:69`): casa **CEP + número** do endereço selecionado contra a
lista em sessionStorage. Sem match, volta para `#/shipping` com:

> *"Você não pode comprar em um novo endereço. Por favor, utilize o mesmo
> endereço de sua última compra."*

### 4.4 Posição do endereço (`current_address_id`)

`SetAddress()` (`components/SetAddress/index.js`), registrada para rodar ao
entrar em `#/payment`:

- **PJ** → posição fixa `1`;
- **PF** → chama `getAddressPosition` com `{userId, zipCodeCheckout, numberCheckout}`
  e usa o índice devolvido;
- grava em `orderForm.customData.current_address_id`.

**Regra:** o ERP precisa saber *qual* dos endereços cadastrados do cliente é o da
entrega, por posição (1-based) na lista ordenada por `createdIn ASC`.

---

## 5. Fluxo PJ — busca de CNPJ

Disparado pelo botão **"Buscar"** injetado ao lado do campo de CNPJ
(`_createPJSearchButton`, `controller.js:1046`) → `_handleCNPJSearchBtnClickEv`
(`controller.js:1512`).

### 5.1 Coleta de dados (4 requisições paralelas)

`Sintegra.PJ.getData.general` (`Sintegra/sintegra.js:104`) dispara um
`Promise.allSettled` com:

| Chave | Origem | Observação |
| --- | --- | --- |
| `RF` | `getDataSintegraRF/:cnpj` | Receita Federal via SintegraWS |
| `SN` | `getDataSintegraSN/:cnpj` | Simples Nacional via SintegraWS |
| `IE` | `getDataSintegraST/:cnpj` | **devolve RF, não ST** — bug do middleware legado |
| `PUBLICA` | `https://publica.cnpj.ws/cnpj/<cnpj>` | **chamada direta do navegador**, timeout de 15 s, normalizada por `convertPJtoDesiredInterface` |

Antes disso, `_getCnpjInfoMd` procura o CNPJ na entidade **CB**
(`_where=(cnpj=...)&_fields=cnpjInfo`). Havendo cache, **nenhuma** das quatro
requisições acontece.

### 5.2 Decisões

1. **Resposta utilizável:** `PUBLICA?.situacao_cadastral || !data?.error`
   (`controller.js:1573`).
   > ⚠️ `convertPJtoDesiredInterface` produz a chave `situacao`, não
   > `situacao_cadastral` — o primeiro termo é sempre `undefined` e a decisão
   > cai inteira no `!data?.error` da RF.
2. **CNPJ ativo:** `PUBLICA.situacao_cadastral === 'ativa' || RF.situacao === 'ativa'`
   → senão, *"CNPJ Inativo"*.
3. **Dados fiscais completos:** `_validateCorporateCustomDataInterface`
   (`controller.js:1481`) exige **8 campos não-nulos**: `DS_EMAIL_NFD`,
   `ID_OPTANTE_SIMPLES`, `DT_FUNDACAO`, `ID_INSCRICAO_ESTADUAL`, `CD_CNA`,
   `NATUREZA_JURIDICA`, `ID_MICRO_EMPRESA`, `ID_MEI`. Faltando um, a compra PJ
   não segue.
4. **CEP obrigatório:** sem `postalCode` →
   *"atualize os dados na Junta Comercial"*.

### 5.3 Montagem do `custom_cnpj_data`

`_convertSintegraDataToCustomData` (`controller.js:1817`) monta o payload que vai
para o ERP, com precedência **PUBLICA → RF/SN/IE → `null`**:

| Campo | Regra |
| --- | --- |
| `DS_EMAIL_NFD` | e-mail da PUBLICA; senão o e-mail do `orderForm` |
| `ID_INS_ESTADUAL_SBT_TRB` | fixo `null` |
| `ID_OPTANTE_SIMPLES` | `situacao_simples_nacional` contém "não" → `0`, senão `1` |
| `DT_FUNDACAO` | `abertura` |
| `ID_INSCRICAO_ESTADUAL` | `inscricao_estadual` (fallback `'Isento'` no perfil) |
| `CD_CNA` | `atividade_principal[0].code` |
| `ID_CONTRIBUINTE_ICMS` | fixo `null` |
| `ID_CALCULA_ICR` | fixo `0` |
| `NATUREZA_JURIDICA` | `natureza_juridica` |
| `ID_MICRO_EMPRESA` | `porte === 'ME'` → `1`, senão `0` |
| `ID_MEI` | `sigla_natureza_juridica === 'mei'` → `1`, senão `0` |

> ⚠️ Dentro de `get_NATUREZA_JURIDICA`, o ramo do RF devolve
> `PUBLICA?.natureza_juridica` (copiar-e-colar): sem PUBLICA, o campo vem `null`
> e a validação de 8 campos reprova a compra.
>
> ⚠️ `hasPublica = PUBLICA.status === 'OK'` sem *optional chaining*: qualquer
> caminho que deixe `PUBLICA` indefinido estoura `TypeError` aqui.

### 5.4 Endereço da empresa

Os *getters* `getPostalCode`, `getMunicipio`, `getComplemento`, `getBairro`,
`getEstado`, `getRua` e `getNumber` (`controller.js:1594-1671`) aplicam a mesma
regra: **usa RF se o valor não contiver `*`; senão PUBLICA; senão default**
(`'NC'` para bairro/complemento, `'0'` para número, `''` para o resto). A
SintegraWS mascara com asterisco os campos que não tem.

### 5.5 Escrita no orderForm

Com `window.unblockVtexRequests = true` (necessário para furar o bloqueio de XHR
do item 7):

1. `clearShippingData()` — zera `address`, `availableAddresses`, `logisticsInfo`;
2. `Promise.all([updateShippingData(address), sendAttachment('clientProfileData', profileData), _sendCorporateClientCustomData(...)])`;
3. valida que **as três** respostas têm `orderFormId`, senão *"Erro na integração
   de dados"*;
4. grava na CB se foi a primeira vez.

O `clientProfileData` PJ leva `isCorporate: true`, `corporateName`/`tradeName` =
razão social da RF, `corporateDocument`, `stateInscription` (com fallback
`'Isento'`) e `corporatePhone` (`+55` + telefone da RF ou o do PF).

### 5.6 Desistir do CNPJ

`_handleDiscardCNPJ` (`controller.js:1063`): ao clicar em
`#not-corporate-client`, apaga `custom_cnpj_data`, reescreve `clientProfileData`
como PF (todos os campos corporativos `null`, `isCorporate: false`), zera
`shippingData` e **recarrega a página após 1,3 s**.

---

## 6. Trava de endereço para PJ

`_lockAddressWhenCorporateCustomer` (`controller.js:1782`), em **toda** rota:
lê o orderForm, e sendo `isCorporate` marca `is-locked` no formulário de entrega
e `inert` em razão social, nome fantasia, IE, CEP, número e complemento. Sendo
PF, remove os atributos.

**Regra:** o endereço da PJ é o da Junta Comercial e **não pode ser editado**.

---

## 7. Bloqueio do checkout nativo da VTEX

Três *monkey patches* em `XMLHttpRequest.prototype.open`:

| Função | O que bloqueia | Quando |
| --- | --- | --- |
| `_blockSimulateShippingFromNativeVTEXCheckout` (`controller.js:1027`) | `api/checkout/pub/postal-code` | apenas se `isCorporate` |
| `_overrideStepWhenAutoFillProfile` (`controller.js:1004`) | `api/checkout/pub/profiles/?email=` e `attachments/shippingData` fora de `#/shipping` | dispara o evento `hasEmailAtCheckoutEntered` no lugar |
| `_preventRefreshOnOutdatedDataOnNativeVTEXCheckout` (`controller.js:1017`) | `refreshOutdatedData=true` | **não é chamada** hoje |

`window.unblockVtexRequests = true` é a válvula de escape usada pelo fluxo PJ.

> ⚠️ Os patches se encadeiam sobre o `proxied` capturado no momento da
> definição: a ordem de instalação importa e não é óbvia.

---

## 8. Aceites obrigatórios no pagamento

`_resetPaymentButton` (`controller.js:257`) injeta dois checkboxes depois do
resumo do carrinho e só marca `data-is-active="true"` no
`.payment-confirmation-wrap` quando **os dois** estão marcados:

1. *"Estou ciente de que para compras futuras, o endereço deve permanecer dentro
   do estado atual, caso seja realizado um pedido fora do meu estado, o mesmo
   será cancelado."*
2. *"Confirmo estar ciente de que o CEP fornecido corresponde ao endereço
   inserido."*

**Regra:** o cliente assume o risco de cancelamento por mudança de estado.

---

## 9. Confirmação de telefone

`createPhoneConfirmationInputEl` injeta `#client-phone-confirm`; o validador
exige que seja **idêntico** a `#client-phone` (`controller.js:760`). O valor é
persistido em `localStorage['userPhone']` e reposto por `MutationObserver`
(`_applySavedPhone`, `controller.js:352`).

---

## 10. Agendamento de entrega

`Schedule()` (`components/Schedule/index.js`), disparado por
`orderFormUpdated.vtex` quando o hash é `#/shipping` (`checkoutrouter.js:130`):

1. lê `shippingData.logisticsInfo[0].slas[0].deliveryWindow.endDateUtc`;
2. converte para `dd/mm/yyyy`;
3. se diferente do que já está em `customData.custom_delivery_date`, grava com
   modal *"Salvando a data do agendamento"*.

---

## 11. Vale-presente (código presente, desligado)

`_createCustomGiftSection` / `_addGiftSectionEventListeners`
(`controller.js:376`) implementam:

1. `getGiftCardInfoFromMD` com `{ codigoCustomizado }` → `[{ codigoCupom }]`;
2. `sendAttachment('paymentData', { giftCards: [{ redemptionCode, inUse: true, provider: 'VtexGiftCard' }] })`;
3. `openTextField` = `"prefixo do cupom: <PREFIXO>"`;
4. `customData.custom_giftcard_prefix` = prefixo em maiúsculas;
5. se o prefixo for exatamente `GIFTCARD`, marca `used: true` e `giftUsed` na
   entidade **GF** no clique de finalizar;
6. remoção envia `giftCards: null` e apaga o `customData` (`DELETE`).

> ⚠️ **Desligado:** a única chamada de `_createCustomGiftSection` está comentada
> no `hashchange` (`controller.js:70-74`). O componente `components/GiftCard/`
> também não é importado por ninguém — e tem código quebrado em
> `index.js:78-84` (`insertAdjacentHTML` sem o objeto).
> Há ainda `.split('-', 1)[0].toUpperCase` **sem parênteses** em
> `controller.js:428` — referência à função, não o resultado.

---

## 12. Fora do checkout (store-theme)

| Componente | Rota | Regra |
| --- | --- | --- |
| `react/components/LoginEmployee/index.jsx:202` | `getEmployee/:cpf` | **B2E**: CPF de colaborador Seara → nome, e-mail e `codInfluenciador`; com `found: true` o fluxo envia código de validação para o e-mail corporativo. |
| `react/GiftCardAdmin.tsx:72` | `createGiftCard` | Tela de admin: emite N vale-presentes com prefixo e valor. |
| `react/utils/masterdata/index.ts:53` | `getDataInMasterData` | Proxy genérico de leitura do Master Data. |

---

## 13. Código morto (não remover sem confirmar)

| Arquivo | Situação |
| --- | --- |
| `components/ClosureCart/index.js` | Só o `.scss` é importado. O JS inteiro (travas por `setInterval` de 100 ms, `validateEmployee`, `listZipCodeBlock` com ~500 faixas de CEP bloqueadas) está fora do bundle. |
| `components/GiftCard/index.js` | Nunca importado. |
| `components/Lockings/index.js` | Importado, nunca chamado. |
| `services/PJ.js`, `components/Header/request.js` | Arquivos vazios. |
| `index-orderplaced.js` | Inteiramente comentado. |
| `_preventInputsToJumpSteps`, `_handlePfUniqueAddress`, `_savePhoneDataStorage`, `_deleteClientBirthDateCustomData` | Definidos e não chamados. |

`ClosureCart` guarda uma regra que **pode ter valor de negócio**: a
`listZipCodeBlock` (bloqueio de venda por faixa de CEP, com data). Se essa regra
ainda vale, ela precisa voltar — hoje **não está ativa**.
