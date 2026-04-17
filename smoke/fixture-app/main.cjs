'use strict';

const { runSmoke } = require('./run-smoke.cjs');

void runSmoke('cjs', () => require('multiview-devtools'));
