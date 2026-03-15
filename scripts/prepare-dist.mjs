import { promises as fs } from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const wrapperPath = path.join(distDir, 'index.mjs');

const wrapperSource = `import pkg from './index.js';

export const initDevToolsManager = pkg.initDevToolsManager;
export default pkg;
`;

await fs.writeFile(wrapperPath, wrapperSource, 'utf8');
