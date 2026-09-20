/**
 * Event context boundary (Phase 0 placeholder).
 *
 * Per CLAUDE.md, GitHub Actions must never be modeled with a single fake
 * universal context. Later phases will implement per-event context builders
 * (ref behavior, head/base relationship, fork/trust state, inputs, actor class)
 * for each supported event.
 *
 * Phase 0 only declares the supported-event boundary as data. No context is
 * built here yet, and no scenario is generated. Unsupported events must
 * eventually surface as UNKNOWN rather than being silently treated as safe.
 */

/** Events CIProof intends to model in v0.1. */
export const SUPPORTED_EVENTS = [
  "push",
  "pull_request",
  "pull_request_target",
  "workflow_dispatch",
] as const;

/** A GitHub event CIProof supports modeling in v0.1. */
export type SupportedEvent = (typeof SUPPORTED_EVENTS)[number];

/** Narrowing helper for the supported-event boundary. */
export function isSupportedEvent(event: string): event is SupportedEvent {
  return (SUPPORTED_EVENTS as readonly string[]).includes(event);
}
