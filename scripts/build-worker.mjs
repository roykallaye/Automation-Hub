import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") {
  console.error("InnPilot's hotel-PC worker must be built on Windows.");
  process.exit(1);
}

const root = process.cwd();
const outputDir = join(root, "build", "worker");
const workDir = join(root, "build", "pyinstaller");
const output = join(outputDir, "innpilot-worker.exe");
const basePython = process.env.PYTHON || "python";
const environmentDir = join(root, "build", "worker-env");
const python = join(environmentDir, "Scripts", "python.exe");
const lockPath = join(root, "automation", "requirements-build.lock.txt");
const stampPath = join(environmentDir, ".innpilot-lock");
const expectedPython = "Python 3.14.2";

mkdirSync(outputDir, { recursive: true });
rmSync(output, { force: true });
const buildEnvironment = {
  ...process.env,
  PYTHONDONTWRITEBYTECODE: "1",
  PYTHONNOUSERSITE: "1",
  PYTHONPATH: "",
};

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: root, encoding: "utf8", env: buildEnvironment, ...options });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
  return result;
}

const versionResult = run(basePython, ["--version"]);
const version = (versionResult.stdout || versionResult.stderr || "").trim();
if (version !== expectedPython) {
  console.error(`Worker releases require ${expectedPython}; found ${version || "unknown"}.`);
  process.exit(1);
}

if (!existsSync(python)) {
  run(basePython, ["-B", "-m", "venv", environmentDir], { stdio: "inherit" });
}

const environmentStamp = createHash("sha256")
  .update(readFileSync(lockPath))
  .update(expectedPython)
  .digest("hex");
const installedStamp = existsSync(stampPath) ? readFileSync(stampPath, "utf8").trim() : "";
if (installedStamp !== environmentStamp) {
  run(
    python,
    [
      "-B",
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--require-virtualenv",
      "-r",
      lockPath,
    ],
    { stdio: "inherit" },
  );
  writeFileSync(stampPath, `${environmentStamp}\n`);
}
run(python, ["-B", "-m", "pip", "check"]);
run(python, ["-I", "-B", "-m", "PyInstaller", "--version"]);

const hiddenImports = [
  "invoices.process_fatture",
  "gmail_drafts.create_gmail_draft",
  "gmail_drafts.draft_safety",
  "scans.copy_scans",
  "ocr.extract_scan_text",
  "contracts.process_contratti",
  "shared.config",
  "shared.report",
  "shared.safe_files",
  "shared.windows_secrets",
];
const args = [
  "-I",
  "-B",
  "-m",
  "PyInstaller",
  "--noconfirm",
  "--clean",
  "--onefile",
  "--console",
  "--noupx",
  "--name",
  "innpilot-worker",
  "--distpath",
  outputDir,
  "--workpath",
  join(workDir, "work"),
  "--specpath",
  join(workDir, "spec"),
  "--paths",
  join(root, "automation"),
  "--collect-data",
  "googleapiclient",
  "--collect-data",
  "certifi",
  "--collect-all",
  "pymupdf",
];
for (const moduleName of hiddenImports) args.push("--hidden-import", moduleName);
args.push(join(root, "automation", "worker.py"));

const build = spawnSync(python, args, { cwd: root, stdio: "inherit", env: buildEnvironment });
if (build.status !== 0 || !existsSync(output)) process.exit(build.status || 1);

const bytes = readFileSync(output);
const digest = createHash("sha256").update(bytes).digest("hex");
writeFileSync(join(outputDir, "innpilot-worker.sha256"), `${digest}  innpilot-worker.exe\n`);
console.log(`InnPilot worker ready (${Math.ceil(bytes.length / 1024 / 1024)} MiB, sha256 ${digest}).`);
const resolved = run(python, ["-B", "-m", "pip", "list", "--format=freeze"]).stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .sort((left, right) => left.localeCompare(right))
  .join("\n");
writeFileSync(join(outputDir, "requirements-resolved.txt"), `${resolved}\n`);
