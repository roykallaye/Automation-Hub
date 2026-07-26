import { createHash } from "node:crypto";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const TESSERACT = {
  version: "5.5.3",
  fileName: "tesseract-ocr-w64-setup-5.5.3.20260724.exe",
  url: "https://github.com/tesseract-ocr/tesseract/releases/download/5.5.3/tesseract-ocr-w64-setup-5.5.3.20260724.exe",
  bytes: 26_573_224,
  sha256: "bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4",
};
const SEVEN_ZIP = {
  version: "26.02",
  fileName: "7z2602-x64.exe",
  url: "https://www.7-zip.org/a/7z2602-x64.exe",
  bytes: 1_657_896,
  sha256: "6745fa76dc2ea031596d8678f6f6b99c3c1b435b4164a63485adbbc7b8d82ef0",
};

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("The pinned InnPilot OCR runtime can only be prepared on Windows x64.");
}

const root = process.cwd();
const buildRoot = resolve(root, "build");
const cacheDir = join(buildRoot, "tool-cache");
const extractionRoot = join(buildRoot, "tesseract-extraction");
const sevenZipRoot = join(extractionRoot, "7zip");
const tesseractRoot = join(extractionRoot, "tesseract");
const runtimeDir = join(buildRoot, "tesseract-runtime");
const bootstrapSevenZip = join(
  root,
  "node_modules",
  "7zip-bin",
  "win",
  "x64",
  "7za.exe",
);

mkdirSync(cacheDir, { recursive: true });
await ensureDownload(SEVEN_ZIP);
await ensureDownload(TESSERACT);
resetOwnedDirectory(extractionRoot);
resetOwnedDirectory(runtimeDir);
mkdirSync(sevenZipRoot, { recursive: true });
mkdirSync(tesseractRoot, { recursive: true });
mkdirSync(runtimeDir, { recursive: true });

if (!existsSync(bootstrapSevenZip)) {
  throw new Error("The pinned 7zip-bin bootstrap executable is missing.");
}
run(bootstrapSevenZip, [
  "x",
  join(cacheDir, SEVEN_ZIP.fileName),
  `-o${sevenZipRoot}`,
  "-y",
  "-bd",
]);
const fullSevenZip = join(sevenZipRoot, "7z.exe");
const fullSevenZipDll = join(sevenZipRoot, "7z.dll");
if (!existsSync(fullSevenZip) || !existsSync(fullSevenZipDll)) {
  throw new Error("The verified 7-Zip package did not contain its full extraction engine.");
}
run(fullSevenZip, [
  "x",
  join(cacheDir, TESSERACT.fileName),
  `-o${tesseractRoot}`,
  "-y",
  "-bd",
]);

const runtimeSources = readdirSync(tesseractRoot, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isFile() &&
      (entry.name.toLowerCase() === "tesseract.exe" ||
        entry.name.toLowerCase().endsWith(".dll")),
  )
  .map((entry) => join(tesseractRoot, entry.name))
  .sort((left, right) => left.localeCompare(right));
if (
  runtimeSources.length < 40 ||
  !runtimeSources.some((path) => basename(path).toLowerCase() === "tesseract.exe")
) {
  throw new Error("The verified Tesseract package did not contain the expected runtime.");
}
for (const source of runtimeSources) {
  copyFileSync(source, join(runtimeDir, basename(source)));
}
const licenseSource = join(tesseractRoot, "doc", "LICENSE");
if (!existsSync(licenseSource)) {
  throw new Error("The verified Tesseract package did not contain its license.");
}
copyFileSync(licenseSource, join(runtimeDir, "TESSERACT-LICENSE.txt"));

const versionResult = run(join(runtimeDir, "tesseract.exe"), ["--version"], {
  capture: true,
  env: minimalWindowsEnvironment(runtimeDir),
});
const versionOutput = `${versionResult.stdout}\n${versionResult.stderr}`;
if (!versionOutput.includes(`tesseract v${TESSERACT.version}`)) {
  throw new Error("The extracted OCR runtime reported an unexpected version.");
}

const files = readdirSync(runtimeDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => {
    const path = join(runtimeDir, entry.name);
    return {
      fileName: entry.name,
      bytes: statSync(path).size,
      sha256: sha256(path),
    };
  })
  .sort((left, right) => left.fileName.localeCompare(right.fileName));
const manifest = {
  schema: "innpilot-ocr-runtime-v1",
  generatedFrom: {
    project: "tesseract-ocr/tesseract",
    version: TESSERACT.version,
    url: TESSERACT.url,
    bytes: TESSERACT.bytes,
    sha256: TESSERACT.sha256,
  },
  extractionTool: {
    project: "7-zip/7zip",
    version: SEVEN_ZIP.version,
    url: SEVEN_ZIP.url,
    bytes: SEVEN_ZIP.bytes,
    sha256: SEVEN_ZIP.sha256,
  },
  runtimeVersionVerified: true,
  files,
};
writeFileSync(
  join(runtimeDir, "runtime-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
rmSync(extractionRoot, { recursive: true, force: true });
console.log(
  `Pinned Tesseract ${TESSERACT.version} runtime ready (${files.length} verified files).`,
);

async function ensureDownload(source) {
  const target = join(cacheDir, source.fileName);
  if (existsSync(target) && verifyFile(target, source)) return;
  rmSync(target, { force: true });
  const partial = `${target}.partial`;
  rmSync(partial, { force: true });
  const response = await fetch(source.url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Could not download the pinned build dependency (${response.status}).`);
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength && declaredLength !== source.bytes) {
    throw new Error("Pinned build dependency reported an unexpected size.");
  }
  await pipeline(response.body, createWriteStream(partial, { flags: "wx" }));
  if (!verifyFile(partial, source)) {
    rmSync(partial, { force: true });
    throw new Error("Pinned build dependency failed its size or SHA-256 check.");
  }
  renameSync(partial, target);
}

function verifyFile(path, source) {
  return statSync(path).size === source.bytes && sha256(path) === source.sha256;
}

function sha256(path) {
  const digest = createHash("sha256");
  const bytes = readFileSync(path);
  return digest.update(bytes).digest("hex");
}

function resetOwnedDirectory(path) {
  const target = resolve(path);
  const relation = relative(buildRoot, target);
  if (!relation || relation.startsWith("..") || relation.includes(`..${sep}`)) {
    throw new Error("Refusing to reset a build directory outside the owned build root.");
  }
  rmSync(target, { recursive: true, force: true });
}

function run(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    windowsHide: true,
    env: options.env || process.env,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Pinned build tool failed safely: ${basename(program)}.`);
  }
  return result;
}

function minimalWindowsEnvironment(runtime) {
  return {
    PATH: runtime,
    SYSTEMROOT: process.env.SYSTEMROOT || "C:\\Windows",
    WINDIR: process.env.WINDIR || "C:\\Windows",
    TEMP: process.env.TEMP || join(buildRoot, "tmp"),
    TMP: process.env.TMP || join(buildRoot, "tmp"),
  };
}
