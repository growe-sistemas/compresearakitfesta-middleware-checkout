/**
 * Erro de aplicacao com status HTTP proprio do middleware.
 * Tudo que chega no errorHandler cai em AppError ou vira 500 generico.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    options?: { details?: unknown; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (options?.details !== undefined) this.details = options.details;
  }
}

/** Servicos externos que este middleware consome. */
export type Upstream = 'VTEX' | 'SINTEGRA' | 'SEARA';

/** Falha ao falar com um upstream (rede, timeout ou status de erro). */
export class UpstreamError extends AppError {
  readonly upstream: Upstream;
  /** Status devolvido pelo upstream, quando houve resposta. */
  readonly upstreamStatus?: number;
  /** Corpo cru devolvido (truncado), para diagnostico. */
  readonly upstreamBody?: string;

  constructor(
    upstream: Upstream,
    status: number,
    code: string,
    message: string,
    options?: {
      upstreamStatus?: number;
      upstreamBody?: string;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(status, code, message, options);
    this.name = 'UpstreamError';
    this.upstream = upstream;
    if (options?.upstreamStatus !== undefined) this.upstreamStatus = options.upstreamStatus;
    if (options?.upstreamBody !== undefined) this.upstreamBody = options.upstreamBody;
  }
}

/**
 * Mapeia o status do upstream para o status que este middleware devolve.
 *
 *  400  -> 502  requisicao que NOS montamos saiu errada
 *  401  -> 502  credenciais do middleware invalidas (nao e culpa do cliente)
 *  403  -> 502  credencial sem permissao no recurso
 *  404  -> 404  recurso realmente nao existe
 *  408  -> 504  timeout no upstream
 *  429  -> 503  rate limit apos esgotar os retries
 *  5xx  -> 502  upstream quebrado
 */
export function mapUpstreamStatus(upstreamStatus: number): number {
  switch (upstreamStatus) {
    case 404:
      return 404;
    case 408:
      return 504;
    case 429:
      return 503;
    default:
      // 400/401/403 e 5xx: para quem chama este middleware, e sempre
      // "o upstream nao entregou" -> 502.
      return 502;
  }
}

/** Codigo de erro estavel exposto no corpo da resposta. */
export function upstreamErrorCode(upstream: Upstream, upstreamStatus: number): string {
  switch (upstreamStatus) {
    case 400:
      return `${upstream}_BAD_REQUEST`;
    case 401:
    case 403:
      return `${upstream}_UNAUTHORIZED`;
    case 404:
      return `${upstream}_NOT_FOUND`;
    case 408:
      return `${upstream}_TIMEOUT`;
    case 429:
      return `${upstream}_RATE_LIMITED`;
    default:
      return upstreamStatus >= 500 ? `${upstream}_UPSTREAM_ERROR` : `${upstream}_ERROR`;
  }
}

/**
 * Integracao externa sem credencial configurada (as que no app VTEX IO
 * estavam hardcoded no fonte).
 */
export function notConfigured(what: string, envVars: readonly string[]): AppError {
  return new AppError(
    503,
    'SERVICE_NOT_CONFIGURED',
    `Integracao "${what}" nao configurada: defina ${envVars.join(', ')}`,
  );
}
