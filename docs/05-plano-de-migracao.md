# Plano de migração

Como sair de "16 rotas legadas portadas" para a API v2 sem parar a loja.

---

## 1. Princípio: convivência, não *big bang*

`/middleware/checkout/*` (v1, porte fiel) e `/v2/*` **coexistem** no mesmo
serviço. O front migra rota a rota. Nenhuma rota v1 é apagada antes de o
`checkout-ui` parar de chamá-la em produção.

```
front atual  ──► /middleware/checkout/getAddresState      (v1, porte fiel)
front novo   ──► /v2/customers/addresses/lookup           (v2)
                        │
                        └── mesma camada de serviços (services/vtex, services/sintegra, services/seara)
```

As rotas v2 **não** reimplementam acesso a upstream: reaproveitam
`services/vtex/*`, `services/sintegra/client.ts` e `services/seara/client.ts`,
que já têm timeout, retry, validação por schema e erro traduzido.

---

## 2. Ordem sugerida

Da menor para a maior dependência do front:

| Onda | Rotas v2 | Por que primeiro |
| --- | --- | --- |
| **1** | `/v2/employees/lookup`, `/v2/gift-cards/*` | consumidor é o store-theme (React), não o checkout — deploy independente e risco baixo |
| **2** | `/v2/customers/lookup`, `/v2/customers/birth-date`, `/v2/customers/document-availability` | trocas 1:1 no controller; resolvem o vazamento de dado pessoal (A1) e o `GET` que escreve (A4) |
| **3** | `/v2/customers/addresses/lookup` | funde duas chamadas; exige mexer em `PF.js`, `addressPF` e `SetAddress` ao mesmo tempo |
| **4** | `/v2/documents/cnpj/verify` ✅ **backend pronto** | maior ganho e maior risco: reescreve `_handleCNPJSearchBtnClickEv` inteiro e tira a `publica.cnpj.ws` do navegador. Foi antecipada por decisão do time — falta a parte do `checkout-ui` |
| **5** | `/v2/documents/cpf/verify` | a regra está **desligada** hoje — religar é decisão de negócio, não técnica |

---

## 3. Trabalho no `checkout-ui` por onda

### Onda 2

- `services/masterdata.js`: `getDataInMasterDataByMid` deixa de existir; o
  bloqueio de CPF duplicado passa a chamar `/v2/customers/document-availability`
  e lê `data.available`.
- `controller.js:960/971`: `_getBirthDateInfo` e `_sendBirthDateInfo` passam a
  `POST /v2/customers/lookup` e `PUT /v2/customers/birth-date`, com a data já em
  ISO (some o `convertDate` na saída).

### Onda 3

- `services/PF.js`, `components/addressPF/index.js` e
  `components/SetAddress/index.js` convergem para **um** módulo que chama
  `/v2/customers/addresses/lookup` e usa `data.match.position` e
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
const res = await fetch('/v2/documents/cnpj/verify', {
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
em [04, seção 2.6](04-contratos-v2.md#26-post-v2documentscnpjverify--implementado).

---

## 4. Critério de pronto por rota

Uma rota v2 só entra em produção com:

1. contrato escrito em [04](04-contratos-v2.md) (request, response, enums de `reason`);
2. schema zod de entrada **e** de saída;
3. paridade verificada contra a v1 com payload real — mesma entrada, mesma
   decisão de negócio;
4. teste do caminho de reprovação, não só do feliz;
5. rota v1 correspondente marcada como **deprecada** no manifesto, com data.

---

## 5. Pendências que bloqueiam decisões

Precisam de resposta do time da loja/negócio antes de virarem código:

| # | Pergunta | Impacto |
| --- | --- | --- |
| 1 | A conferência de CPF na Sintegra deve voltar a valer? (está desligada em `controller.js:858`) | define se a onda 5 acontece |
| 2 | O bloqueio por faixa de CEP (`listZipCodeBlock`, ~500 faixas, código morto) ainda vale? | pode virar `/v2/shipping/coverage` |
| 3 | O fluxo de vale-presente no checkout deve ser religado? (está comentado) | define se 2.7/2.8 entram agora |
| 4 | A trava de 18 anos deve valer também nos portões de `#/shipping`/`#/payment`, ou só no formulário? | está comentada no portão |
| 5 | Quem além do checkout consome `md/update`? | sem consumidor mapeado, a rota some em vez de ganhar equivalente |

---

## 6. O que vira *skill* depois

As skills devem cobrir o trabalho repetitivo que este desenho cria:

| Skill | O que faz |
| --- | --- |
| `nova-rota-v2` | anda o caminho completo: schema zod de entrada/saída → handler em `routes/v2/` → registro → contrato em `docs/04` → nota de deprecação na v1 |
| `paridade-v1-v2` | dispara a mesma entrada nas duas rotas e compara a decisão de negócio, ignorando diferença de envelope |
| `mapear-regra-do-checkout` | dado um trecho do `checkout-ui`, extrai a regra e diz qual rota v2 deveria absorvê-la |

Nenhuma delas faz sentido antes da onda 1 existir — a skill precisa de um
exemplo concreto para imitar.
