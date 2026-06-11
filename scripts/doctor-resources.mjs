import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const automationRoot = join(root, "automation");
const forbiddenFolders = new Set([
  "__pycache__",
  "Input",
  "ReadyToSend",
  "Archive",
  "Logs",
  "Reports",
  "Token",
  "Credentials",
]);

const errors = [];

function scan(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    errors.push(`Could not read ${formatPath(directory)}: ${error.message}`);
    return;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    const displayPath = formatPath(path);
    if (entry.isDirectory()) {
      if (forbiddenFolders.has(entry.name)) {
        const hasEntries = readdirSync(path).length > 0;
        if (entry.name === "__pycache__" || hasEntries) {
          errors.push(`Forbidden resource folder: ${displayPath}`);
        }
      }
      scan(path);
      continue;
    }

    if (!entry.isFile()) continue;
    if (isForbiddenFile(entry.name)) {
      errors.push(`Forbidden resource file: ${displayPath}`);
    }
  }
}

function isForbiddenFile(name) {
  const lower = name.toLowerCase();
  return (
    lower === "config.local.json" ||
    lower === "gmail_token.json" ||
    lower === "gmail_credentials.json" ||
    /^client_secret.*\.json$/i.test(name) ||
    lower.endsWith(".pyc") ||
    lower.endsWith(".log") ||
    /^report_.*\.json$/i.test(name) ||
    lower.endsWith(".pdf")
  );
}

function formatPath(path) {
  return relative(root, path).split(sep).join("/");
}

try {
  statSync(automationRoot);
} catch {
  console.error("automation/ folder is missing.");
  process.exit(1);
}

scan(automationRoot);

if (errors.length > 0) {
  console.error("Resource safety check failed. Remove generated/sensitive files before building:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Resource safety check passed. No forbidden automation resources found.");
