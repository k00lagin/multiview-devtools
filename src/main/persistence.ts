import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { PersistenceAdapter, PersistedUiState } from '../shared/contracts';

const STATE_FILE_NAME = 'multiview-devtools.json';

export function createDefaultPersistenceAdapter(): PersistenceAdapter {
  const stateFilePath = path.join(app.getPath('userData'), STATE_FILE_NAME);

  return {
    async load() {
      try {
        const raw = await fs.readFile(stateFilePath, 'utf8');
        return JSON.parse(raw) as PersistedUiState;
      } catch {
        return undefined;
      }
    },
    async save(state) {
      await fs.mkdir(path.dirname(stateFilePath), { recursive: true });
      await fs.writeFile(stateFilePath, JSON.stringify(state, null, 2), 'utf8');
    },
  };
}
