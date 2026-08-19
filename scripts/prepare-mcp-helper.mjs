import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = join(root, "src-tauri", "Cargo.toml");
const rustc = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
const host = rustc
  .split(/\r?\n/)
  .find((line) => line.startsWith("host: "))
  ?.slice("host: ".length)
  .trim();

if (!host) {
  throw new Error("Could not determine the Rust host target for the InnPilot MCP helper.");
}

execFileSync(
  "cargo",
  ["build", "--locked", "--release", "--bin", "innpilot-mcp", "--manifest-path", manifest],
  { cwd: root, stdio: "inherit" },
);

const extension = host.includes("windows") ? ".exe" : "";
const source = join(root, "src-tauri", "target", "release", `innpilot-mcp${extension}`);
const destination = join(
  root,
  "src-tauri",
  "binaries",
  `innpilot-mcp-${host}${extension}`,
);
mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log(`Prepared InnPilot MCP sidecar for ${host}.`);
