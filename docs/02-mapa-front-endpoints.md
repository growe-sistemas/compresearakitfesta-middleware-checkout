# Mapa: front → endpoint → upstream

Inventário de **toda** chamada HTTP que sai do checkout, com o payload real
observado no código. Serve de base para o de/para do contrato novo.

Prefixo no app VTEX IO: `/_v1/private/middleware/`.
Prefixo neste repositório: `/middleware/checkout/`.

---

## 1. Chamadas ao middleware

| # | Origem no front | Rota | Verbo real | Upstream |
| --- | --- | --- | --- | --- |
| 1 | `services/PF.js:29`, `addressPF/index.js:23` | `getAddresState/` | POST | Master Data CL + AD |
| 2 | `SetAddress/index.js:32` | `getAddressPosition/` | POST | Master Data CL + AD |
| 3 | `controller.js:960` | `getInfo/:email` | GET | Master Data CL |
| 4 | `controller.js:971` | `setInfo/:email/:birthDate` | **GET que escreve** | Master Data CL |
| 5 | `services/masterdata.js:25` | `getDataInMasterData` | POST | Master Data (qualquer entidade) |
| 6 | `services/masterdata.js:70` | `md/update` | POST | Master Data (qualquer entidade) |
| 7 | `Sintegra/sintegra.js:15` | `getDataSintegraCPF/:cpf/:date` | GET | SintegraWS plugin CPF |
| 8 | `Sintegra/sintegra.js:150` | `getDataSintegraRF/:cnpj` | GET | SintegraWS plugin RF |
| 9 | `Sintegra/sintegra.js:159` | `getDataSintegraSN/:cnpj` | GET | SintegraWS plugin SN |
| 10 | `Sintegra/sintegra.js:168` | `getDataSintegraST/:cnpj` | GET | SintegraWS plugin **RF** (bug) |
| 11 | `controller.js:420`, `GiftCard/index.js:49` | `getGiftCardInfoFromMD/` | POST | Master Data CG |
| 12 | `react/LoginEmployee:202` | `getEmployee/:cpf` | GET | Seara `controle` (XML) |
| 13 | `react/GiftCardAdmin.tsx:72` | `createGiftCard` | POST | VTEX Gift Card API + MD CG |

### Payloads

**1. `getAddresState`**

```jsonc
// request
{ "userId": "0c1f...-userProfileId-do-orderForm" }

// response — array cru de documentos AD, com userIdCL anexado
[
  {
    "id": "abc...", "userId": "<id do documento CL>", "userIdCL": "<userProfileId>",
    "postalCode": "09540-500", "number": "123", "street": "...", "city": "...",
    "state": "SP", "neighborhood": "...", "complement": "...", "receiverName": "...",
    "addressName": "...", "addressType": "residential", "country": "BRA",
    "createdIn": "2024-01-01T00:00:00", "...": "_fields=_all"
  }
]
```

Sem documento CL para o `userId` (convidado), devolve `[]`.

**2. `getAddressPosition`**

```jsonc
// request
{ "userId": "...", "zipCodeCheckout": "09540-500", "numberCheckout": "123" }
// (aceita "email" no lugar de "userId" — o handler prioriza o email)

// response
{ "position": 3 }
```

Regra: índice 1-based do endereço que casa **CEP + número** (ambos
normalizados para dígitos) na lista ordenada por `createdIn ASC`; sem match,
`length + 1`; sem cliente, `1`.

**3. `getInfo/:email`** → `{ "birthDate": "1990-05-20T00:00:00+00:00" }` ou
`{ "birthDate": null }`.

**4. `setInfo/:email/:birthDate`** — `birthDate` chega como `dd-MM-yyyy` e o
handler inverte para `yyyy-MM-dd` antes de gravar
(`${convertDate(birthDate)}T00:00:00+00:00`). Responde o retorno cru do
Master Data, ou `{ "updated": false, "reason": "..." }` se não houver CL.

**5. `getDataInMasterData`**

```jsonc
// request — usada no bloqueio de CPF duplicado
{ "entity": "CL", "condition": "document=12345678901", "fieldsToReturn": "document,email,firstName" }

// response
{ "success": true, "message": "Dados retornados com sucesso.", "data": { "document": "...", "email": "...", "firstName": "..." } }
// ou { "success": false, "message": "Nenhum dado localizado no masterdata.", "data": null }
```

**6. `md/update`**

```jsonc
{ "acronym": "CL", "getCondition": "email=x@y.com", "payload": { "campo": "valor" } }
// response: o documento relido, sem o "id" — ou a string "ID não encontrado no MD"
```

**7–10. Sintegra** — resposta crua do provedor. `code: "0"` = sucesso; qualquer
outro valor é erro de negócio (o provedor responde **HTTP 200 mesmo em erro**).
No middleware isso vira 403 (com `message`) ou 408 (sem).

**11. `getGiftCardInfoFromMD`**

```jsonc
// request
{ "codigoCustomizado": "GIFTCARD-AB12CD" }
// response: array cru da entidade CG
[ { "codigoCustomizado": "GIFTCARD-AB12CD", "codigoCupom": "XYZ123" } ]
```

**12. `getEmployee/:cpf`**

```jsonc
// sucesso
{ "found": true, "message": "Dados do colaborador retornados.",
  "data": { "name": "Thais Goncalves Cardoso", "email": "...", "firstName": "Thais", "codInfluenciador": "THAIS39092" } }
// não encontrado
{ "found": false, "message": "CPF não encontrado." }
// falha de autenticação/integração — HTTP 200 com error:true
{ "error": true, "message": "Ops! ..." }
```

**13. `createGiftCard`** — `{ prefix, value, expiringDate?, quantity }`.

---

## 2. Chamadas diretas do navegador à VTEX (sem passar pelo middleware)

| Origem | Endpoint | Efeito |
| --- | --- | --- |
| `controller.js:246` | `GET /api/io/_v/private/profile` | descobre se está logado |
| `services/masterdata.js:3` | `GET /api/dataentities/{acronym}/search?{condition}` | **lê** CB (cache Sintegra) |
| `services/masterdata.js:48` | `POST /api/dataentities/{acronym}/documents` | **escreve** CB |
| `controller.js:474/509` | `GET`/`PATCH` `/api/dataentities/GF/...` | marca vale-presente como usado |
| `Sintegra/orderForm.js:98,138` | `POST /api/checkout/pub/orderForm/{id}/attachments/shippingData` | sobrescreve endereço |
| `Sintegra/orderForm.js:158` | `PUT`/`DELETE` `/api/checkout/pub/orderForm/{id}/customData/{app}/{field}` | grava customData |
| `SetAddress/index.js:52` | idem, `current_address_id` | |
| `Schedule/index.js:73` | idem, `custom_delivery_date` | |
| `vtexjs.checkout.sendAttachment` | `clientProfileData`, `shippingData`, `paymentData`, `openTextField` | |

## 3. Chamada direta a terceiro

| Origem | Endpoint | Problema |
| --- | --- | --- |
| `Sintegra/sintegra.js:135` | `GET https://publica.cnpj.ws/cnpj/{cnpj}` | consulta de CNPJ feita **do navegador do cliente**: sem controle de cota, sem cache, sem retry, sujeita a CORS e a bloqueio de rede corporativa. É a fonte **preferida** de dados no `_convertSintegraDataToCustomData`. |

---

## 4. Chaves de `customData` usadas no orderForm

| App / campo | Conteúdo | Escrito por |
| --- | --- | --- |
| `custom_birth_date` | `dd/mm/yyyy` | `_sendBirthDateCustomData` |
| `custom_cnpj_data` | JSON com os 11 campos fiscais (string) | `_sendCorporateClientCustomData` |
| `current_address_id` | posição 1-based do endereço | `SetAddress` |
| `custom_delivery_date` | `dd/mm/yyyy` da janela de entrega | `Schedule` |
| `custom_giftcard_prefix` | prefixo do vale (maiúsculo) | fluxo de gift card (desligado) |

Essas cinco chaves são **o contrato real com o ERP**. Qualquer mudança no contrato novo
precisa continuar produzindo exatamente esses valores.

---

## 5. Entidades do Master Data envolvidas

| Sigla | Papel | Quem escreve hoje |
| --- | --- | --- |
| `CL` | cliente (padrão VTEX) + campo custom `birthDate` | middleware (`setInfo`) |
| `AD` | endereços (padrão VTEX) | VTEX |
| `CB` | **cache** de respostas Sintegra (`cpf`, `cpfInfo`, `birthDate`, `cnpj`, `cnpjInfo`, `email`) | **o navegador**, direto |
| `CG` | de/para de vale-presente (`codigoCustomizado`, `codigoCupom`, `relationName`, `giftCardId`) | middleware (`createGiftCard`) |
| `GF` | controle de uso de vale-presente (`giftGenerated`, `giftUsed`, `used`) | **o navegador**, direto |
