# Plano de migração

Como sair das 16 rotas herdadas do app VTEX IO para as rotas novas sem parar a loja.

---

## 1. Princípio: convivência, não *big bang*

As rotas herdadas e as novas **coexistem** no mesmo
serviço. O front migra rota a rota. Nenhuma rota herdada é apagada antes de o
`checkout-ui` parar de chamá-la em produção.

```
front atual  ──► /middleware/checkout/getAddresState      (nome herdado)
front novo   ──► /middleware/checkout/customers/addresses (nome novo)
                        │
                        └── mesma camada de serviços (services/vtex, services/sintegra, services/seara)
```

As rotas novas **não** reimplementam acesso a upstream: reaproveitam
`services/vtex/*`, `services/sintegra/client.ts` e `services/seara/client.ts`,
que já têm timeout, retry, validação por schema e erro traduzido.

---

## 2. Ordem sugerida

Da menor para a maior dependência do front:

| Onda | Rotas novas | Por que primeiro |
| --- | --- | --- |
| **1** | `/middleware/checkout/employees/lookup`, `/middleware/checkout/gift-cards/*` | consumidor é o store-theme (React), não o checkout — deploy independente e risco baixo |
| **2** | `/middleware/checkout/customers/lookup`, `/middleware/checkout/customers/birth-date`, `/middleware/checkout/customers/document-availability` | trocas 1:1 no controller; resolvem o vazamento de dado pessoal (A1) e o `GET` que escreve (A4) |
| **3** | `/middleware/checkout/customers/addresses/lookup` | funde duas chamadas; exige mexer em `PF.js`, `addressPF` e `SetAddress` ao mesmo tempo |
| **4** | `/middleware/checkout/corporate-data` ✅ **backend pronto** | maior ganho e maior risco: reescreve `_handleCNPJSearchBtnClickEv` inteiro e tira a `publica.cnpj.ws` do navegador. Foi antecipada por decisão do time — falta a parte do `checkout-ui` |
| **5** | `/middleware/checkout/documents/cpf/verify` | a regra está **desligada** hoje — religar é decisão de negócio, não técnica |

---

## 3. Trabalho no `checkout-ui` por onda

### Onda 2

- `services/masterdata.js`: `getDataInMasterDataByMid` deixa de existir; o
  bloqueio de CPF duplicado passa a chamar `/middleware/checkout/customers/document-availability`
  e lê `data.available`.
- `controller.js:960/971`: `_getBirthDateInfo` e `_sendBirthDateInfo` passam a
  `POST /middleware/checkout/customers/lookup` e `PUT /middleware/checkout/customers/birth-date`, com a data já em
  ISO (some o `convertDate` na saída).

### Onda 3

- `services/PF.js`, `components/addressPF/index.js` e
  `components/SetAddress/index.js` convergem para **um** módulo que chama
  `/middleware/checkout/customers/addresses/lookup` e usa `data.match.position` e
  `data.policy.allowsNewAddress`.
- Some a duplicação de três chaves de `sessionStorage` para a mesma lista.

### Onda 4 — backend pronto, falta o front

- `components/Sintegra/sintegra.js` perde o objeto `PJ` inteiro
  (`convertPJtoDesiredInterface`, `getData.from.*`, `hasValidCnpjData`).
- `controller.js` perde `_convertSintegraDataToCustomData`,
  `_validateCorporateCustomDataInterface` e os sete *getters* de endereço.
- Some também a consulta à entidade `CB` feita pelo navegador (`_getCnpjInfoMd`)
  e a gravação nela (`saveDataInMasterData`): o cache agora é do servidor.
- `_handleCNPJSearchBtnClickEv` vira, em essência:

```js
const res = await fetch('/middleware/checkout/corporate-data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    cnpj: cnpjInputValue,
    fallbackEmail: vtexjs.checkout.orderForm.clientProfileData.email,
  }),
})
const { data } = await res.json()

if (!data.approved) return this._handleErrorOnCNPJSearch({ title: 'Ops...', text: data.message })

window.unblockVtexRequests = true
await this.orderForm.clearShippingData()
await Promise.all([
  this.orderForm.updateShippingData({ ...data.address, receiverName }),
  this.orderForm.sendAttachment('clientProfileData', { /* data.company */ }),
  this.orderForm.attachCustomData({
    customDataEndpoint: 'custom_cnpj_data/custom_cnpj_data',
    method: 'PUT',
    bodyData: data.erpCustomData,
  }),
])
```

Estimativa: **~450 linhas a menos** no `checkout-ui`.

**Antes de virar a chave em produção:** avisar o time do ERP dos três campos que
mudam de valor (`ID_MICRO_EMPRESA`, `ID_MEI`, `NATUREZA_JURIDICA`) e do
`ID_INSCRICAO_ESTADUAL`, que passa a chegar sempre — ver a tabela de diferenças
em [04, seção 2.6b](04-contratos-api.md#26b-postdelete-middlewarecheckoutcorporate-data--implementado).

---

## 4. Critério de pronto por rota

Uma rota nova só entra em produção com:

1. contrato escrito em [04](04-contratos-api.md) (request, response, enums de `reason`);
2. schema zod de entrada **e** de saída;
3. paridade verificada contra a rota herdada com payload real — mesma entrada, mesma
   decisão de negócio;
4. teste do caminho de reprovação, não só do feliz;
5. rota herdada correspondente com o campo `deprecated` preenchido em `routes.ts`.

---

## 5. Pendências que bloqueiam decisões

Precisam de resposta do time da loja/negócio antes de virarem código:

| # | Pergunta | Impacto |
| --- | --- | --- |
| 1 | A conferência de CPF na Sintegra deve voltar a valer? (está desligada em `controller.js:858`) | define se a onda 5 acontece |
| 2 | O bloqueio por faixa de CEP (`listZipCodeBlock`, ~500 faixas, código morto) ainda vale? | pode virar `/middleware/checkout/shipping/coverage` |
| 3 | O fluxo de vale-presente no checkout deve ser religado? (está comentado) | define se 2.7/2.8 entram agora |
| 4 | A trava de 18 anos deve valer também nos portões de `#/shipping`/`#/payment`, ou só no formulário? | está comentada no portão |
| 5 | Quem além do checkout consome `md/update`? | sem consumidor mapeado, a rota some em vez de ganhar equivalente |

---

## 6. O que vira *skill* depois

As skills devem cobrir o trabalho repetitivo que este desenho cria:

| Skill | O que faz |
| --- | --- |
| `nova-rota` | anda o caminho completo: schema zod de entrada/saída → handler em `routes/checkout/` → registro → contrato em `docs/04` → nota de deprecação na rota herdada |
| `paridade-rotas` | dispara a mesma entrada nas duas rotas e compara a decisão de negócio, ignorando diferença de envelope |
| `mapear-regra-do-checkout` | dado um trecho do `checkout-ui`, extrai a regra e diz qual rota nova deveria absorvê-la |

Nenhuma delas faz sentido antes da onda 1 existir — a skill precisa de um
exemplo concreto para imitar.
