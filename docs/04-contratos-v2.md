# Contratos da API v2

Desenho das **requisições melhoradas** que este middleware vai expor no lugar do
contrato herdado do app VTEX IO. Cada rota aqui nasceu de uma regra de negócio real
descrita em [01](01-regras-de-negocio-checkout.md) e de um problema concreto
listado em [03](03-diagnostico-app-vtex-io.md).

Status por rota:

| Rota | Status |
| --- | --- |
| [`POST /v2/documents/cnpj/verify`](#26-post-v2documentscnpjverify--implementado) | ✅ **implementado e testado** |
| todas as demais | proposta |

As 16 rotas de `/middleware/checkout/` seguem no ar — v1 e v2 convivem
(ver [plano de migração](05-plano-de-migracao.md)).

---

## 1. Convenções

Regras que valem para **todas** as rotas. É o que faltava nas rotas herdadas.

### 1.1 Prefixo e nomes

```
/v2/<recurso>/<sub-recurso>[/<ação>]
```

Recurso no plural, em inglês, sem sigla de fonte de dado no nome
(`getGiftCardInfoFromMD` → `/v2/gift-cards/lookup`). Verbo só quando a operação
não é CRUD (`/lookup`, `/verify`).

### 1.2 Verbos

| Operação | Verbo | Motivo |
| --- | --- | --- |
| consulta **com dado pessoal** (CPF, CNPJ, e-mail) | `POST` | dado pessoal nunca em URL — nem em path, nem em query |
| consulta sem dado pessoal | `GET` | cacheável |
| escrita | `PUT` / `POST` / `PATCH` | nunca `GET` |

Nenhuma rota aceita "qualquer verbo". O `ALL` herdado do VTEX IO morre aqui.

### 1.3 Envelope de resposta

Sucesso — sempre:

```jsonc
{
  "data": { /* o resultado, sempre objeto, nunca array na raiz */ },
  "meta": {
    "requestId": "0f1c...",
    "cache": { "hit": true, "source": "masterdata:CB", "ageSeconds": 812 },
    "sources": { "RF": "ok", "SN": "ok", "IE": "unavailable", "PUBLICA": "timeout" }
  }
}
```

- `data` é **sempre um objeto**. Lista vai dentro de uma chave (`addresses`,
  `items`) — assim dá para adicionar campo sem quebrar o consumidor.
- Campo sem valor vem `null` **explícito**, nunca omitido.
- `meta.cache` e `meta.sources` só aparecem onde fazem sentido.

Erro — o formato que o `errorHandler` já produz hoje:

```jsonc
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "requestId": "...", "details": [] } }
```

### 1.4 Status HTTP

| Situação | Status |
| --- | --- |
| decisão de negócio, inclusive **reprovação** ("CPF não confere", "CNPJ inativo", "endereço não permitido") | `200` — é uma resposta válida, não um erro de protocolo |
| corpo inválido | `400 VALIDATION_ERROR` |
| falta `x-api-key` em rota protegida | `401` |
| integração sem credencial | `503 SERVICE_NOT_CONFIGURED` |
| upstream fora / lento | `502` / `504` |

**Nunca** `200` com `{ error: true }`, e nunca `403` para reprovação de negócio —
os dois vícios herdados do app VTEX IO.

### 1.5 Normalização de dados

| Tipo | Formato na API v2 |
| --- | --- |
| CPF / CNPJ | **só dígitos**, entrada e saída. O middleware aceita com máscara e normaliza |
| Data | **ISO-8601 `YYYY-MM-DD`**. Nada de `dd/mm/yyyy` nem `dd-MM-yyyy` no fio |
| CEP | `postalCode` só dígitos + `postalCodeFormatted` (`00000-000`) |
| Telefone | E.164 (`+5511999999999`) |
| Booleano de negócio | `true`/`false`, nunca `0`/`1`/`"S"` |

Os formatos herdados (`dd/mm/yyyy` no `custom_birth_date`, `0`/`1` no
`custom_cnpj_data`) continuam existindo — mas **como saída pronta**, montada
pelo middleware, não como formato de transporte.

### 1.6 Decisão vem pronta

A rota devolve **a decisão**, não os dados brutos para o front decidir:

```jsonc
{ "approved": false, "reason": "BIRTH_DATE_MISMATCH", "message": "A data de nascimento informada não confere com o CPF." }
```

`reason` é um enum estável (para o código), `message` é o texto em pt-BR (para a
tela). O front deixa de reimplementar regra.

### 1.7 Cache

Cache de consulta cara (Sintegra) fica **no servidor**, com a entidade `CB` como
armazenamento — a mesma de hoje, só que escrita pelo middleware e não pelo
navegador. `meta.cache.hit` informa o consumidor sem mudar o contrato.

---

## 2. Rotas

### 2.1 `POST /v2/customers/document-availability`

Substitui o uso de `getDataInMasterData` no bloqueio de CPF duplicado —
**sem devolver dado de terceiro**.

```jsonc
// request
{ "document": "12345678901", "email": "cliente@dominio.com" }

// response 200
{ "data": { "available": true, "reason": null, "message": null } }

// CPF já cadastrado em outra conta
{ "data": {
    "available": false,
    "reason": "TAKEN_BY_ANOTHER_ACCOUNT",
    "message": "Este CPF já está cadastrado em outra conta. Entre com o e-mail utilizado no cadastro ou fale com o SAC."
} }
```

`reason`: `null` | `TAKEN_BY_ANOTHER_ACCOUNT` | `INVALID_DOCUMENT`.

---

### 2.2 `POST /v2/customers/lookup`

Substitui `getInfo/:email` (e tira o e-mail da URL).

```jsonc
// request — um dos dois
{ "email": "cliente@dominio.com" }
{ "userId": "0c1f...-userProfileId" }

// response 200
{ "data": {
    "found": true,
    "customer": {
      "clientId": "abc-123",          // id do documento CL
      "userId": "0c1f...",            // userProfileId
      "email": "cliente@dominio.com",
      "birthDate": "1990-05-20"       // ISO, ou null
    }
} }

// sem cadastro (convidado)
{ "data": { "found": false, "customer": null } }
```

Devolve **apenas** os campos acima. Nome, telefone e documento não saem daqui.

---

### 2.3 `PUT /v2/customers/birth-date`

Substitui `setInfo/:email/:birthDate` — deixa de ser um `GET` que escreve.

```jsonc
// request
{ "email": "cliente@dominio.com", "birthDate": "1990-05-20" }

// response 200
{ "data": { "updated": true, "clientId": "abc-123", "birthDate": "1990-05-20" } }

// cliente sem documento CL
{ "data": { "updated": false, "reason": "CUSTOMER_NOT_FOUND", "clientId": null, "birthDate": null } }
```

A conversão para `1990-05-20T00:00:00+00:00` e o reenvio obrigatório do campo
`email` (exigência do schema da CL) ficam **dentro** do middleware.

> ✅ **Já existe uma ponte para isso.** `POST|PUT /middleware/checkout/setInfo`
> aceita exatamente `{ email, birthDate }` no corpo, com a mesma resposta da
> rota antiga por path. Foi feita no path de `/middleware/checkout/` de propósito: o front troca só
> o `fetch`, sem esperar o resto da v2. Diferenças para o contrato acima:
> `birthDate` aceita `dd-MM-yyyy` **ou** ISO (a v2 padroniza em ISO), e a
> resposta é `{ updated, id }` / `{ updated: false, reason }` em vez do envelope
> `{ data }`.

---

### 2.4 `POST /v2/customers/addresses/lookup`

**Funde `getAddresState` + `getAddressPosition` em uma requisição.** Hoje são
duas chamadas que leem os mesmos dois documentos (CL e AD).

```jsonc
// request
{
  "userId": "0c1f...",              // ou "email"
  "match": { "postalCode": "09540500", "number": "123" }   // opcional
}

// response 200
{
  "data": {
    "customer": { "clientId": "abc-123", "userId": "0c1f...", "email": "..." },
    "addresses": [
      {
        "id": "ad-1",
        "position": 1,                       // 1-based, ordenado por createdIn ASC
        "postalCode": "09540500",
        "postalCodeFormatted": "09540-500",
        "street": "Rua Exemplo",
        "number": "123",
        "complement": null,
        "neighborhood": "Centro",
        "city": "Santo André",
        "state": "SP",
        "country": "BRA",
        "receiverName": "Fulano de Tal",
        "addressType": "residential",
        "createdIn": "2024-01-01T00:00:00Z"
      }
    ],
    "match": {
      "found": true,
      "position": 1,                 // posição a gravar em current_address_id
      "addressId": "ad-1"
    },
    "policy": {
      "allowsNewAddress": false,     // regra "PF compra só no endereço conhecido"
      "reason": "SINGLE_ADDRESS_POLICY",
      "message": "Você não pode comprar em um novo endereço. Utilize o mesmo endereço da sua última compra."
    }
  },
  "meta": { "requestId": "..." }
}
```

- Sem `match`, `match` volta `{ "found": false, "position": <total + 1>, "addressId": null }`
  — mesma regra do `getAddressPosition` de hoje.
- Cliente sem CL: `addresses: []`, `match.position: 1`,
  `policy.allowsNewAddress: true` (primeira compra).
- Comparação de CEP e número sempre com **dígitos normalizados** dos dois lados.

---

### 2.5 `POST /v2/documents/cpf/verify`

Substitui `getDataSintegraCPF/:cpf/:date`. Tira CPF e data de nascimento da URL,
faz o cache no servidor e **devolve a decisão** em vez do payload cru da
Sintegra.

```jsonc
// request
{ "cpf": "12345678901", "birthDate": "1957-03-13" }

// response 200 — aprovado
{
  "data": {
    "approved": true,
    "reason": null,
    "message": null,
    "checks": { "birthDateMatches": true, "registrationActive": true, "deceased": false },
    "person": {
      "name": "Rute de Jesus Borges",
      "birthDate": "1957-03-13",
      "gender": "F",
      "registrationStatus": "regular"
    }
  },
  "meta": { "cache": { "hit": true, "source": "masterdata:CB", "ageSeconds": 3600 } }
}

// response 200 — reprovado
{
  "data": {
    "approved": false,
    "reason": "REGISTRATION_INACTIVE",
    "message": "O CPF informado consta como \"Baixado\". É necessário um CPF com situação regular para continuar.",
    "checks": { "birthDateMatches": true, "registrationActive": false, "deceased": false },
    "person": null
  }
}
```

`reason`: `BIRTH_DATE_MISMATCH` | `REGISTRATION_INACTIVE` | `DECEASED` |
`DOCUMENT_NOT_FOUND`.

As três regras que hoje estão em `_handleClientBirthDate` (data bate, situação
regular, sem ano de óbito) passam para cá.

---

### 2.6 `POST /v2/documents/cnpj/verify` — ✅ IMPLEMENTADO

**A maior mudança.** Substitui as quatro requisições de hoje
(`getDataSintegraRF` + `getDataSintegraSN` + `getDataSintegraST` +
`publica.cnpj.ws` chamada do navegador) por **uma**, com a consolidação, os
fallbacks de máscara `*` e o `custom_cnpj_data` já montados no servidor.

Código: [`src/routes/v2/documents.ts`](../src/routes/v2/documents.ts) (HTTP),
[`src/services/documents/cnpjSources.ts`](../src/services/documents/cnpjSources.ts)
(coleta, cache e dedupe) e [`src/mappers/cnpj.ts`](../src/mappers/cnpj.ts)
(consolidação — função pura).

```jsonc
// request
{ "cnpj": "50.972.373/0001-00", "fallbackEmail": "cliente@dominio.com" }
```

- `cnpj` aceita com ou sem máscara e é normalizado para dígitos. O **dígito
  verificador é conferido antes** de qualquer chamada: CNPJ digitado errado
  responde `400 VALIDATION_ERROR` sem gastar consulta paga.
- `fallbackEmail` alimenta `DS_EMAIL_NFD` quando a empresa não tem e-mail
  próprio nas fontes. É opcional no contrato, mas **o checkout deve sempre
  enviar** — sem ele, empresa sem e-mail cadastrado reprova com
  `INCOMPLETE_FISCAL_DATA`.

Resposta real do CNPJ de teste (50972373000100):

```jsonc
{
  "data": {
    "approved": true,
    "reason": null,
    "message": null,
    "missingFiscalFields": [],
    "company": {
      "cnpj": "50972373000100",
      "corporateName": "GROWE LTDA",
      "tradeName": "GROWE LTDA",
      "stateInscription": null,        // null = sem IE; o ERP recebe "Isento"
      "registrationStatus": "ativa",
      "phone": "+551199398511",
      "email": "contato@groweag.com",
      "foundedAt": "2023-06-07",
      "legalNature": "206-2 - Sociedade Empresária Limitada",
      "size": "ME",                    // vocabulário único: ME | EPP | DEMAIS
      "simplesNacional": true,
      "mei": false,
      "mainActivityCode": "9511800",
      "icmsTaxpayer": null             // dado novo, do plugin ST
    },
    "address": {
      "postalCode": "04563000",
      "postalCodeFormatted": "04563-000",
      "street": "AV PDE ANTONIO JOSE DOS SANTOS",
      "number": "258",
      "complement": "APT 43",
      "neighborhood": "CIDADE MONCOES",
      "city": "São Paulo",
      "state": "SP",
      "country": "BRA"
    },
    "erpCustomData": {
      "DS_EMAIL_NFD": "contato@groweag.com",
      "ID_INS_ESTADUAL_SBT_TRB": null,
      "ID_OPTANTE_SIMPLES": 1,
      "DT_FUNDACAO": "07/06/2023",
      "ID_INSCRICAO_ESTADUAL": "Isento",
      "CD_CNA": "9511800",
      "ID_CONTRIBUINTE_ICMS": null,
      "ID_CALCULA_ICR": 0,
      "NATUREZA_JURIDICA": "206-2 - Sociedade Empresária Limitada",
      "ID_MICRO_EMPRESA": 1,
      "ID_MEI": 0
    }
  },
  "meta": {
    "cache": { "hit": false },
    "sources": { "RF": "ok", "SN": "ok", "ST": "not_found", "PUBLICA": "ok" },
    "durationMs": 1178
  }
}
```

Reprovações possíveis (`approved: false`, sempre **HTTP 200**):

| `reason` | Quando |
| --- | --- |
| `SOURCES_UNAVAILABLE` | nenhuma fonte respondeu |
| `REGISTRATION_INACTIVE` | situação cadastral ≠ ativa |
| `INCOMPLETE_FISCAL_DATA` | falta algum dos 8 campos obrigatórios do `erpCustomData` |
| `MISSING_POSTAL_CODE` | CEP ausente ou mascarado em todas as fontes |

`missingFiscalFields` lista **quais** campos faltaram — diagnóstico que o fluxo
antigo não dava (a tela só dizia "tente novamente").

`meta.sources` diz como cada fonte se saiu: `ok`, `not_found`, `timeout`,
`error` ou `unavailable`. `ST: "not_found"` é resposta legítima — significa
empresa sem inscrição estadual, não falha.

#### Como o disparo melhorou

| | Antes (navegador) | Agora (middleware) |
| --- | --- | --- |
| Requisições que saem do checkout | **4** (3 ao middleware + 1 à `publica.cnpj.ws`) | **1** |
| Consolidação dos campos | no navegador, ~450 linhas | no servidor, função pura |
| CNPJ inválido | 3 consultas pagas queimadas | `400`, zero consulta |
| Repetição do mesmo CNPJ | tudo de novo | cache de 24 h (`CNPJ_CACHE_TTL_MS`) |
| Cliques simultâneos no "Buscar" | N × 4 consultas | **1** coleta compartilhada (dedupe em voo) |
| Uma fonte cai | objeto de erro entra no payload como se fosse dado | vira status em `meta.sources` |
| Timeout | nenhum (o `fetch` do browser espera) | por fonte, configurável |

Medido com 3 requisições simultâneas e cache frio: **4** chamadas a upstream no
total (uma por fonte), não 12.

#### Diferenças em relação ao comportamento anterior

Decisões tomadas com o time em 05/09/2026 — **corrigir os valores** e **ligar o
plugin ST**:

| Campo | Antes | Agora | Motivo |
| --- | --- | --- | --- |
| `NATUREZA_JURIDICA` | `null` sem PUBLICA (travava a venda); formato `2062 - …` com PUBLICA | sempre preenchido, formato único `206-2 - …` | bugs B8/B11 |
| `ID_MICRO_EMPRESA` | `0` via PUBLICA, `1` via RF | `1` para ME, venha de onde vier | bug B12 |
| `ID_MEI` | sempre `0` | reflete o Simples Nacional / a natureza jurídica | bug B13 |
| `ID_INSCRICAO_ESTADUAL` | chave sumia do payload sem PUBLICA | sempre presente (`"Isento"` quando não há IE) | bug B14 |
| `stateInscription` | sempre `Isento` (a rota ST devolvia RF) | plugin **ST** de verdade | bug B1 |
| `ID_OPTANTE_SIMPLES` | `1` mesmo quando o SN falhava | `null` sem informação → reprova com motivo | evita mandar regime tributário errado ao ERP |
| `street` vindo da PUBLICA | perdia o tipo (`"PDE ANTONIO…"`) | `"AVENIDA PDE ANTONIO…"` | a PUBLICA separa tipo e nome |
| `ID_CONTRIBUINTE_ICMS` | fixo `null` | **segue fixo `null`** | fora do escopo aprovado; o dado agora existe em `company.icmsTaxpayer` |

### 2.7 `POST /v2/gift-cards/lookup`

Substitui `getGiftCardInfoFromMD`.

```jsonc
// request
{ "code": "GIFTCARD-AB12CD" }

// response 200
{ "data": {
    "found": true,
    "giftCard": { "customCode": "GIFTCARD-AB12CD", "redemptionCode": "XYZ123", "prefix": "GIFTCARD" }
} }

{ "data": { "found": false, "giftCard": null } }
```

O `prefix` (hoje calculado no front com `split('-',1)[0].toUpperCase`, e com bug)
passa a vir pronto — é ele que vai para `custom_giftcard_prefix` e para o
`openTextField`.

---

### 2.8 `POST /v2/gift-cards/redemptions`

Substitui a escrita direta do navegador na entidade `GF`.

```jsonc
// request
{ "code": "GIFTCARD-AB12CD", "orderFormId": "ab12..." }
// response 200
{ "data": { "registered": true, "alreadyUsed": false } }
```

---

### 2.9 `POST /v2/gift-cards` — 🔑 `x-api-key`

Emissão em lote (hoje `createGiftCard`, consumida pela tela de admin).
Contrato mantido, envelope novo:

```jsonc
// request
{ "prefix": "SEARA", "value": 10000, "quantity": 5, "expiringDate": "2026-12-31" }

// response 200
{ "data": { "created": [ { "id": "...", "customCode": "SEARA-AB12CD", "redemptionCode": "...", "relationName": "...", "value": 10000 } ] } }
```

---

### 2.10 `POST /v2/employees/lookup`

Substitui `getEmployee/:cpf` — tira o CPF da URL e o `error: true` com HTTP 200.

```jsonc
// request
{ "cpf": "12345678901" }

// response 200
{ "data": {
    "found": true,
    "employee": { "fullName": "Thais Goncalves Cardoso", "firstName": "Thais", "email": "thais@seara.com.br", "influencerCode": "THAIS39092" }
} }

{ "data": { "found": false, "employee": null } }
```

Falha de autenticação na Seara deixa de ser `200 { error: true }` e vira
`502 SEARA_UPSTREAM_ERROR` (ou `503 SERVICE_NOT_CONFIGURED` sem credencial).

---

### 2.11 `GET /v2/sitemap/:type?`

Mantida como está (não tem dado pessoal, é cacheável, é XML).

---

## 3. De/para v1 → v2

| Rota atual | v2 | Mudança principal |
| --- | --- | --- |
| `getAddresState/` | `POST /v2/customers/addresses/lookup` | fundida com a de posição; endereços normalizados |
| `getAddressPosition/` | idem (campo `match`) | −1 round-trip |
| `getInfo/:email` | `POST /v2/customers/lookup` | e-mail sai da URL |
| `setInfo/:email/:birthDate` | `PUT /v2/customers/birth-date` | deixa de ser `GET` que escreve; data em ISO |
| `getDataInMasterData` | `POST /v2/customers/document-availability` | para de vazar dado de terceiro |
| `md/update` | *(sem equivalente genérico)* | cada escrita vira rota própria |
| `getDataSintegraCPF/:cpf/:date` | `POST /v2/documents/cpf/verify` | PII fora da URL, cache no servidor, decisão pronta |
| `getDataSintegraRF/SN/ST/:cnpj` | `POST /v2/documents/cnpj/verify` | 4 requisições → 1; consolidação no servidor |
| `getGiftCardInfoFromMD/` | `POST /v2/gift-cards/lookup` | envelope + `prefix` pronto |
| *(escrita direta na GF)* | `POST /v2/gift-cards/redemptions` | sai do navegador |
| `createGiftCard/` | `POST /v2/gift-cards` | envelope |
| `getEmployee/:cpf` | `POST /v2/employees/lookup` | CPF fora da URL; erro com status real |
| `sitemap/:type?` | `GET /v2/sitemap/:type?` | — |
| `make-cluster-alive`, `getDataRamdom/` | `GET /health` | keep-alive de worker VTEX IO não existe no Render |

---

## 4. O que **não** migra para o servidor

Para não haver dúvida de escopo — continua no `checkout-ui`:

- injeção e validação de campos no DOM (data de nascimento, confirmação de
  telefone), SweetAlert, travas de formulário (`is-locked`, `inert`);
- os dois checkboxes de aceite;
- bloqueio de XHR nativo da VTEX;
- gravação em `orderForm` (`sendAttachment`, `customData`) — é sessão do
  navegador, autenticada por cookie do cliente.

O que migra é **decisão**: se o CPF vale, se o CNPJ vale, se o endereço é
permitido, qual a posição do endereço, quais dados fiscais vão para o ERP.

---

## 5. Endurecimento pendente (fora do contrato)

Registrado aqui para não se perder — não muda o formato das rotas:

1. **Rate limit** por IP nas rotas que consomem cota Sintegra.
2. **CORS** restrito ao domínio da loja (`CORS_ORIGINS`), ciente de que isso só
   barra navegador.
3. **Vínculo com a sessão VTEX**: hoje qualquer um consulta `birthDate` de
   qualquer e-mail. A correção real é validar o `orderFormId`/cookie de sessão
   contra o e-mail consultado — precisa ser desenhado com o time da loja.
4. **Rotação** do token SintegraWS e das credenciais Seara, que estão no
   histórico do repositório antigo.
