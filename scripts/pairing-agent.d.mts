import type { IncomingMessage, ServerResponse } from 'node:http';
export function createPairingMiddleware(codex: unknown): { handler: (req: IncomingMessage, res: ServerResponse, next?: () => void) => Promise<void>; close: () => void };
