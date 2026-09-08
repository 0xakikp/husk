/** One owner per conversation, independent of how many composer views exist. */
export type AiRequest = {
  id: string;
  sessionId: string;
  controller: AbortController;
};

const active = new Map<string, AiRequest>();
let sequence = 0;

export function beginAiRequest(sessionId: string): AiRequest | null {
  if (active.has(sessionId)) return null;
  const request = { sessionId, id: `reply-${Date.now()}-${++sequence}`, controller: new AbortController() };
  active.set(sessionId, request);
  return request;
}

export function isCurrentAiRequest(request: AiRequest): boolean {
  return active.get(request.sessionId) === request && !request.controller.signal.aborted;
}

export function finishAiRequest(request: AiRequest): void {
  if (active.get(request.sessionId) === request) active.delete(request.sessionId);
}

export function cancelAiRequest(request: AiRequest): void {
  request.controller.abort();
  finishAiRequest(request);
}

export function assertAiRequest(request: AiRequest): void {
  if (!isCurrentAiRequest(request)) throw new DOMException("Request stopped", "AbortError");
}
