/** Bound the React-rendered log separately from the native job's output ring.
 * A long-running job can otherwise grow one unbounded string for days. */
export const MAX_JOB_LOG_CHARS = 128 * 1024;

export function appendJobLogTail(previous: string, incoming: string): { text: string; trimmed: boolean } {
  const trimmed = previous.length + incoming.length > MAX_JOB_LOG_CHARS;
  if (incoming.length >= MAX_JOB_LOG_CHARS) {
    return { text: incoming.slice(-MAX_JOB_LOG_CHARS), trimmed };
  }
  const previousLimit = MAX_JOB_LOG_CHARS - incoming.length;
  return {
    text: previous.slice(-previousLimit) + incoming,
    trimmed,
  };
}
