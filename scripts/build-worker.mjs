import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
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
const tesseractRuntime = join(root, "build", "tesseract-runtime");
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


const environmentStamp = createHash("sha256")
  .update(readFileSync(lockPath))
  .update(expectedPython)
  .digest("hex");
const installedStamp = existsSync(stampPath) ? readFileSync(stampPath, "utf8").trim() : "";
if (existsSync(environmentDir) && installedStamp !== environmentStamp) {
  const exactEnvironment = resolve(root, "build", "worker-env");
  if (resolve(environmentDir) !== exactEnvironment) {
    throw new Error("Refusing to reset a Python environment outside the owned build folder.");
  }
  rmSync(environmentDir, { recursive: true, force: true });
}
if (!existsSync(python)) {
  run(basePython, ["-B", "-m", "venv", environmentDir], { stdio: "inherit" });
}

if (installedStamp !== environmentStamp) {
  const pipArguments = [
    "-B",
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--require-virtualenv",
  ];
  const offlineWheelhouse = process.env.INNPILOT_OFFLINE_WHEELHOUSE?.trim();
  if (offlineWheelhouse) {
    const wheelhousePath = resolve(root, offlineWheelhouse);
    if (!existsSync(wheelhousePath)) {
      throw new Error("The configured offline worker wheelhouse does not exist.");
    }
    pipArguments.push("--no-index", "--find-links", wheelhousePath);
  }
  pipArguments.push("-r", lockPath);
  run(python, pipArguments, { stdio: "inherit" });
  writeFileSync(stampPath, `${environmentStamp}\n`);
}
run(python, ["-B", "-m", "pip", "check"]);
run(python, ["-I", "-B", "-m", "PyInstaller", "--version"]);
const resolved = run(python, ["-B", "-m", "pip", "list", "--format=freeze"]).stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .sort((left, right) => left.localeCompare(right))
  .join("\n");
if (resolved.split("\n").some((line) => /^(?:pymupdf|fitz)==/i.test(line))) {
  throw new Error(
    "The worker environment contains a forbidden PDF dependency; reset it before release.",
  );
}

if (!existsSync(join(tesseractRuntime, "runtime-manifest.json"))) {
  throw new Error("The verified Tesseract runtime has not been prepared.");
}

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
  "pypdfium2",
];
for (const entry of readdirSync(tesseractRuntime, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const source = join(tesseractRuntime, entry.name);
  const binary = /\.(?:dll|exe)$/i.test(entry.name);
  args.push(
    binary ? "--add-binary" : "--add-data",
    `${source}${delimiter}tesseract`,
  );
}

for (const moduleName of hiddenImports) args.push("--hidden-import", moduleName);
args.push(join(root, "automation", "worker.py"));

const build = spawnSync(python, args, { cwd: root, stdio: "inherit", env: buildEnvironment });
if (build.status !== 0 || !existsSync(output)) process.exit(build.status || 1);

const bytes = readFileSync(output);
const digest = createHash("sha256").update(bytes).digest("hex");
writeFileSync(join(outputDir, "innpilot-worker.sha256"), `${digest}  innpilot-worker.exe\n`);
console.log(`InnPilot worker ready (${Math.ceil(bytes.length / 1024 / 1024)} MiB, sha256 ${digest}).`);
writeFileSync(join(outputDir, "requirements-resolved.txt"), `${resolved}\n`);
