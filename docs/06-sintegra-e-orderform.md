# As 4 rotas Sintegra e o que vai para o orderForm

Documento baseado em **chamadas reais** feitas em 05/09/2026 contra o middleware
local (`npm run dev`), com o CNPJ **50972373000100** (GROWE LTDA).

---

## 1. O que cada rota é

Todas as quatro batem no **mesmo** provedor — SintegraWS
(`https://www.sintegraws.com.br/api/v1/execute-api.php`) — mudando só o
parâmetro `plugin`. Cada chamada consome **cota paga**.

| Rota | `plugin` | O que traz | Tempo medido |
| --- | --- | --- | --- |
| `getDataSintegraRF/:cnpj` | `RF` | cadastro completo na Receita Federal | **1,0 s** |
| `getDataSintegraSN/:cnpj` | `SN` | situação no Simples Nacional / SIMEI | **21,1 s** |
| `getDataSintegraST/:cnpj` | `RF` ⚠️ | *deveria* ser Substituição Tributária / Inscrição Estadual | 0,4 s |
| `getDataSintegraCPF/:cpf/:date` | `CPF` | cadastro de pessoa física | 22,8 s |

O provedor responde **HTTP 200 mesmo em erro**, sinalizando pelo campo `code`
(`"0"` = sucesso). O middleware traduz: `code != "0"` com `message` → **403**;
sem `message` → **408**.

> ⚠️ **`getDataSintegraST` devolve exatamente o mesmo JSON da `getDataSintegraRF`** —
> confirmado byte a byte no teste. O handler original chama `getDataFromRF`.
> Isso importa muito: é dessa rota que o front tenta tirar a **inscrição
> estadual**, e o plugin RF **não devolve esse campo**.

### 1.1 Por que a busca de CNPJ demora

O front dispara as 4 fontes em paralelo e espera todas
(`Promise.allSettled`). O gargalo é o **SN, com 21 s**. É isso que a tela
justifica com *"este processo pode demorar alguns minutos"*.

---

## 2. Respostas reais (CNPJ 50972373000100)

### 2.1 `getDataSintegraRF` — e `getDataSintegraST`, idêntico

```jsonc
{
  "code": "0", "status": "OK", "message": "Pesquisa realizada com sucesso.",
  "cnpj": "50.972.373/0001-00",
  "nome": "GROWE LTDA",
  "fantasia": "GROWE LTDA",
  "cep": "04.563-000",                      // com PONTOS
  "uf": "SP",
  "municipio": "São Paulo",
  "bairro": "CIDADE MONCOES",
  "tipo_logradouro": "AVENIDA",             // separado — o front NÃO usa
  "logradouro": "AV PDE ANTONIO JOSE DOS SANTOS",  // já vem abreviado
  "numero": "258",
  "complemento": "APT 43",
  "telefone": "(11) 9939-8511",
  "email": "CONTATO@GROWEAG.COM",           // MAIÚSCULO — e o front nunca usa
  "abertura": "07/06/2023",
  "sigla_natureza_juridica": "ltda",
  "natureza_juridica": "206-2 - Sociedade Empresária Limitada",   // com HÍFEN
  "situacao": "ATIVA",                      // não é "situacao_cadastral"
  "tipo": "MATRIZ",
  "porte": "ME",
  "atividade_principal": [ { "code": "9511800", "text": "Reparação e manutenção de computadores..." } ],
  "qsa": [ { "nome": "Victoria Pereira Luzzim", "cpf_rep_legal": "***.364.658-**", "...": "..." } ],
  "capital_social": "1.000,00",
  "ibge": { "codigo_municipio": "3550308", "codigo_uf": "35" },
  "inscricao_municipal": "",
  "version": "5"
}
```

**Não existe `inscricao_estadual` nesta resposta.**

### 2.2 `getDataSintegraSN`

```jsonc
{
  "code": "0", "status": "OK", "message": "Pesquisa realizada com sucesso.",
  "cnpj": "50972373000100",
  "cnpj_matriz": "50.972.373/0001-00",
  "nome_empresarial": "GROWE LTDA",
  "situacao_simples_nacional": "Optante pelo Simples Nacional desde 07/06/2023",
  "situacao_simei": "NÃO enquadrado no SIMEI",
  "situacao_simples_nacional_anterior": "Não Existem",
  "version": "1"
}
```

O front usa **um único campo** daqui: `situacao_simples_nacional`, e só para
decidir `0`/`1`.

### 2.3 `getDataSintegraCPF`

No teste (CPF inválido, só para ver o contrato) o provedor devolveu:

```jsonc
// HTTP 403
{ "error": {
    "code": "SINTEGRA_REJECTED",
    "message": "Site da Receita Federal CPF está com instabilidade.",
    "requestId": "35892cd0-..."
} }
```

O formato de sucesso está registrado em
`kitfesta-seara/node/middlewares/updateDataMD.ts` (comentário no fim do arquivo):

```jsonc
{
  "code": "0", "status": "OK",
  "cpf": "935.020.368-53",
  "nome": "Rute de Jesus Borges",
  "data_nascimento": "13/03/1957",
  "situacao_cadastral": "Regular",
  "ano_obito": "",
  "genero": { "sexo": "F", "nome_civil": "...", "...": "..." },
  "idade": "68",
  "qsa": [ /* empresas em que a pessoa é sócia */ ],
  "Comprovantes": { "...": "..." }
}
```

---

## 3. Quais campos vão para o orderForm

Resposta curta: **das 4 rotas, só a RF alimenta o orderForm de verdade.**
A SN vira um `0`/`1`. A ST não entrega nada (devolve RF). A CPF **não escreve
nada** — é só um portão de aprovação.

O front escreve em **três** lugares do orderForm.

### 3.1 `clientProfileData` (`controller.js:1699`)

| Campo do orderForm | Origem | Valor real neste CNPJ |
| --- | --- | --- |
| `corporateName` | **`RF.nome`** | `GROWE LTDA` |
| `tradeName` | **`RF.nome`** ⚠️ (usa `nome` de novo, não `fantasia`) | `GROWE LTDA` |
| `corporateDocument` | `RF.cnpj` só dígitos | `50972373000100` |
| `stateInscription` | `ST.inscricao_estadual` ?? `PUBLICA.inscricao_estadual` ?? `'Isento'` | **`Isento`** — o campo não existe na ST/RF |
| `corporatePhone` | `RF.telefone` → `+55` + dígitos | `+551199398511` |
| `isCorporate` | fixo | `true` |
| `email`, `firstName`, `lastName`, `document`, `phone` | **inputs do formulário**, não da Sintegra | — |
| `documentType` | fixo | `cpf` |
| `customerClass`, `profileCompleteOnLoading`, `profileErrorOnLoading` | fixos | `null`, `false`, `false` |

### 3.2 `shippingData.selectedAddresses[0]` (`controller.js:1673`)

Regra de cada campo: **usa RF se o valor não contiver `*`; senão PUBLICA; senão
o default.** (A SintegraWS mascara com asterisco o que não tem.)

| Campo do orderForm | Origem | Default | Valor real |
| --- | --- | --- | --- |
| `postalCode` | `RF.cep` → só dígitos | `''` | `04563000` |
| `street` | `RF.logradouro` | `''` | `AV PDE ANTONIO JOSE DOS SANTOS` |
| `number` | `RF.numero` → só dígitos | `'0'` | `258` |
| `complement` | `RF.complemento` sem caractere especial | `'NC'` | `APT 43` |
| `neighborhood` | `RF.bairro` | `'NC'` | `CIDADE MONCOES` |
| `city` | `RF.municipio` | `''` | `São Paulo` |
| `state` | `RF.uf` | `''` | `SP` |
| `country` | fixo | — | `BRA` |
| `addressType` | fixo | — | `residential` ⚠️ mesmo sendo PJ |
| `receiverName` | inputs `firstName + lastName` | — | — |

Sem `postalCode` a compra PJ para: *"Não encontramos o registro do código postal
para a empresa buscada, por favor, atualize os dados na Junta Comercial."*

### 3.3 `customData.custom_cnpj_data` — o payload do ERP

Onze campos montados por `_convertSintegraDataToCustomData`
(`controller.js:1817`), com precedência **PUBLICA → RF/SN → `null`**.

Valores reais deste CNPJ, nos dois cenários possíveis:

| Campo | Fonte | Com `publica.cnpj.ws` | **Sem** `publica.cnpj.ws` |
| --- | --- | --- | --- |
| `DS_EMAIL_NFD` | `PUBLICA.email` ?? e-mail do orderForm | `contato@groweag.com` | e-mail do cliente |
| `ID_INS_ESTADUAL_SBT_TRB` | fixo | `null` | `null` |
| `ID_OPTANTE_SIMPLES` | `situacao_simples_nacional` contém "não"? | `1` | `1` |
| `DT_FUNDACAO` | `abertura` | `07/06/2023` | `07/06/2023` |
| `ID_INSCRICAO_ESTADUAL` | `PUBLICA.inscricao_estadual` ?? `IE.inscricao_estadual` | `Isento` | **`undefined`** ⚠️ |
| `CD_CNA` | `atividade_principal[0].code` | `9511800` | `9511800` |
| `ID_CONTRIBUINTE_ICMS` | fixo | `null` | `null` |
| `ID_CALCULA_ICR` | fixo | `0` | `0` |
| `NATUREZA_JURIDICA` | `natureza_juridica` | `2062 - Sociedade Empresária Limitada` | **`null`** ⚠️ |
| `ID_MICRO_EMPRESA` | `porte === 'ME'` | **`0`** ⚠️ | **`1`** |
| `ID_MEI` | `sigla_natureza_juridica === 'mei'` | `0` | `0` |

---

## 4. Cinco problemas que o teste comprovou

### 4.1 O fluxo PJ **depende** da `publica.cnpj.ws`

`get_NATUREZA_JURIDICA` tem copiar-e-colar: o ramo do RF devolve
`PUBLICA?.natureza_juridica` em vez de `RF.natureza_juridica`
(`controller.js:1893`). Sem PUBLICA o campo vira `null`, e
`_validateCorporateCustomDataInterface` exige os 8 campos não-nulos → a compra
PJ é **bloqueada** com *"Não conseguimos recuperar alguns dos dados da Pessoa
Jurídica informada"*.

O dado existe na RF (`"206-2 - Sociedade Empresária Limitada"`) e é
simplesmente ignorado. **Resultado prático: se a API pública gratuita
`publica.cnpj.ws`, chamada direto do navegador do cliente, estiver fora,
ninguém compra como PJ** — mesmo com as três rotas pagas respondendo.

### 4.2 O mesmo CNPJ vira dado diferente no ERP conforme a fonte

`ID_MICRO_EMPRESA` compara `porte === 'ME'`. A RF devolve `"ME"` → `1`.
O conversor da PUBLICA devolve `"Micro Empresa"` → `0`. **A mesma empresa entra
no ERP ora como micro empresa, ora não**, dependendo de quem respondeu primeiro.

Vale o mesmo para `NATUREZA_JURIDICA`, que sai como `206-2 - ...` (RF) ou
`2062 - ...` (PUBLICA) — formatos diferentes para o mesmo dado.

### 4.3 `ID_MEI` é praticamente sempre `0`

Pela PUBLICA, `sigla_natureza_juridica` recebe a **descrição completa**
(`"Sociedade Empresária Limitada"`), nunca a sigla — então
`=== 'mei'` jamais é verdade. Como o caminho sem PUBLICA está bloqueado pelo
4.1, na prática **o MEI nunca é identificado**.

### 4.4 `ID_INSCRICAO_ESTADUAL` pode sumir do payload

Sem PUBLICA, `get_ID_INSCRICAO_ESTADUAL` devolve `IE.inscricao_estadual`, que é
`undefined` (a ST/RF não tem o campo). A validação só testa `=== null`, então
`undefined` **passa** — e o `JSON.stringify` **remove a chave**. O ERP receberia
o `custom_cnpj_data` sem `ID_INSCRICAO_ESTADUAL`.

### 4.5 A inscrição estadual nunca vem da Sintegra

Nem RF, nem ST (que é RF), nem SN devolvem `inscricao_estadual`. A `publica.cnpj.ws`
devolveu `inscricoes_estaduais: []` para este CNPJ. Logo `stateInscription`
cai no fallback **`'Isento'`** — que é o que chega no `clientProfileData`.

Se inscrição estadual real importa para o negócio, hoje ela **não está sendo
capturada**, e o plugin certo (`ST`, que existe no client e nunca foi chamado)
precisa ser ligado.

---

## 5. E a rota de CPF?

`getDataSintegraCPF` **não grava nada no orderForm**. Ela é um portão:

| Campo da resposta | Uso no front (`_handleClientBirthDate`, `controller.js:1105`) |
| --- | --- |
| `data_nascimento` | tem que ser **igual** à data digitada, senão reprova |
| `situacao_cadastral` | tem que ser `regular` |
| `ano_obito` | tem que ser `""` |
| resposta inteira | salva como string JSON na entidade **CB**, campo `cpfInfo` |

O que vai para o orderForm é a data que **o próprio cliente digitou**, gravada
em `customData.custom_birth_date` no formato `dd/mm/yyyy`.

> Lembrando: essa validação está **desligada** hoje (`controller.js:858`,
> `isValid = true` no lugar da chamada). A rota existe, custa cota, e não tem
> consumidor ativo.

---

## 6. O que a v2 resolve disso — ✅ implementado

`POST /v2/documents/cnpj/verify` (contrato completo em
[04, seção 2.6](04-contratos-v2.md#26-post-v2documentscnpjverify--implementado))
consolida as quatro fontes **no servidor** e devolve o `erpCustomData` pronto:

- lê `natureza_juridica` da RF quando a PUBLICA falta → **destrava 4.1**;
- normaliza `porte` das duas fontes para o mesmo vocabulário → **resolve 4.2**;
- deriva MEI do Simples Nacional / natureza jurídica → **resolve 4.3**;
- `null` explícito em vez de `undefined`, e `ID_INSCRICAO_ESTADUAL` nunca
  ausente → **resolve 4.4**;
- chama o plugin **ST de verdade** → **resolve 4.5**;
- 4 requisições do navegador viram 1, com cache de 24 h e dedupe de requisição
  em voo — o gargalo de 21 s do SN é pago uma vez por CNPJ, não a cada clique.

### 6.1 O que o plugin ST devolve de verdade

Consultado direto no provedor para o CNPJ de teste:

```jsonc
{
  "code": "1", "status": "OK",
  "message": "Nenhum estabelecimento encontrado no SINTEGRA.",
  "cnpj": "50972373000100",
  "inscricao_estadual": null,
  "situacao_ie": null, "situacao_ie_desc": null,
  "regime_tributacao": null, "tipo_inscricao": null,
  "contribuinte_icms": false,      // ← dado que o ERP não recebe hoje
  "ccc": false,
  "cep": null, "uf": "SP", "municipio": null, "logradouro": null,
  "version": "4"
}
```

Dois aprendizados:

1. `code: "1"` aqui **não é erro** — é a resposta correta para empresa sem
   inscrição estadual (não contribuinte de ICMS). Por isso a v2 trata esse caso
   como `ST: "not_found"` e grava `"Isento"`, em vez de reprovar a compra.
2. O plugin ST é a **única** fonte de `contribuinte_icms` e `regime_tributacao`.
   O campo `ID_CONTRIBUINTE_ICMS` do ERP é fixo `null` desde sempre; agora o
   dado existe em `company.icmsTaxpayer` — se o ERP passar a querer, é só
   mapear.

### 6.2 Medições depois da mudança

| Cenário | Resultado |
| --- | --- |
| 1ª consulta, cache frio | 1,5 s e 4 chamadas a upstream |
| 2ª consulta do mesmo CNPJ | 0,2 s, `cache.hit: true`, zero upstream |
| 3 requisições simultâneas, cache frio | **4** chamadas a upstream (uma por fonte), não 12 |
| CNPJ com dígito verificador errado | `400` imediato, **zero** consulta paga |
| Empresa sem e-mail e sem `fallbackEmail` | `approved: false`, `missingFiscalFields: ["DS_EMAIL_NFD"]` |
