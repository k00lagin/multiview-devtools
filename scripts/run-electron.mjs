import { spawn } from 'node:child_process';

import electronPath from 'electron';

const child = spawn(electronPath, process.argv.slice(2), {
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: undefined,
  },
  stdio: 'inherit',
  windowsHide: false,
});

child.on('exit', (code, signal) => {
  if (code == null) {
    console.error(`Electron exited with signal ${signal}`);
    process.exit(1);
  }

  process.exit(code);
});
