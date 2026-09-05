# Documentação — middleware de checkout Kit Festa Seara

Esta pasta descreve **a regra de negócio que existe hoje** no checkout da loja
e **o desenho das requisições novas** que este middleware vai expor.

Fontes lidas para escrever isto (nenhuma inferência — tudo saiu do código):

| Repositório | O que é | Papel |
| --- | --- | --- |
| `C:\Growe\checkout\searakifesta-checkout-ui\src\checkout` | `checkout-ui-custom` (JS injetado no checkout nativo da VTEX) | **Dono da regra de negócio.** É quem decide o que bloqueia, o que trava e o que grava. |
| `C:\Growe\stores\kitfesta-seara\node` | app VTEX IO (`Service` + 16 rotas) | Camada de acesso: fala com Master Data, Sintegra e Seara em nome do front. |
| `C:\Growe\stores\kitfesta-seara\react` | store-theme | Consome 3 rotas fora do checkout (B2E, gift card admin, Master Data). |
| este repositório | middleware Express fora do VTEX IO | Todas as rotas, sob `/middleware/checkout/*`. |

## Índice

1. [Regras de negócio do checkout](01-regras-de-negocio-checkout.md) — o que o
   front faz, passo a passo, e por quê.
2. [Mapa: front → endpoint → upstream](02-mapa-front-endpoints.md) — cada
   `fetch` do front, com payload real de entrada e saída.
3. [Diagnóstico do app VTEX IO](03-diagnostico-app-vtex-io.md) — o que está inconsistente,
   quebrado ou perigoso na versão VTEX IO (e o que já foi corrigido aqui).
4. [Contratos das rotas](04-contratos-api.md) — **as requisições melhoradas**:
   endpoint a endpoint, request e response.
5. [Plano de migração](05-plano-de-migracao.md) — ordem de execução,
   convivência entre o que existe e o que vem, e o que vira skill.
6. [As 4 rotas Sintegra e o orderForm](06-sintegra-e-orderform.md) — payloads
   **reais** capturados em teste, e o de/para campo a campo do que é gravado no
   `clientProfileData`, no `shippingData` e no `custom_cnpj_data`.
7. [`customData` do orderForm](07-customdata.md) — os cinco campos, quem escreve
   cada um, formato exato no fio, e por que o middleware não escreve nenhum.

## Resumo em cinco linhas

O checkout tem **dois fluxos de compra** (PF e PJ) e **quatro travas**
obrigatórias: data de nascimento, CPF não duplicado, endereço único do PF, e
dois aceites em checkbox. Toda decisão é tomada **no navegador**, com o
middleware servindo de proxy burro — inclusive para gravar no Master Data e para
consultar CNPJ em uma API pública (`publica.cnpj.ws`) chamada direto do browser.
O contrato novo inverte isso: o middleware passa a **devolver a decisão pronta**, e o front
só reage.
