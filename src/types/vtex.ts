/**
 * Tipos dos payloads da VTEX.
 *
 * Regra: cada recurso ganha um schema zod (usado para validar a resposta no
 * `vtexRequest`) e o tipo inferido dele — nunca um `any` ou um cast.
 *
 * TODO(mapeamento): vazio ate o de/para ser confirmado. Nada aqui deve ser
 * escrito "de cabeca": os nomes de campo tem que sair de uma resposta real
 * da VTEX ou da documentacao do recurso.
 */
export {};
