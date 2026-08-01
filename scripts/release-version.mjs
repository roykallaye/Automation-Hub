import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function isSemanticVersion(value) {
  return typeof value === "string" && SEMVER_PATTERN.test(value);
}

export function collectReleaseVersions(contents) {
  const packageJson = parseJson(contents.packageJson, "package.json");
  const packageLock = parseJson(contents.packageLock, "package-lock.json");
  const tauriConfig = parseJson(contents.tauriConfig, "src-tauri/tauri.conf.json");

  const sources = {
    "package.json": packageJson.version,
    "package-lock.json": packageLock.version,
    "package-lock.json workspace root": packageLock.packages?.[""]?.version,
    "src-tauri/tauri.conf.json": tauriConfig.version,
    "src-tauri/Cargo.toml": readCargoTomlPackageVersion(contents.cargoToml),
    "src-tauri/Cargo.lock": readCargoLockPackageVersion(contents.cargoLock, "innpilot"),
  };

  for (const [source, version] of Object.entries(sources)) {
    if (!isSemanticVersion(version)) {
      throw new Error(`${source} does not contain a valid semantic release version.`);
    }
  }

  const unique = new Set(Object.values(sources));
  if (unique.size !== 1) {
    const details = Object.entries(sources)
      .map(([source, version]) => `${source}=${version}`)
      .join(", ");
    throw new Error(`InnPilot release versions are not synchronized: ${details}`);
  }

  return {
    schema: "innpilot-release-version-v1",
    version: Object.values(sources)[0],
    sources,
  };
}

export function readReleaseVersion(root, expectedVersion = "") {
  const report = collectReleaseVersions({
    packageJson: readFileSync(resolve(root, "package.json"), "utf8"),
    packageLock: readFileSync(resolve(root, "package-lock.json"), "utf8"),
    tauriConfig: readFileSync(resolve(root, "src-tauri", "tauri.conf.json"), "utf8"),
    cargoToml: readFileSync(resolve(root, "src-tauri", "Cargo.toml"), "utf8"),
    cargoLock: readFileSync(resolve(root, "src-tauri", "Cargo.lock"), "utf8"),
  });

  const expected = String(expectedVersion || "").trim();
  if (expected) {
    if (!isSemanticVersion(expected)) {
      throw new Error("The expected InnPilot version is not valid semantic versioning.");
    }
    if (report.version !== expected) {
      throw new Error(
        `Expected InnPilot ${expected}, but the committed source declares ${report.version}.`,
      );
    }
  }
  return report;
}

function parseJson(content, label) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function readCargoTomlPackageVersion(content) {
  const packageSection = String(content).match(
    /(?:^|\r?\n)\[package\]\s*\r?\n([\s\S]*?)(?=\r?\n\[|$)/,
  );
  if (!packageSection) {
    throw new Error("src-tauri/Cargo.toml is missing its package section.");
  }
  const version = packageSection[1].match(/^\s*version\s*=\s*"([^"]+)"\s*$/m);
  if (!version) {
    throw new Error("src-tauri/Cargo.toml is missing its package version.");
  }
  return version[1];
}

function readCargoLockPackageVersion(content, packageName) {
  const packages = String(content).matchAll(
    /(?:^|\r?\n)\[\[package\]\]\s*\r?\n([\s\S]*?)(?=\r?\n\[\[package\]\]|$)/g,
  );
  const matches = [];
  for (const candidate of packages) {
    const name = candidate[1].match(/^\s*name\s*=\s*"([^"]+)"\s*$/m)?.[1];
    if (name !== packageName) continue;
    const version = candidate[1].match(/^\s*version\s*=\s*"([^"]+)"\s*$/m)?.[1];
    if (!version) {
      throw new Error(`src-tauri/Cargo.lock is missing the ${packageName} version.`);
    }
    matches.push(version);
  }
  if (matches.length !== 1) {
    throw new Error(
      `src-tauri/Cargo.lock must contain exactly one ${packageName} package; found ${matches.length}.`,
    );
  }
  return matches[0];
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const entryUrl = pathToFileURL(resolve(process.argv[1])).href.toLowerCase();
  return import.meta.url.toLowerCase() === entryUrl;
}

if (isMainModule()) {
  const expectedIndex = process.argv.indexOf("--expected");
  const expected =
    expectedIndex >= 0
      ? process.argv[expectedIndex + 1]
      : process.env.INNPILOT_EXPECTED_VERSION || "";
  if (expectedIndex >= 0 && !expected) {
    throw new Error("--expected requires a semantic version.");
  }
  const report = readReleaseVersion(process.cwd(), expected);
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(report.version + "\n");
  }
}
