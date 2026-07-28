import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli =
  process.env.npm_execpath ??
  path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
if (process.platform === "win32" && !existsSync(npmCli)) {
  throw new Error("Could not locate npm's JavaScript CLI.");
}
const npm = process.platform === "win32" ? process.execPath : "npm";
const npmArgs = (...args) => (process.platform === "win32" ? [npmCli, ...args] : args);
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
const git = process.platform === "win32" ? "git.exe" : "git";
const manifest = "src-tauri/Cargo.toml";

function run(label, command, args) {
  process.stdout.write(`\n== ${label} ==\n`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`${label} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`);
  }
}

function assertCleanSource() {
  if (process.env.INNPILOT_ALLOW_DIRTY_VERIFY === "yes") return;
  const safeRoot = root.replaceAll("\\", "/");
  const result = spawnSync(
    git,
    ["-c", `safe.directory=${safeRoot}`, "status", "--porcelain", "--untracked-files=all"],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error("Could not verify the Git source state.");
  }
  if (result.stdout.trim()) {
    throw new Error(
      "Release verification requires a clean committed source tree. " +
        "Set INNPILOT_ALLOW_DIRTY_VERIFY=yes only for local development.",
    );
  }
}

assertCleanSource();

const gates = [
  ["Frontend production build", npm, npmArgs("run", "build")],
  ["Packaged resource inventory", npm, npmArgs("run", "doctor:resources")],
  ["Release security policy tests", npm, npmArgs("run", "test:release-security")],
  ["Compiled worker smoke test", npm, npmArgs("run", "test:worker-binary")],
  ["Automation test runtime selection", npm, npmArgs("run", "test:automation-runtime")],
  ["Automation contract tests", npm, npmArgs("run", "test:automation")],
  ["Rust formatting", cargo, ["fmt", "--manifest-path", manifest, "--", "--check"]],
  [
    "Rust tests",
    cargo,
    ["test", "--locked", "--manifest-path", manifest, "--all-features", "--all-targets"],
  ],
  [
    "Strict Rust lint",
    cargo,
    [
      "clippy",
      "--locked",
      "--manifest-path",
      manifest,
      "--all-features",
      "--all-targets",
      "--",
      "-D",
      "warnings",
    ],
  ],
];

for (const gate of gates) run(...gate);

process.stdout.write(
  "\nInnPilot source release gates passed. " +
    "Run npm run test:clean-install against the isolated validation bundle " +
    "before approving a Windows installer.\n",
);
