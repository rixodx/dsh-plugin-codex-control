import os from 'node:os';
import path from 'node:path';

export function harnessHome(explicit) {
  return path.resolve(explicit || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'));
}
export function bridgeRoot(explicit) {
  return path.join(harnessHome(explicit), 'cli-bridge-v1');
}
