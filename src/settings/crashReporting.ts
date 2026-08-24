const STORAGE_KEY = "husk:sentry-enabled";

export function getSentryEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function setSentryEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // A locked-down webview can reject storage; reporting remains best effort.
  }
}
