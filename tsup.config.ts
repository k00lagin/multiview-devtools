import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    shims: true,
    platform: 'node',
    target: 'node20',
    external: ['electron'],
    outExtension({ format }) {
      return {
        js: format === 'esm' ? '.mjs' : '.cjs',
      };
    },
  },
  {
    entry: {
      preload: 'src/preload/index.ts',
    },
    format: ['cjs'],
    clean: false,
    splitting: false,
    sourcemap: true,
    shims: true,
    platform: 'node',
    target: 'node20',
    external: ['electron'],
    outExtension() {
      return {
        js: '.cjs',
      };
    },
  },
]);
