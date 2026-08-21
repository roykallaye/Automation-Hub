# Phase G — follow-ups for Codex

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
