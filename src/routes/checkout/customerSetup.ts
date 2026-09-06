import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { logger } from '../../config/logger.js';
import { isValidCnpj, verifyCnpj } from '../../mappers/cnpj.js';
import { isMasked } from '../../mappers/corporateProfile.js';
import { toShippingAddress } from '../../mappers/savedAddress.js';
import { applyCorporateToOrderForm } from '../../services/checkout/applyCorporate.js';
import { fetchCnpjSources } from '../../services/documents/cnpjSources.js';
import {
  clearShippingData,
  getOrderForm,
  orderFormIdSchema,
  sendAttachment,
} from '../../services/vtex/checkout.js';
import { findAddresses, findClient } from '../../services/vtex/masterdata.js';
import { AppError } from '../../services/vtex/errors.js';

/**
 * `POST /middleware/checkout/customer-setup`
 *
 * Chamada uma vez, logo apos o login: identifica quem e o cliente e **prepara
 * o orderForm** de acordo com a regra de negocio da loja.
 *
 * ---------------------------------------------------------------------------
 * A REGRA
 * ---------------------------------------------------------------------------
 * - **Pessoa fisica** cadastra UM endereco e compra sempre nele. No login
 *   seguinte o endereco salvo (entidade AD) volta para o `shippingData`, e o
 *   front desabilita os campos.
 * - **Pessoa juridica** compra sempre no endereco da Junta Comercial. O CNPJ
 *   fica gravado na CL (`corporateDocument`), entao o cliente nao digita de
 *   novo: a rota consulta, revalida e grava.
 * - **Cliente novo** nao tem nada gravado: os campos ficam liberados.
 *
 * `addressLocked` na resposta e o que o front usa para decidir o que travar —
 * a rota devolve a decisao, o front so reage.
 *
 * ---------------------------------------------------------------------------
 * REQUEST
 * ---------------------------------------------------------------------------
 * ```json
 * { "orderFormId": "cc551425e8a445878344b79b79c48f6d" }
 * ```
 * `email` e opcional: por padrao sai do `clientProfileData` do orderForm.
 *
 * ---------------------------------------------------------------------------
 * RESPONSE 200 — pessoa fisica com endereco salvo
 * ---------------------------------------------------------------------------
 * ```json
 * {
 *   "customerType": "personal",
 *   "addressLocked": true,
 *   "addressCount": 1,
 *   "clientId": "fe5bcb60-...",
 *   "written": { "shippingAddress": { "postalCode": "22471211", "street": "Rua ...", "number": "41" } },
 *   "durationMs": 412
 * }
 * ```
 *
 * RESPONSE 200 — pessoa juridica recorrente
 * ```json
 * {
 *   "customerType": "corporate",
 *   "addressLocked": true,
 *   "cnpj": "50972373000100",
 *   "verification": { "approved": true, "..." : "..." },
 *   "written": { "clientProfileData": {}, "shippingAddress": {}, "customData": {} },
 *   "sources": {}, "cache": {}, "durationMs": 1029
 * }
 * ```
 *
 * RESPONSE 200 — CNPJ do cadastro reprovado (ex.: empresa baixada)
 * ```json
 * {
 *   "customerType": "corporate",
 *   "addressLocked": false,
 *   "cnpj": "...",
 *   "verification": { "approved": false, "reason": "REGISTRATION_INACTIVE", "message": "..." },
 *   "durationMs": 980
 * }
 * ```
 * Nada e gravado: o cliente precisa resolver a situacao cadastral. `written`
 * nao vem.
 *
 * RESPONSE 200 — cliente novo, ou PF sem endereco salvo
 * ```json
 * { "customerType": "new", "addressLocked": false, "addressCount": 0, "durationMs": 180 }
 * ```
 *
 * ERROS
 * - `400 VALIDATION_ERROR`     `orderFormId` fora do formato
 * - `400 MISSING_CLIENT_EMAIL` sem e-mail no orderForm nem no corpo
 */
const customerSetupBody = z.object({
  orderFormId: orderFormIdSchema,
  email: z.string().email().optional(),
});

/** Campos da CL que decidem o caminho. */
const CL_FIELDS = [
  'id',
  'email',
  'firstName',
  'lastName',
  'isCorporate',
  'corporateDocument',
  'corporateName',
] as const;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export const customerSetup = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const { orderFormId, email: emailOverride } = customerSetupBody.parse(req.body);

  const orderForm = await getOrderForm(orderFormId);
  const currentProfile = orderForm?.clientProfileData ?? null;

  const profileEmail = currentProfile?.['email'];
  const email =
    emailOverride ??
    (typeof profileEmail === 'string' && !isMasked(profileEmail) ? profileEmail : undefined);

  if (email === undefined) {
    throw new AppError(
      400,
      'MISSING_CLIENT_EMAIL',
      'Sem e-mail no orderForm nem na requisicao: nao ha como identificar o cliente',
    );
  }

  const clients = await findClient({ email, fields: CL_FIELDS });
  const client = clients[0] ?? null;
  const clientId = text(client?.['id']);

  // ---------------------------------------------------------------------
  // Cliente novo: nada cadastrado, nada a preparar. O front libera os campos.
  // ---------------------------------------------------------------------
  if (client === null || clientId === null) {
    logger.info({ orderFormId }, 'Cliente sem cadastro na CL; checkout segue livre');

    res.status(200).json({
      customerType: 'new',
      addressLocked: false,
      addressCount: 0,
      clientId: null,
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  const cnpj = text(client['corporateDocument'])?.replace(/\D/g, '') ?? null;
  const isCorporate = client['isCorporate'] === true && cnpj !== null && isValidCnpj(cnpj);

  // ---------------------------------------------------------------------
  // Pessoa juridica: o CNPJ esta no cadastro, entao o cliente nao digita de
  // novo. Revalidamos mesmo assim — o cache torna barato, e uma empresa pode
  // ter sido baixada desde a ultima compra. Situacao cadastral e o que decide
  // se a venda passa.
  // ---------------------------------------------------------------------
  if (isCorporate && cnpj !== null) {
    const { sources, statuses, cache } = await fetchCnpjSources(cnpj);
    const verification = verifyCnpj({ cnpj, sources, statuses, fallbackEmail: email });

    if (!verification.approved) {
      logger.info(
        { orderFormId, cnpj, reason: verification.reason },
        'CNPJ do cadastro reprovado; orderForm intacto',
      );

      res.status(200).json({
        customerType: 'corporate',
        addressLocked: false,
        // Nao se aplica a PJ: o endereco vem da Junta Comercial, nao da lista
        // do cliente. Vai `null` em vez de sumir — a forma da resposta e a
        // mesma para os tres tipos.
        addressCount: null,
        clientId,
        cnpj,
        verification,
        sources: statuses,
        cache,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    // Os dados de PF vem da CL: no login o orderForm ainda pode nao ter o
    // `clientProfileData` preenchido, e o cadastro e a fonte de verdade.
    const written = await applyCorporateToOrderForm({
      orderFormId,
      verification,
      currentProfile,
      personal: {
        email,
        firstName: text(client['firstName']) ?? undefined,
        lastName: text(client['lastName']) ?? undefined,
      },
    });

    res.status(200).json({
      customerType: 'corporate',
      addressLocked: true,
      addressCount: null,
      clientId,
      cnpj,
      verification,
      written,
      sources: statuses,
      cache,
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  // ---------------------------------------------------------------------
  // Pessoa fisica: um endereco so, o cadastrado. `createdIn ASC` e a mesma
  // ordem que define o `current_address_id` do ERP — o primeiro e o dele.
  // ---------------------------------------------------------------------
  const addresses = await findAddresses(clientId);

  if (addresses.length === 0) {
    logger.info({ orderFormId, clientId }, 'Cliente PF sem endereco salvo; checkout segue livre');

    res.status(200).json({
      customerType: 'personal',
      addressLocked: false,
      addressCount: 0,
      clientId,
      durationMs: Date.now() - startedAt,
    });
    return;
  }

  const receiverName =
    [text(client['firstName']), text(client['lastName'])]
      .filter((part): part is string => part !== null)
      .join(' ') || null;

  const shippingAddress = toShippingAddress(addresses[0] as Record<string, unknown>, {
    receiverName,
  });

  // Limpa antes de gravar: o orderForm pode ter sobrado com o endereco de uma
  // sessao anterior, e ele nao pode competir com o cadastrado.
  await clearShippingData(orderFormId);
  await sendAttachment({
    orderFormId,
    attachmentId: 'shippingData',
    payload: {
      selectedAddresses: [shippingAddress],
      clearAddressIfPostalCodeNotFound: false,
    },
  });

  const durationMs = Date.now() - startedAt;

  logger.info(
    { orderFormId, clientId, addressCount: addresses.length, durationMs },
    'Endereco salvo do cliente aplicado ao orderForm',
  );

  res.status(200).json({
    customerType: 'personal',
    addressLocked: true,
    addressCount: addresses.length,
    clientId,
    written: { shippingAddress },
    durationMs,
  });
});
