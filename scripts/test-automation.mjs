import { spawnSync } from 'node:child_process';

const python = process.env.PYTHON || 'python';
const result = spawnSync(
  python,
  ['-B', '-m', 'unittest', 'discover', 'automation/tests'],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(`Could not start the Python test suite: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
