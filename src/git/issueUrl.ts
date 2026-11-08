/** CLI output is data, not authority to launch a protocol or local application. */
export function safeIssueUrl(value: unknown, issueNumber: number): string | null {
  if (typeof value !== "string" || !Number.isSafeInteger(issueNumber) || issueNumber <= 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
    if (!new RegExp(`^/[^/]+/[^/]+/issues/${issueNumber}/?$`).test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}
