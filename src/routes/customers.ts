import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../config/logger.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { createDocument, searchDocuments, updateDocument } from '../services/vtex/masterdata.js';
import { convertDate } from './checkout/masterdata.js';

/**
 * Rotas de cliente que NAO sao porte do app VTEX IO.
 *
 * A `setInfo/:email/:birthDate` so consegue atualizar: quando o
 * e-mail nao tem documento CL ela responde `updated: false` e a data se perde.
 * Isso acontece justamente com quem esta comprando pela primeira vez.
 * A rota daqui fecha esse buraco fazendo o upsert.
 *
 * A `setInfo` nao foi alterada de proposito: a paridade dela com o contrato
 * que o front ja consome e o que sustenta o plano de migracao.
 */
export const customersRouter: Router = Router();

/** `dd-MM-yyyy`, o mesmo formato que a `setInfo` ja recebe. */
const birthDateBody = z.object({
  email: z.string().min(1),
  birthDate: z.string().regex(/^\d{2}-\d{2}-\d{4}$/, 'birthDate deve estar em dd-MM-yyyy'),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

/**
 * `POST /middleware/checkout/customers/birth-date`
 *
 * Grava a data de nascimento na entidade CL, criando o documento se ele ainda
 * nao existir. Publica, como toda a familia `/middleware/checkout/*`: quem
 * chama e o app do checkout, onde uma chave em bundle nao seria segredo.
 *
 * Resposta 200:
 *   { updated: true, created: false, id }  documento ja existia, sofreu PATCH
 *   { updated: true, created: true,  id }  documento foi criado agora
 */
customersRouter.post(
  '/middleware/checkout/customers/birth-date',
  asyncHandler(async (req, res) => {
    const { email, birthDate, firstName, lastName } = birthDateBody.parse(req.body);

    // Mesma conversao da `setInfo`: dd-MM-yyyy -> yyyy-MM-ddT00:00:00+00:00.
    const isoBirthDate = `${convertDate(birthDate)}T00:00:00+00:00`;

    const documents = await searchDocuments('CL', ['id'], `email=${email}`, {
      page: 1,
      pageSize: 1,
    });

    const id = documents[0]?.['id'];

    if (typeof id === 'string' && id !== '') {
      // O `email` vai junto porque a CL exige o campo obrigatorio mesmo em
      // atualizacao parcial — senao a VTEX devolve 400 "Required field".
      await updateDocument('CL', id, { email, birthDate: isoBirthDate });

      logger.info(
        { email, id, birthDate: isoBirthDate, operation: 'update' },
        'Cliente CL ATUALIZADO: data de nascimento gravada',
      );

      res.status(200).json({ updated: true, created: false, id });
      return;
    }

    // Cliente ainda sem cadastro no Master Data. Cria o minimo: `email` e a
    // chave unica da CL, e nome quando o checkout ja tiver coletado.
    //
    // O CPF fica fora de proposito. Ele tambem e unico na CL, entao um valor
    // ja usado por outro documento derrubaria a criacao inteira com 400 — e
    // perder a data de nascimento por causa disso seria pior que grava-la sem
    // o documento. O proprio checkout completa o cadastro depois.
    const created = await createDocument('CL', {
      email,
      birthDate: isoBirthDate,
      ...(firstName !== undefined ? { firstName } : {}),
      ...(lastName !== undefined ? { lastName } : {}),
    });

    const createdId = created.Id ?? created.DocumentId ?? null;

    logger.info(
      { email, id: createdId, birthDate: isoBirthDate, operation: 'create', firstName, lastName },
      'Cliente CL CRIADO: nao havia cadastro para este e-mail',
    );

    res.status(200).json({ updated: true, created: true, id: createdId });
  }),
);
