import type { Request, Response } from 'express';

/**
 * makeClusterAlive — porte de `middlewares/makeClusterAlive.ts`.
 * Mantem a mensagem original para nao quebrar quem faz match nela.
 */
export function makeClusterAlive(_req: Request, res: Response): void {
  res.status(200).json({ message: 'Yay! Signup Bridge Cluster is alive!' });
}

/**
 * getDataRamdom — porte de `middlewares/getDataRamdom.ts`.
 * No app original a rota so carregava as settings do app e devolvia
 * `{ok: 'ok'}`; sem VTEX IO nao ha settings para carregar, entao restou a
 * resposta fixa. Era, na pratica, um segundo health check.
 */
export function getDataRamdom(_req: Request, res: Response): void {
  res.set('Cache-Control', 'no-cache, no-store');
  res.status(200).json({ ok: 'ok' });
}
