import { useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

const STORAGE_KEY = "husk:sentry-enabled";
type SentryModule = typeof import("@sentry/react");
type SentryClient = ReturnType<SentryModule["init"]>;

function readConsent(): boolean {
  try {
    // Preserve the existing preference for installations without an explicit
    // choice. If storage itself is unavailable, fail closed.
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return false;
  }
}

let enabled = readConsent();
const subscribers = new Set<() => void>();

function publish(value: boolean) {
  if (enabled === value) return;
  enabled = value;
  for (const subscriber of subscribers) subscriber();
}

function onStorage(event: StorageEvent) {
  if (event.key === STORAGE_KEY) publish(event.newValue === "true");
  // Clearing browser storage must not silently re-enable an opted-out client.
  else if (event.key === null) publish(false);
}

export function getSentryEnabled(): boolean {
  return enabled;
}

/** Apply consent in this window immediately, even if persistence fails. */
export function setSentryEnabled(value: boolean): boolean {
  let saved = true;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    saved = false;
  }
  // Do not start reporting on a choice that could not be saved. Opt-out still
  // takes effect in this window even if other windows cannot be notified.
  publish(saved ? value : false);
  return saved;
}

export function subscribeSentryEnabled(subscriber: () => void): () => void {
  if (!subscribers.size) window.addEventListener("storage", onStorage);
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
    if (!subscribers.size) window.removeEventListener("storage", onStorage);
  };
}

export function useSentryEnabled(): boolean {
  return useSyncExternalStore(subscribeSentryEnabled, getSentryEnabled, getSentryEnabled);
}

function scheduleIdle(callback: () => void): () => void {
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(callback, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(callback, 1500);
  return () => globalThis.clearTimeout(id);
}

/** Own one window's SDK lifecycle. Consent is checked before loading, after
 * loading, when preparing an event, and at the transport boundary. Disabling
 * does not wait for the SDK's asynchronous close/flush to turn collection off.
 * Requests already sent before opting out cannot be recalled. */
export function initialiseCrashReporting(options: {
  load?: () => Promise<SentryModule>;
  schedule?: (callback: () => void) => () => void;
  syncNative?: (enabled: boolean) => Promise<unknown>;
} = {}): () => void {
  const load = options.load ?? (() => import("@sentry/react"));
  const schedule = options.schedule ?? scheduleIdle;
  let generation = 0;
  let stopped = false;
  let cancelScheduled: (() => void) | undefined;
  let client: SentryClient;
  const syncNative = options.syncNative ?? ((value: boolean) => isTauri()
    ? invoke("diagnostics_set_reporting_enabled", { enabled: value })
    : Promise.resolve());
  const syncNativeConsent = () => {
    // Send immediately, not after SDK import/idle startup. Native reporting
    // starts disabled and must also honor storage errors and live opt-out.
    void syncNative(getSentryEnabled() && readConsent()).catch(() => {
      console.warn("Native crash-reporting preference could not be synchronized.");
    });
  };
  syncNativeConsent();

  const stopClient = () => {
    ++generation;
    cancelScheduled?.();
    cancelScheduled = undefined;
    const oldClient = client;
    client = undefined;
    if (oldClient) {
      // close() disables only AFTER flushing in the installed SDK. Block first.
      oldClient.getOptions().enabled = false;
      void Promise.resolve(oldClient.close(1)).catch(() => undefined);
    }
  };

  const startClient = () => {
    cancelScheduled = undefined;
    if (stopped || !getSentryEnabled() || !readConsent()) return;
    const version = ++generation;
    const allowed = () => !stopped && version === generation && getSentryEnabled() && readConsent();
    void load().then((Sentry) => {
      if (!allowed()) return;
      client = Sentry.init({
        dsn: "https://0db29941cc9d5b5e72f11f40773f76e9@o4511596996067328.ingest.de.sentry.io/4511597291765840",
        environment: import.meta.env.MODE,
        release: "husk@" + __APP_VERSION__,
        sampleRate: 1.0,
        sendDefaultPii: false,
        sendClientReports: false,
        maxBreadcrumbs: 0,
        // Error reporting only: no navigation/console breadcrumbs, sessions,
        // browser request context, or automatic conversation identifiers.
        integrations: (defaults) => defaults.filter((integration) => [
          "InboundFilters", "EventFilters", "FunctionToString", "BrowserApiErrors",
          "GlobalHandlers", "LinkedErrors", "Dedupe",
        ].includes(integration.name)),
        beforeSend: (event) => {
          if (!allowed()) return null;
          delete event.user;
          delete event.request;
          delete event.extra;
          delete event.breadcrumbs;
          return event;
        },
        transport: (transportOptions) => {
          const transport = Sentry.makeFetchTransport(transportOptions);
          return {
            send: (envelope) => allowed() ? transport.send(envelope) : Promise.resolve({}),
            flush: (timeout) => transport.flush(timeout),
          };
        },
      });
    }).catch(() => {
      if (allowed()) console.warn("Crash reporting could not start.");
    });
  };

  const unsubscribe = subscribeSentryEnabled(() => {
    syncNativeConsent();
    stopClient();
    if (getSentryEnabled()) startClient();
  });
  if (getSentryEnabled()) {
    const scheduledGeneration = generation;
    cancelScheduled = schedule(() => {
      if (generation === scheduledGeneration && !stopped) startClient();
    });
  }

  return () => {
    stopped = true;
    unsubscribe();
    stopClient();
  };
}
