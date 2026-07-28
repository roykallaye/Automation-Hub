import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function selectAutomationTestPython({
  root = process.cwd(),
  environment = process.env,
  platform = process.platform,
  fileExists = existsSync,
} = {}) {
  const override = environment.PYTHON?.trim();
  if (override) return { executable: override, source: 'environment' };

  const managedPython = resolve(
    root,
    'build',
    'worker-env',
    platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  if (fileExists(managedPython)) {
    return { executable: managedPython, source: 'managed-worker-environment' };
  }

  return { executable: 'python', source: 'system-fallback' };
}

function runAutomationTests() {
  const interpreter = selectAutomationTestPython();
  console.log(`Automation tests: ${interpreter.source}.`);
  const result = spawnSync(
    interpreter.executable,
    ['-B', '-m', 'unittest', 'discover', 'automation/tests'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
      },
      stdio: 'inherit',
      timeout: 5 * 60 * 1000,
      killSignal: 'SIGKILL',
      windowsHide: true,
    },
  );

  if (result.error) {
    console.error(`Could not start the Python test suite: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

const entryPoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryPoint) runAutomationTests();
