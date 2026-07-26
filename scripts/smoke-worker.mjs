import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const worker = resolve(root, "build", "worker", "innpilot-worker.exe");
const fixtureRoot = mkdtempSync(join(tmpdir(), "innpilot-worker-smoke-"));

try {
  const source = join(fixtureRoot, "network-scans");
  const destination = join(fixtureRoot, "local-cache");
  const configPath = join(fixtureRoot, "config.json");
  const reportPath = join(fixtureRoot, "report.json");
  mkdirSync(source, { recursive: true });
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(source, "Sharp MFP fixture.pdf"), "synthetic test fixture only");
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        paths: { scanSourceDir: source, scanCacheDir: destination },
        contracts: { scannerFilePrefixes: ["Sharp MFP"] },
      },
      null,
      2,
    ),
  );

  const result = spawnSync(
    worker,
    [
      resolve(root, "automation", "scans", "copy_scans.py"),
      "--config",
      configPath,
      "--dry-run",
      "--json-report",
      reportPath,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || "Compiled worker smoke test failed.");
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  if (report.workflow !== "scan_copy" || report.mode !== "dry_run") {
    console.error("Compiled worker returned the wrong structured report.");
    process.exit(1);
  }
  if (report.summary?.found !== 1 || report.summary?.planned !== 1 || report.summary?.copied !== 0) {
    console.error("Compiled worker did not preserve dry-run behavior.");
    process.exit(1);
  }
  console.log("Compiled worker fixture passed: one scan planned, no hotel file copied.");
} finally {
  const ownedPrefix = resolve(tmpdir()) + "\\innpilot-worker-smoke-";
  if (resolve(fixtureRoot).startsWith(ownedPrefix)) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}
