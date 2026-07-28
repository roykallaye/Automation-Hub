import assert from 'node:assert/strict';
import test from 'node:test';
import { selectAutomationTestPython } from './test-automation.mjs';

test('an explicit Python override always wins', () => {
  const selected = selectAutomationTestPython({
    root: 'C:\\source',
    environment: { PYTHON: '  C:\\approved\\python.exe  ' },
    platform: 'win32',
    fileExists: () => true,
  });

  assert.deepEqual(selected, {
    executable: 'C:\\approved\\python.exe',
    source: 'environment',
  });
});

test('the worker build environment is the default on Windows', () => {
  const selected = selectAutomationTestPython({
    root: 'C:\\source',
    environment: {},
    platform: 'win32',
    fileExists: (path) => path.endsWith('build\\worker-env\\Scripts\\python.exe'),
  });

  assert.equal(selected.source, 'managed-worker-environment');
  assert.match(selected.executable, /build\\worker-env\\Scripts\\python\.exe$/);
});

test('local source tests retain a system fallback before a worker build', () => {
  const selected = selectAutomationTestPython({
    root: 'C:\\source',
    environment: {},
    platform: 'win32',
    fileExists: () => false,
  });

  assert.deepEqual(selected, {
    executable: 'python',
    source: 'system-fallback',
  });
});
