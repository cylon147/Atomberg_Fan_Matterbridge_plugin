/**
 * clean.mjs
 * Dependency-free replacement for `npx shx rm -rf *.tsbuildinfo dist build`.
 */

import { readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

const rm = (dir, target) => {
  try {
    rmSync(resolve(dir, target), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'ENOTEMPTY') {
      console.warn(`Skipped locked path (${error.code}): ${error.path ?? target} - likely held by a running process.`);
      return;
    }
    throw error;
  }
};

const clean = (dir) => {
  let targets;
  try {
    targets = readdirSync(dir).filter((name) => name.endsWith('.tsbuildinfo'));
  } catch {
    return;
  }
  targets.push('dist', 'build');
  for (const target of targets) {
    rm(dir, target);
  }
};

clean(root);
