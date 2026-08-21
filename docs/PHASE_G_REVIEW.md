# Phase G integration review

Phase G keeps the Phase A-F trust boundary intact. React projects screens from
authoritative onboarding, assistant-grant/audit, discovery-scope, proposal and
application records. It does not infer approval, application, verification or
recovery success.

## Follow-up decisions

1. **Assistant warnings and questions — safe follow-up.** Application labels and
   framing are localized. Arbitrary assistant or user prose remains visible in
   its original form so translation cannot change authoritative proposal
   meaning. A later backend vocabulary may add stable codes and localized
   explanations without replacing the original text.
2. **Answering proposal questions inside InnPilot — future product/domain
   decision.** There is no typed answer operation today. Adding one safely also
   requires proposal freshness validation, answer provenance, revision or
   supersession and a fresh review. The UI therefore truthfully directs the
   manager to the connected assistant and never edits proposal JSON.
3. **Rollback issue detail — closed for Phase G.** Existing safe application
   fields (`safeFailureCode` and `blockerKeys`) are shown only inside the
   collapsed technical disclosure. Raw logs, paths and document content remain
   excluded.
4. **German and French — safe follow-up.** Only English and Italian are offered.
   The backend and complete production dictionaries do not yet support German
   or French, so the UI does not offer languages it cannot persist completely.
5. **Manual SetupWizard Tailwind authoring — safe follow-up.** The advanced
   fallback inherits the refreshed tokens and retains its tested behavior. A
   component rewrite would add risk without improving this milestone's primary
   flow.

The remaining activity-history items in `phase-g-followups.md` are bounded
follow-ups: expose a safe recent assistant audit list and, later, a stable
merged activity-event vocabulary.

## Phase H: controlled shadow pilot

The next step is observation, not automatic rollout:

`real manager PC -> explicit read-only roots -> structural discovery -> proposal -> stop before apply`

Before starting, preserve the current configuration and script inventory, use
the PC's local Codex agent to compare real workflow rules and paths, name one
manager as the approver, and define a hard stop before the approval button.
Record onboarding time, connection difficulty, manager confusion, discovery
accuracy, missed workflows, false active/archive classification, questions,
proposal accuracy, privacy concerns, support intervention, willingness to
approve and manual-fallback usage.

No real configuration change may be allowed until the proposal contains no
unresolved question, every selected root is manager-approved, current
configuration and onboarding revisions still match, every workflow/path change
has been checked against the manager-PC inventory, the manager can explain the
proposed change, and a tested rollback point exists. A separate explicit pilot
decision is required before any apply.
