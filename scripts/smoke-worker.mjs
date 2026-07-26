import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const worker = resolve(root, "build", "worker", "innpilot-worker.exe");
const fixtureRoot = mkdtempSync(join(tmpdir(), "innpilot-worker-smoke-"));

function runWorker(args, failureMessage) {
  const result = spawnSync(worker, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || failureMessage);
    process.exit(1);
  }
  return result;
}

try {
  runWorker(["--health-check"], "Compiled worker health check failed.");
  const ocrCheck = runWorker(
    ["--ocr-self-test", resolve(root, "automation", "ocr", "tessdata")],
    "Compiled worker local OCR self-test failed.",
  );
  if (!ocrCheck.stdout.includes("local OCR self-test passed")) {
    console.error("Compiled worker did not confirm its local OCR self-test.");
    process.exit(1);
  }

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

  const result = runWorker(
    [
      resolve(root, "automation", "scans", "copy_scans.py"),
      "--config",
      configPath,
      "--dry-run",
      "--json-report",
      reportPath,
    ],
    "Compiled worker smoke test failed.",
  );
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  if (report.workflow !== "scan_copy" || report.mode !== "dry_run") {
    console.error("Compiled worker returned the wrong structured report.");
    process.exit(1);
  }
  if (report.summary?.found !== 1 || report.summary?.planned !== 1 || report.summary?.copied !== 0) {
    console.error("Compiled worker did not preserve dry-run behavior.");
    process.exit(1);
  }
  console.log("Compiled worker local OCR self-test passed.");
  console.log("Compiled worker fixture passed: one scan planned, no hotel file copied.");
} finally {
  const ownedPrefix = resolve(tmpdir()) + "\\innpilot-worker-smoke-";
  if (resolve(fixtureRoot).startsWith(ownedPrefix)) {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}
