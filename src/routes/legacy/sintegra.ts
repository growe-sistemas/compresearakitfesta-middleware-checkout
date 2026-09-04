import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { AppError } from '../../services/vtex/errors.js';
import {
  getCnpjFromRF,
  getCnpjFromSN,
  getCpf,
  type SintegraResponse,
} from '../../services/sintegra/client.js';

/**
 * Rotas getDataSintegra{RF,SN,ST,CPF} — porte de
 * `middlewares/getDataSintegra*.ts`.
 *
 * Regra de negocio do original preservada: a Sintegra responde 200 mesmo em
 * erro, sinalizando pelo campo `code`. `code !== '0'` vira erro:
 *   - com `message` -> 403 com a mensagem do provedor
 *   - sem `message` -> 408 "O servico demorou muito para responder."
 */
function assertSintegraOk(res: SintegraResponse): SintegraResponse {
  if (res.code === '0') return res;

  if (res.message !== undefined && res.message !== '') {
    throw new AppError(403, 'SINTEGRA_REJECTED', res.message);
  }

  throw new AppError(408, 'SINTEGRA_TIMEOUT', 'O serviço demorou muito para responder.');
}

const cnpjParams = z.object({ cnpj: z.string().min(1) });
const cpfParams = z.object({ cpf: z.string().min(1), date: z.string().min(1) });

export const getDataSintegraRF = asyncHandler(async (req, res) => {
  const { cnpj } = cnpjParams.parse(req.params);
  res.status(200).json(assertSintegraOk(await getCnpjFromRF(cnpj)));
});

export const getDataSintegraSN = asyncHandler(async (req, res) => {
  const { cnpj } = cnpjParams.parse(req.params);
  res.status(200).json(assertSintegraOk(await getCnpjFromSN(cnpj)));
});

/**
 * ATENCAO — porte fiel de um bug do original:
 * `middlewares/getDataSintegraST.ts` chama `clients.sintegra.cnpj.getDataFromRF`,
 * ou seja, a rota ST devolve dados do plugin RF. O `getDataFromST` existia no
 * client e nunca era usado.
 *
 * Mantido como esta para nao mudar a resposta de quem ja consome. Para
 * corrigir, troque por `getCnpjFromST` (ja implementado em
 * `services/sintegra/client.ts`).
 */
export const getDataSintegraST = asyncHandler(async (req, res) => {
  const { cnpj } = cnpjParams.parse(req.params);
  res.status(200).json(assertSintegraOk(await getCnpjFromRF(cnpj)));
});

export const getDataSintegraCPF = asyncHandler(async (req, res) => {
  const { cpf, date } = cpfParams.parse(req.params);
  // O original normaliza a data para so digitos antes de consultar.
  const birthDate = date.replace(/[^0-9]/g, '');

  const data = assertSintegraOk(await getCpf(cpf, birthDate));

  res.set('Cache-Control', 'public, max-age=3600'); // 1 hora, como no original
  res.status(200).json(data);
});
