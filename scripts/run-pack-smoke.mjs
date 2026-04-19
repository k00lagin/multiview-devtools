import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureSourceDir = path.join(rootDir, 'smoke', 'fixture-app');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronBinaryName = process.platform === 'win32' ? 'electron.cmd' : 'electron';
const DEFAULT_ELECTRON_VERSIONS = ['30.5.1', '35.7.5', '41.2.1'];

function quoteWindowsArg(value) {
  if (!value.length) {
    return '""';
  }

  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function runCommand(command, args, { cwd, env, label }) {
  return new Promise((resolve, reject) => {
    const sanitizedEnv = Object.fromEntries(
      Object.entries(env).filter(([, value]) => value != null),
    );
    const commandSpec =
      process.platform === 'win32'
        ? {
            command: 'cmd.exe',
            args: ['/d', '/s', '/c', [command, ...args].map(quoteWindowsArg).join(' ')],
          }
        : {
            command,
            args,
          };

    const child = spawn(commandSpec.command, commandSpec.args, {
      cwd,
      env: sanitizedEnv,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });

    let output = '';

    const onData = (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    };

    const onErrorData = (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onErrorData);

    child.on('error', (error) => {
      reject(error);
    });

    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve(output);
        return;
      }

      const suffix = signal ? ` (signal: ${signal})` : '';
      reject(new Error(`${label} failed with exit code ${code}${suffix}`));
    });
  });
}

async function runSmokeEntrypoint(fixtureDir, entrypoint, sentinel) {
  const electronPath = path.join(fixtureDir, 'node_modules', '.bin', electronBinaryName);
  const output = await runCommand(electronPath, [entrypoint], {
    cwd: fixtureDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
    },
    label: `electron ${entrypoint}`,
  });

  if (!output.includes(sentinel)) {
    throw new Error(`Missing smoke sentinel ${sentinel} for ${entrypoint}`);
  }
}

function getSmokeElectronVersions() {
  const rawValue = process.env.SMOKE_ELECTRON_VERSIONS;
  if (!rawValue) {
    return DEFAULT_ELECTRON_VERSIONS;
  }

  return rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function prepareFixture(tempRoot, tarballPath, electronVersion) {
  const fixtureDir = path.join(tempRoot, `fixture-app-electron-${electronVersion}`);
  await cp(fixtureSourceDir, fixtureDir, { recursive: true });

  await runCommand(
    npmCommand,
    ['install', '--no-audit', '--no-fund', `electron@${electronVersion}`],
    {
      cwd: fixtureDir,
      env: process.env,
      label: `fixture npm install electron@${electronVersion}`,
    },
  );

  await runCommand(npmCommand, ['install', '--no-audit', '--no-fund', tarballPath], {
    cwd: fixtureDir,
    env: process.env,
    label: `fixture npm install tarball for electron@${electronVersion}`,
  });

  const fixturePackageJson = await readFile(path.join(fixtureDir, 'package.json'), 'utf8');
  if (!fixturePackageJson.includes(`"electron": "^${electronVersion}"`)) {
    throw new Error(`Fixture dependency drifted from the tested Electron version ${electronVersion}`);
  }

  return fixtureDir;
}

async function main() {
  const electronVersions = getSmokeElectronVersions();
  if (!electronVersions.length) {
    throw new Error('No Electron versions configured for smoke testing');
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'multiview-devtools-pack-smoke-'));

  try {
    await runCommand(npmCommand, ['pack', '--pack-destination', tempRoot], {
      cwd: rootDir,
      env: process.env,
      label: 'npm pack',
    });

    const tgzEntries = (await readdir(tempRoot, { withFileTypes: true })).filter(
      (entry) => entry.isFile() && entry.name.endsWith('.tgz'),
    );

    if (tgzEntries.length !== 1) {
      throw new Error('Unable to determine packed tarball name');
    }

    const tarballPath = path.join(tempRoot, tgzEntries[0].name);
    for (const electronVersion of electronVersions) {
      const fixtureDir = await prepareFixture(tempRoot, tarballPath, electronVersion);
      await runSmokeEntrypoint(fixtureDir, 'main.cjs', 'SMOKE_OK:cjs');
      await runSmokeEntrypoint(fixtureDir, 'main.mjs', 'SMOKE_OK:esm');
    }
  } finally {
    await rm(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250,
    });
  }
}

await main();
