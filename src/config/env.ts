import { z } from 'zod';

/**
 * Schema das variaveis de ambiente. Validado uma unica vez no boot:
 * se faltar (ou vier invalida) qualquer credencial, o processo morre
 * antes de subir o servidor.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // Credenciais VTEX
  VTEX_APPKEY: z.string().min(1, 'VTEX_APPKEY e obrigatoria'),
  VTEX_APPTOKEN: z.string().min(1, 'VTEX_APPTOKEN e obrigatoria'),
  VTEX_ACCOUNT: z.string().min(1, 'VTEX_ACCOUNT e obrigatoria'),
  VTEX_BASE_URL: z
    .string()
    .url('VTEX_BASE_URL precisa ser uma URL valida')
    // normaliza: sem barra no final, para concatenar paths sem surpresa
    .transform((url) => url.replace(/\/+$/, '')),

  /**
   * Chave que protege as rotas NAO publicas.
   *
   * Opcional: quase todas as rotas sao publicas (o checkout e os componentes
   * React da loja chamam direto do navegador, onde uma chave nao seria
   * segredo). Sem API_KEY definida, as poucas rotas protegidas respondem
   * 503 SERVICE_NOT_CONFIGURED em vez de derrubar o boot.
   */
  API_KEY: z
    .string()
    .min(16, 'API_KEY precisa ter ao menos 16 caracteres')
    .optional(),

  /**
   * Integracoes externas herdadas do app VTEX IO. Opcionais: sem elas o
   * servico sobe normalmente e apenas as rotas que dependem delas respondem
   * 503 SERVICE_NOT_CONFIGURED, em vez de derrubar o boot inteiro.
   *
   * ATENCAO: no app original esses valores estavam HARDCODED no fonte
   * (clients/sintegra.ts e middlewares/getEmployee.ts). Foram movidos para ca
   * e devem ser rotacionados — os antigos estao no historico do outro repo.
   */
  SINTEGRA_TOKEN: z.string().min(1).optional(),
  SINTEGRA_BASE_URL: z
    .string()
    .url()
    .default('https://www.sintegraws.com.br/api/v1/execute-api.php'),

  SEARA_ENDPOINT: z.string().url().optional(),
  SEARA_USER: z.string().min(1).optional(),
  SEARA_KEY: z.string().min(1).optional(),
  SEARA_COOKIE: z.string().optional(),

  // Opcionais com default
  CORS_ORIGINS: z.string().default('*'),
  VTEX_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  VTEX_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const detalhes = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    // console.error de proposito: o logger depende de env, que acabou de falhar.
    console.error(`Variaveis de ambiente invalidas:\n${detalhes}`);
    process.exit(1);
  }

  return parsed.data;
}

export const env: Env = loadEnv();

/** Origens permitidas no CORS. `true` = qualquer origem. */
export function corsOrigins(): true | string[] {
  const raw = env.CORS_ORIGINS.trim();
  if (raw === '*' || raw === '') return true;
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
