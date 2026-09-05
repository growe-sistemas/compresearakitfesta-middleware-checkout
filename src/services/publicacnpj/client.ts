import { z } from 'zod';
import { env } from '../../config/env.js';
import { upstreamRequest } from '../http/request.js';

/**
 * publica.cnpj.ws — base publica da Receita.
 *
 * No fluxo antigo esta consulta saia DO NAVEGADOR do cliente
 * (`checkout-ui/src/checkout/components/Sintegra/sintegra.js:135`): sem
 * timeout util, sem retry, sem cache, sujeita a CORS e a bloqueio de rede
 * corporativa — e mesmo assim era a fonte preferida na montagem do payload
 * fiscal. Aqui ela vira mais uma fonte do servidor, no mesmo nucleo HTTP das
 * outras.
 *
 * O schema e proposital mente frouxo (tudo opcional, `passthrough`): esta e uma
 * fonte de melhor-esforco. Campo que faltar cai no fallback da SintegraWS em
 * vez de derrubar a consolidacao.
 */
const idDescricaoSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional().nullable(),
    descricao: z.string().optional().nullable(),
  })
  .passthrough();

const inscricaoEstadualSchema = z
  .object({
    inscricao_estadual: z.string().optional().nullable(),
    ativo: z.boolean().optional().nullable(),
  })
  .passthrough();

const estabelecimentoSchema = z
  .object({
    cnpj: z.string().optional().nullable(),
    nome_fantasia: z.string().optional().nullable(),
    situacao_cadastral: z.string().optional().nullable(),
    data_inicio_atividade: z.string().optional().nullable(),
    tipo_logradouro: z.string().optional().nullable(),
    logradouro: z.string().optional().nullable(),
    numero: z.string().optional().nullable(),
    complemento: z.string().optional().nullable(),
    bairro: z.string().optional().nullable(),
    cep: z.string().optional().nullable(),
    ddd1: z.string().optional().nullable(),
    telefone1: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    atividade_principal: idDescricaoSchema.optional().nullable(),
    estado: z
      .object({ sigla: z.string().optional().nullable(), nome: z.string().optional().nullable() })
      .passthrough()
      .optional()
      .nullable(),
    cidade: z
      .object({ nome: z.string().optional().nullable() })
      .passthrough()
      .optional()
      .nullable(),
    inscricoes_estaduais: z.array(inscricaoEstadualSchema).optional().nullable(),
  })
  .passthrough();

export const publicaCnpjSchema = z
  .object({
    razao_social: z.string().optional().nullable(),
    porte: idDescricaoSchema.optional().nullable(),
    natureza_juridica: idDescricaoSchema.optional().nullable(),
    simples: z
      .object({
        simples: z.string().optional().nullable(),
        mei: z.string().optional().nullable(),
      })
      .passthrough()
      .optional()
      .nullable(),
    estabelecimento: estabelecimentoSchema.optional().nullable(),
  })
  .passthrough();

export type PublicaCnpjResponse = z.infer<typeof publicaCnpjSchema>;

/**
 * Consulta um CNPJ (so digitos). Erro de rede, 404 ou timeout sobem como
 * `UpstreamError` — cabe a quem chama tratar como fonte indisponivel, nao
 * como falha da requisicao inteira.
 */
export async function getPublicaCnpj(cnpj: string): Promise<PublicaCnpjResponse> {
  return upstreamRequest({
    upstream: 'PUBLICA_CNPJ',
    url: `${env.PUBLICA_CNPJ_BASE_URL}/${cnpj}`,
    schema: publicaCnpjSchema,
    logLabel: 'publica.cnpj.ws/:cnpj',
    timeoutMs: env.PUBLICA_TIMEOUT_MS,
    // API publica e gratuita: uma retentativa, sem martelar.
    maxRetries: 1,
  });
}
