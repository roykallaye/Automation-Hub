import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const gitSafeRoot = root.replaceAll("\\", "/");
const tauriConfig = JSON.parse(
  readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"),
);
if (packageJson.version !== tauriConfig.version) {
  throw new Error("package.json and tauri.conf.json must use the same release version.");
}

const distributionMode =
  process.env.INNPILOT_DISTRIBUTION_MODE || "internal-evaluation";
if (distributionMode !== "internal-evaluation") {
  throw new Error(
    "Commercial release is intentionally blocked until the PyMuPDF licensing path is removed or formally approved in source.",
  );
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

const workerDigest = sha256(files[1].path);
const declaredWorkerDigest = readFileSync(files[2].path, "utf8")
  .trim()
  .split(/\s+/)[0]
  .toLowerCase();
if (workerDigest !== declaredWorkerDigest) {
  throw new Error("The packaged worker does not match its declared checksum.");
}

const manifest = {
  schema: "innpilot-release-v1",
  generatedAt: new Date().toISOString(),
  version: packageJson.version,
  commit,
  sourceTreeClean: !trackedChanges,
  distribution: {
    mode: distributionMode,
    commercialDistributionApproved: false,
    reason:
      "PyMuPDF requires AGPL-compliant distribution or a commercial Artifex license. This build is for controlled internal evaluation only.",
  },
  platform: { os: "windows", architecture: "x86_64", package: "nsis" },
  security: {
    packagedWorkerChecksumVerified: true,
    codeSigningRequiredForCommercialRelease: true,
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

const outputDir = join(root, "build", "release");
mkdirSync(outputDir, { recursive: true });
const output = join(outputDir, "innpilot-release.json");
const serialized = JSON.stringify(manifest, null, 2) + "\n";
writeFileSync(output, serialized);
writeFileSync(
  output + ".sha256",
  `${createHash("sha256").update(serialized).digest("hex")}  innpilot-release.json\n`,
);
console.log(
  `InnPilot ${manifest.version} internal-evaluation manifest created for ${installers[0]}.`,
);

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
