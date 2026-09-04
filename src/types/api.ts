/**
 * Contrato de saida deste middleware (o que os consumidores externos veem).
 *
 * TODO(mapeamento): vazio ate as rotas serem definidas.
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}
