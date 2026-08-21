import type { OnboardingSnapshot, OnboardingState } from "../onboarding";

const READY_STATES = new Set<OnboardingState>([
  "ready",
  "readyLegacy",
  "readyWithDeferredItems",
]);

/** The installation is historically ready and has no open lifecycle session. */
export function isOnboardingReady(snapshot: OnboardingSnapshot) {
  return isOnboardingStateReady(snapshot) && snapshot.activeSession === null;
}

/** Backend semantic readiness, including the short terminal hand-off window. */
export function isOnboardingStateReady(snapshot: OnboardingSnapshot) {
  return READY_STATES.has(snapshot.state);
}

/**
 * Presentation-only routing for the onboarding journey.
 *
 * A fresh/incomplete installation must stay in the journey. Once a journey has
 * actually been shown, its authoritative Ready screen stays visible until the
 * manager chooses to leave. An installation that was already ready at launch
 * (including readyLegacy) bypasses onboarding.
 */
export function shouldShowOnboardingJourney(
  snapshot: OnboardingSnapshot,
  journeyEntered: boolean,
  leftJourney: boolean,
) {
  return !isOnboardingStateReady(snapshot) || (journeyEntered && !leftJourney);
}
