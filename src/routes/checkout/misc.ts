import type { Request, Response } from 'express';

/**
 * makeClusterAlive — porte de `middlewares/makeClusterAlive.ts`.
 * Mantem a mensagem original para nao quebrar quem faz match nela.
 */
export function makeClusterAlive(_req: Request, res: Response): void {
  res.status(200).json({ message: 'Yay! Signup Bridge Cluster is alive!' });
}
