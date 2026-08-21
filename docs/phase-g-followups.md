# Phase G — follow-ups for Codex

## 0. Assistant "session started" signal (deferred design decision)

**Status:** deliberately not implemented. Recorded here because it changes
security/audit semantics.

InnPilot cannot observe that an assistant has attached. The helper's startup
path (`local_mcp::run_stdio` → `LocalMcpFacade::authorize`) validates the grant
and returns it *without writing anything*; `append_audit` has exactly one call
site, the tool-invocation wrapper, and it is also the only thing that sets
`LocalGrant::last_activity_at`. So a completed MCP handshake leaves no trace,
and `lastActivityAt` / `lastClientName` / `lastProtocolVersion` stay null until
a tool actually runs.

The user-visible symptom: Codex reports a live connection while InnPilot said
"not connected". Both were true under different definitions of the word.

The frontend now tells the truth instead of guessing, via
`src/assistantConnection.ts`:

| State | Meaning |
| --- | --- |
| `notConfigured` | No usable grant (never created, or revoked). |
| `accessReady` | Grant valid, but no audited tool activity yet. |
| `connected` | The audit log proves an assistant has called InnPilot. |
| `reconnectRequired` | Grant exists but is past expiry. |

That closes the misleading-copy problem but not the underlying blindness. If we
want InnPilot to distinguish "attached and idle" from "never attached", the
backend has to record a session-start signal — for example updating
`last_activity_at`, or appending a dedicated audit event, when `authorize`
succeeds during helper startup or on MCP `initialize`.

**Why it was not done here:** the audit log is a security artefact. Today every
entry means "an assistant invoked a capability", and each carries a tool name,
success flag and error code. Writing entries for connection attempts changes
what the log asserts, adds an unauthenticated-until-validated write path at
process start, and gives a way to grow the audit file without ever calling a
tool (rate limiting currently sits in the tool wrapper, not in `authorize`).
Those are ownership decisions about the security model, not UI polish.

**If taken up, decide:** whether a session start is an audit event or only a
grant-field update; whether it is rate-limited; whether a failed `authorize`
(wrong installation, expired, revoked) is also recorded, since that is the
diagnostically useful case; and whether `LocalAgentConnectionStatus` grows a
field so the frontend can separate "attached" from "has done work" rather than
collapsing both into `connected`.

---


Items the UI milestone deliberately did not implement because they need a
backend or domain change. None of these were worked around in React.

## 1. Proposal warnings and questions are untranslated pass-through text

`ManagerSetupProposalView.warnings` and `.unresolvedQuestions` are free-form
strings produced by the assistant and stored verbatim. The review screen renders
them as-is, so on an Italian installation they appear in whatever language the
agent wrote them. Everything else on that screen is localised.

**Needed:** either a stable machine-readable code per warning/question that the
frontend can map to localised copy, or backend-side localisation of those
strings using the persisted `config.language`.

Until then the review screen shows a localised group heading ("Da controllare")
above English body text.

## 2. Question stage cannot be answered in InnPilot

`OnboardingState::needsUserInput` tells us the assistant is blocked on a
business decision, and the proposal carries the question text, but there is no
command to submit an answer. The stage screen therefore explains the situation
and asks the manager to answer through their assistant, then re-reads state.

**Needed:** a review-only command to record a manager answer against a proposal
question (and a corresponding MCP read path so the assistant can pick it up).
This is what would let the brief's "one question at a time, then simple choices"
flow actually be answered in-product.

## 3. Verified rollback detail is resolved for Phase G

The protected Phase F application record already exposes bounded
`safeFailureCode` and `blockerKeys` values. Phase G now shows those values only
inside the collapsed technical disclosure on rollback/failure screens. Raw
logs, paths and document content remain excluded.

Richer business-facing issue copy can be added later from stable error codes;
no empty "Review issue" action is shown.

## 4. German and French cannot be offered yet

The i18n layer is now a dictionary registry: a language is one `product.<lang>.ts`
plus one `<lang>.ts`, composed in `src/i18n/index.tsx`, and
`assertCompleteTranslations()` covers every registered dictionary.

They are not registered because `save_app_language` validates what it persists
and accepts only `en` / `it`. The frontend must not offer a language the backend
will reject.

**Needed:** widen the backend language enum, then add the two dictionary files.
Deliberately not machine-translated in this milestone.

## 5. Assistant activity is a single data point

The Assistant page shows "recent assistant activity", but
`LocalAgentConnectionStatus` carries only the latest audit event
(`lastActivityAt`, `lastTool`, `lastClientName`). The audit log itself is not
exposed to the frontend.

**Needed:** a read-only command returning the recent audit entries, so the page
can show a short list of what the assistant actually did rather than one line.

## 6. Activity events are titled from workflow names

`ActivityPage` composes human sentences ("Invoices completed") from
`workflowTitle` + `status`. That works for the current workflow set, but
non-workflow events the brief mentions — "Folder access approved",
"Configuration updated", "Setup verified", "Assistant checked setup" — are not
in `get_activity_history`; they live in the onboarding event log
(`OnboardingSnapshot.events`) with `code` / `fromState` / `toState`.

**Needed:** either a merged activity feed, or a stable event-code vocabulary on
the onboarding events so the frontend can render them as sentences without
guessing from state-transition names.

## 7. The setup wizard is still authored in Tailwind utilities

Not a backend item, but the one remaining piece of the old authoring style.
`SetupWizard.tsx` (~2,200 lines) carries ~90 utility-class call sites. The token
layer it consumes was retuned and the glass idioms neutralised, so it matches
visually, but it is not built from the `ip-*` component set like the rest of the
product. Worth converting when that file is next touched for behavioural
reasons.
