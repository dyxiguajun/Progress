import type { IncomingMessage, ServerResponse } from 'node:http';
export function createCodexMiddleware(): { handler: (req: IncomingMessage, res: ServerResponse, next?: () => void) => Promise<void>; close: () => void; agent: unknown };
