import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const POLICY_SCHEMA = "innpilot-release-policy-v1";
const REQUIRED_SIGNED_ROLES = ["windows_installer", "desktop_application", "automation_worker"];

export function normalizeThumbprint(value) {
  return String(value || "").replaceAll(/[^0-9a-f]/gi, "").toUpperCase();
}

export function evaluateReleaseSecurity(policy, authenticode) {
  if (!policy || policy.schema !== POLICY_SCHEMA) {
    throw new Error("Release policy is missing or uses an unsupported schema.");
  }
  if (!Array.isArray(authenticode)) {
    throw new Error("Authenticode evidence must be an array.");
  }

  const missingGates = [];
  const signing = policy.authenticode || {};
  const expectedSubject = String(signing.expectedPublisherSubject || "").trim();
  const allowedThumbprints = new Set(
    (signing.allowedSignerThumbprints || []).map(normalizeThumbprint).filter(Boolean),
  );
  if (!expectedSubject) missingGates.push("expected publisher subject is not configured");
  if (allowedThumbprints.size === 0) missingGates.push("allowed signer thumbprint is not configured");

  for (const role of REQUIRED_SIGNED_ROLES) {
    const evidence = authenticode.find((item) => item.role === role);
    if (!evidence) {
      missingGates.push(`${role} signature evidence is missing`);
      continue;
    }
    if (evidence.status !== "Valid") {
      missingGates.push(`${role} Authenticode status is ${evidence.status || "unknown"}`);
    }
    if (expectedSubject && evidence.signerSubject !== expectedSubject) {
      missingGates.push(`${role} signer subject does not match policy`);
    }
    const thumbprint = normalizeThumbprint(evidence.signerThumbprint);
    if (allowedThumbprints.size > 0 && !allowedThumbprints.has(thumbprint)) {
      missingGates.push(`${role} signer thumbprint is not allowlisted`);
    }
    if (signing.requireTrustedTimestamp === true && evidence.timestamped !== true) {
      missingGates.push(`${role} does not contain a trusted timestamp`);
    }
  }

  const update = policy.update || {};
  if (update.clientIntegrated !== true) missingGates.push("signed update client is not integrated");
  if (update.signatureVerificationTested !== true) {
    missingGates.push("update signature verification is not tested");
  }
  if (update.stagedRolloutTested !== true) missingGates.push("staged update rollout is not tested");
  if (update.rollbackTested !== true) missingGates.push("update rollback is not tested");
  if (!isPinnedHttpsEndpoint(update.endpoint)) {
    missingGates.push("pinned HTTPS update endpoint is not configured");
  }
  if (String(update.publicKey || "").trim().length < 32) {
    missingGates.push("update verification public key is not configured");
  }

  const approvals = policy.approvals || {};
  if (
    approvals.ocrRuntimeNoticesApproved !== true ||
    !String(approvals.ocrRuntimeNoticesEvidence || "").trim()
  ) {
    missingGates.push("OCR runtime notice approval evidence is not recorded");
  }
  if (
    approvals.privacyAndDpaApproved !== true ||
    !String(approvals.privacyAndDpaEvidence || "").trim()
  ) {
    missingGates.push("privacy and data-processing approval evidence is not recorded");
  }
  if (
    approvals.supervisedPilotAccepted !== true ||
    !String(approvals.supervisedPilotEvidence || "").trim()
  ) {
    missingGates.push("supervised pilot acceptance evidence is not recorded");
  }

  return {
    commercialReady: missingGates.length === 0,
    missingGates: [...new Set(missingGates)],
    authenticodeValid:
      expectedSubject.length > 0 &&
      allowedThumbprints.size > 0 &&
      REQUIRED_SIGNED_ROLES.every((role) => {
        const item = authenticode.find((candidate) => candidate.role === role);
        return (
          item?.status === "Valid" &&
          item.signerSubject === expectedSubject &&
          allowedThumbprints.has(normalizeThumbprint(item.signerThumbprint)) &&
          (signing.requireTrustedTimestamp !== true || item.timestamped === true)
        );
      }),
    signedUpdateReady:
      update.clientIntegrated === true &&
      update.signatureVerificationTested === true &&
      update.stagedRolloutTested === true &&
      update.rollbackTested === true &&
      isPinnedHttpsEndpoint(update.endpoint) &&
      String(update.publicKey || "").trim().length >= 32,
  };
}

export function inspectAuthenticode(targets, scriptPath) {
  if (process.platform !== "win32") {
    throw new Error("Authenticode inspection must run on Windows.");
  }
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows";
  const powershell = join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (!existsSync(powershell) || !existsSync(scriptPath)) {
    throw new Error("Windows signature inspection tooling is unavailable.");
  }
  const encodedTargets = Buffer.from(JSON.stringify(targets), "utf8").toString("base64");
  const output = execFileSync(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      encodedTargets,
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function createReleaseSecurityAudit({
  version,
  commit,
  policyPath,
  signatureScriptPath,
  targets,
}) {
  const policyBytes = readFileSync(policyPath);
  const policy = JSON.parse(policyBytes.toString("utf8"));
  const authenticode = inspectAuthenticode(targets, signatureScriptPath);
  const evaluation = evaluateReleaseSecurity(policy, authenticode);
  return {
    schema: "innpilot-release-security-audit-v1",
    generatedAt: new Date().toISOString(),
    version,
    commit,
    policySha256: createHash("sha256").update(policyBytes).digest("hex"),
    authenticode: authenticode.map((item) => ({
      role: item.role,
      fileName: basename(item.fileName),
      status: item.status,
      signerSubject: item.signerSubject || null,
      signerThumbprint: normalizeThumbprint(item.signerThumbprint) || null,
      timestamped: item.timestamped === true,
      timestampSubject: item.timestampSubject || null,
    })),
    ...evaluation,
  };
}

function isPinnedHttpsEndpoint(value) {
  try {
    const endpoint = new URL(String(value || ""));
    return (
      endpoint.protocol === "https:" &&
      endpoint.username === "" &&
      endpoint.password === "" &&
      endpoint.hostname.length > 0
    );
  } catch {
    return false;
  }
}
