import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createReleaseSecurityAudit } from "./release-security.mjs";
import { readReleaseVersion } from "./release-version.mjs";

const root = process.cwd();
const releaseVersion = readReleaseVersion(root).version;
const gitSafeRoot = root.replaceAll("\\", "/");

const distributionMode =
  process.env.INNPILOT_DISTRIBUTION_MODE || "internal-evaluation";
if (!["internal-evaluation", "commercial"].includes(distributionMode)) {
  throw new Error("Distribution mode must be internal-evaluation or commercial.");
}

const commit = execFileSync("git", ["-c", `safe.directory=${gitSafeRoot}`, "rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
// Compare tracked content rather than Git's timestamp cache. Tauri may rewrite a
// manifest with byte-identical content during bundling, which can briefly make
// porcelain status report a false modification on Windows.
const trackedChanges = execFileSync(
  "git",
  [
    "-c",
    `safe.directory=${gitSafeRoot}`,
    "diff",
    "--name-only",
    "--no-ext-diff",
    "HEAD",
    "--",
  ],
  { cwd: root, encoding: "utf8" },
).trim();
if (trackedChanges && process.env.INNPILOT_ALLOW_DIRTY_RELEASE !== "yes") {
  throw new Error("Release manifests require a clean tracked source tree.");
}

const nsisDir = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const installers = existsSync(nsisDir)
  ? readdirSync(nsisDir)
      .filter((name) => /^InnPilot_.+_x64-setup\.exe$/i.test(name))
      .sort()
  : [];
if (installers.length !== 1) {
  throw new Error(
    `Expected exactly one InnPilot NSIS installer; found ${installers.length}.`,
  );
}

const workerDir = join(root, "build", "worker");
const files = [
  { role: "windows_installer", path: join(nsisDir, installers[0]) },
  {
    role: "desktop_application",
    path: join(root, "src-tauri", "target", "release", "innpilot.exe"),
  },
  { role: "automation_worker", path: join(workerDir, "innpilot-worker.exe") },
  { role: "worker_checksum", path: join(workerDir, "innpilot-worker.sha256") },
  {
    role: "resolved_dependencies",
    path: join(workerDir, "requirements-resolved.txt"),
  },
  { role: "third_party_notices", path: join(root, "THIRD_PARTY_NOTICES.md") },
];
for (const file of files) {
  if (!existsSync(file.path)) {
    throw new Error(`Missing release artifact for ${file.role}: ${file.path}`);
  }
}

const workerFile = files.find((file) => file.role === "automation_worker");
const checksumFile = files.find((file) => file.role === "worker_checksum");
const workerDigest = sha256(workerFile.path);
const declaredWorkerDigest = readFileSync(checksumFile.path, "utf8")
  .trim()
  .split(/\s+/)[0]
  .toLowerCase();
if (workerDigest !== declaredWorkerDigest) {
  throw new Error("The packaged worker does not match its declared checksum.");
}

const outputDir = join(root, "build", "release");
mkdirSync(outputDir, { recursive: true });
const output = join(outputDir, "innpilot-release.json");
const securityAuditPath = join(outputDir, "innpilot-release-security.json");
for (const staleOutput of [output, output + ".sha256", securityAuditPath]) {
  rmSync(staleOutput, { force: true });
}

const securityAudit = createReleaseSecurityAudit({
  version: releaseVersion,
  commit,
  policyPath: join(root, "release", "release-policy.json"),
  signatureScriptPath: join(root, "scripts", "inspect-authenticode.ps1"),
  targets: files
    .filter((file) =>
      ["windows_installer", "desktop_application", "automation_worker"].includes(file.role),
    )
    .map((file) => ({ role: file.role, path: file.path })),
});
writeFileSync(securityAuditPath, JSON.stringify(securityAudit, null, 2) + "\n");
files.push({ role: "release_security_audit", path: securityAuditPath });

if (distributionMode === "commercial" && !securityAudit.commercialReady) {
  throw new Error(
    "Commercial release blocked: " + securityAudit.missingGates.join("; "),
  );
}
const commercialApproved =
  distributionMode === "commercial" && securityAudit.commercialReady;

const manifest = {
  schema: "innpilot-release-v1",
  generatedAt: new Date().toISOString(),
  version: releaseVersion,
  commit,
  sourceTreeClean: !trackedChanges,
  distribution: {
    mode: distributionMode,
    commercialDistributionApproved: commercialApproved,
    reason: commercialApproved
      ? "All source-controlled commercial release gates passed."
      : `Commercial release blocked by ${securityAudit.missingGates.length} verified gate(s).`,
  },
  platform: { os: "windows", architecture: "x86_64", package: "nsis" },
  security: {
    packagedWorkerChecksumVerified: true,
    codeSigningRequiredForCommercialRelease: true,
    authenticodeSignaturesValid: securityAudit.authenticodeValid,
    signedUpdateChannelReady: securityAudit.signedUpdateReady,
    commercialGatesPassed: securityAudit.commercialReady,
    securityAuditSha256: sha256(securityAuditPath),
    hotelOperationalDataIncluded: false,
  },
  artifacts: files.map((file) => {
    const bytes = readFileSync(file.path);
    return {
      role: file.role,
      fileName: basename(file.path),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }),
};

const serialized = JSON.stringify(manifest, null, 2) + "\n";
writeFileSync(output, serialized);
writeFileSync(
  output + ".sha256",
  `${createHash("sha256").update(serialized).digest("hex")}  innpilot-release.json\n`,
);
console.log(
  `InnPilot ${manifest.version} ${distributionMode} manifest created for ${installers[0]}.`,
);

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
