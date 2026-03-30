/**
 * Scanner "session" start time — one value per full page load.
 *
 * Dashboard used `useState(new Date())` for session start. Under React 18
 * StrictMode (dev), the component mounts → unmounts → remounts, so that
 * pattern creates a *second*, later timestamp on remount. The leaderboard
 * store is a module singleton and keeps tokens added on the first mount with
 * older `calledAt` values. SessionStats then filters `calledAt >= sessionStart`
 * and drops every token. This helper fixes that by pinning the epoch on first use.
 */

let sessionStartMs = null;

export function getOrCreateSessionStart() {
  if (sessionStartMs == null) {
    sessionStartMs = Date.now();
  }
  return new Date(sessionStartMs);
}
