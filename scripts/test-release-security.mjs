import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { evaluateReleaseSecurity, normalizeThumbprint } from "./release-security.mjs";

const roles = ["windows_installer", "desktop_application", "automation_worker"];

function readyPolicy() {
  return {
    schema: "innpilot-release-policy-v1",
    authenticode: {
      expectedPublisherSubject: "CN=InnPilot Software SRL, O=InnPilot Software SRL, C=IT",
      allowedSignerThumbprints: ["AA BB CC DD"],
      requireTrustedTimestamp: true,
    },
    update: {
      clientIntegrated: true,
      endpoint: "https://updates.example.com/innpilot/stable.json",
      publicKey: "RWQK4wA7bVx6nL3uC2mS1pD9fH8jE5tY0qZrG6kN",
      signatureVerificationTested: true,
      stagedRolloutTested: true,
      rollbackTested: true,
    },
    approvals: {
      ocrRuntimeNoticesApproved: true,
      ocrRuntimeNoticesEvidence: "legal-review-2026-001",
      privacyAndDpaApproved: true,
      privacyAndDpaEvidence: "privacy-review-2026-001",
      supervisedPilotAccepted: true,
      supervisedPilotEvidence: "pilot-acceptance-2026-001",
    },
  };
}

function validEvidence() {
  return roles.map((role) => ({
    role,
    status: "Valid",
    signerSubject: "CN=InnPilot Software SRL, O=InnPilot Software SRL, C=IT",
    signerThumbprint: "AABBCCDD",
    timestamped: true,
  }));
}

test("normalizes certificate thumbprints before comparison", () => {
  assert.equal(normalizeThumbprint("aa bb:cc-dd"), "AABBCCDD");
});

test("the checked-in policy fails closed with named commercial blockers", () => {
  const policy = JSON.parse(readFileSync("release/release-policy.json", "utf8"));
  const result = evaluateReleaseSecurity(
    policy,
    roles.map((role) => ({ role, status: "NotSigned", timestamped: false })),
  );

  assert.equal(result.commercialReady, false);
  assert.equal(result.authenticodeValid, false);
  assert.equal(result.signedUpdateReady, false);
  assert.ok(result.missingGates.includes("signed update client is not integrated"));
  assert.ok(result.missingGates.includes("OCR runtime notice approval evidence is not recorded"));
});

test("commercial readiness requires every signed role and release control", () => {
  const result = evaluateReleaseSecurity(readyPolicy(), validEvidence());

  assert.equal(result.commercialReady, true);
  assert.equal(result.authenticodeValid, true);
  assert.equal(result.signedUpdateReady, true);
  assert.deepEqual(result.missingGates, []);
});

test("a valid signature from the wrong publisher fails closed", () => {
  const evidence = validEvidence();
  evidence[1].signerSubject = "CN=Unexpected Publisher";
  const result = evaluateReleaseSecurity(readyPolicy(), evidence);

  assert.equal(result.commercialReady, false);
  assert.equal(result.authenticodeValid, false);
  assert.ok(result.missingGates.includes("desktop_application signer subject does not match policy"));
});

test("approval flags without evidence references fail closed", () => {
  const policy = readyPolicy();
  policy.approvals.supervisedPilotEvidence = "";
  const result = evaluateReleaseSecurity(policy, validEvidence());

  assert.equal(result.commercialReady, false);
  assert.ok(result.missingGates.includes("supervised pilot acceptance evidence is not recorded"));
});

test("an HTTP update endpoint cannot pass release readiness", () => {
  const policy = readyPolicy();
  policy.update.endpoint = "http://updates.example.com/stable.json";
  const result = evaluateReleaseSecurity(policy, validEvidence());

  assert.equal(result.commercialReady, false);
  assert.ok(result.missingGates.includes("pinned HTTPS update endpoint is not configured"));
});
