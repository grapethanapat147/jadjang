/**
 * The browser side of usage counting: fire and forget, and never in the way.
 *
 * Nothing here can throw into the page, nothing waits on the network, and a
 * visitor who has asked not to be tracked sends nothing at all.
 */
import { USAGE_ENDPOINT, sourceBucket, type UsageEvent } from "./usage.ts";

type NavigatorLike = {
  sendBeacon?: (url: string, data: BodyInit) => boolean;
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
  userAgent?: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type UsageEnvironment = {
  navigator?: NavigatorLike;
  fetch?: (url: string, init: RequestInit) => Promise<unknown>;
};

/** Global Privacy Control or Do Not Track switches counting off entirely. */
export function usageAllowed(navigator: NavigatorLike | undefined): boolean {
  if (!navigator) return false;
  if (navigator.globalPrivacyControl === true) return false;
  if (navigator.doNotTrack === "1" || navigator.doNotTrack === "yes") return false;
  return true;
}

function defaultEnvironment(): UsageEnvironment {
  return {
    navigator: typeof navigator === "undefined" ? undefined : (navigator as NavigatorLike),
    fetch: typeof fetch === "undefined" ? undefined : fetch,
  };
}

/**
 * Sends one event. Text/plain rather than JSON so sendBeacon never refuses it
 * for an unsafelisted content type; the server parses the text either way.
 * Returns whether a send was attempted, for the tests.
 */
export function reportUsage(event: UsageEvent, environment: UsageEnvironment = defaultEnvironment()): boolean {
  try {
    if (!usageAllowed(environment.navigator)) return false;
    const body = JSON.stringify(event);

    if (typeof environment.navigator?.sendBeacon === "function") {
      const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      if (environment.navigator.sendBeacon(USAGE_ENDPOINT, blob)) return true;
    }
    if (environment.fetch) {
      void environment.fetch(USAGE_ENDPOINT, {
        method: "POST",
        body,
        keepalive: true,
        headers: { "content-type": "text/plain;charset=UTF-8" },
      }).catch(() => undefined);
      return true;
    }
  } catch {
    // Counting is never worth an error in front of the user.
  }
  return false;
}

export const VISIT_FLAG_KEY = "jadjang-visit-counted";

/**
 * One visit per tab session. The flag stays in this tab's sessionStorage and
 * is never sent — it only stops a reload counting as a second visitor.
 */
export function reportVisitOnce(
  context: { referrer: string; host: string; storage: StorageLike | null | undefined },
  environment: UsageEnvironment = defaultEnvironment(),
): boolean {
  try {
    if (context.storage?.getItem(VISIT_FLAG_KEY)) return false;
  } catch {
    // Storage blocked: count this load and move on.
  }

  const sent = reportUsage(
    {
      kind: "visit",
      source: sourceBucket({
        referrer: context.referrer,
        host: context.host,
        userAgent: environment.navigator?.userAgent ?? "",
      }),
    },
    environment,
  );

  if (sent) {
    try {
      context.storage?.setItem(VISIT_FLAG_KEY, "1");
    } catch {
      // Same as above: the worst case is one extra visit counted.
    }
  }
  return sent;
}
