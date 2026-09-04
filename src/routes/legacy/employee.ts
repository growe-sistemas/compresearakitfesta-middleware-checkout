import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { mapEmployee } from '../../mappers/employee.js';
import { getEmployeeRow, getToken } from '../../services/seara/client.js';

const cpfParams = z.object({ cpf: z.string().min(1) });

/**
 * getEmployee — porte de `middlewares/getEmployee.ts`.
 *
 * Fluxo em dois passos contra a integracao "controle" da Seara: autentica
 * (XML) e consulta o CPF (XML). Falha de autenticacao responde 200 com
 * `error: true`, como no original — o front trata esse formato.
 */
export const getEmployee = asyncHandler(async (req, res) => {
  const { cpf } = cpfParams.parse(req.params);

  const token = await getToken();

  if (token === null) {
    res.status(200).json({
      error: true,
      message:
        'Ops! Ocorreu um problema na autenticação do sistema. Tente novamente em alguns minutos.',
    });
    return;
  }

  const row = await getEmployeeRow(token, cpf);

  res.set('Cache-Control', 'no-cache, no-store');
  res.status(200).json(mapEmployee(row));
});
