import smoke from './run-smoke.cjs';

void smoke.runSmoke('esm', () => import('multiview-devtools'));
