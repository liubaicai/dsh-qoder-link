import { spawn, type ChildProcess } from 'node:child_process';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { runQoderAcp } from './acp.ts';
import type { BridgeEvent } from './protocol.ts';
export type { BridgeEvent } from './protocol.ts';

export interface QoderRequest {
  prompt: string;
  systemPrompt?: string;
  cwd: string;
  model?: string;
  effort?: string;
  /** Internal lifecycle notification; never passed to the CLI. */
  onSpawn?: () => void;
  permissionMode?: 'dont_ask' | 'accept_edits' | 'default';
  tools?: string;
  bin?: string;
  /** Inactivity budget, renewed only by validated ACP progress. */
  timeoutMs?: number;
  cliVariant?: 'qodercli' | 'qoderclicn';
  signal?: AbortSignal;
}


/** Resolve npm's Windows launchers without ever invoking cmd.exe or PowerShell. */
export async function resolveQoderBin(bin = 'qodercli', cwd = process.cwd()): Promise<{ command: string; args: string[] }> {
  let candidates: string[];
  if (isAbsolute(bin) || /[\\/]/.test(bin)) candidates = [resolve(cwd, bin)];
  else candidates = (process.env.PATH ?? '').split(delimiter).filter(Boolean).map(path => join(path.replace(/^"|"$/g, ''), bin));
  const extensions = process.platform === 'win32' ? ['', '.cmd', '.exe', '.ps1', '.bat'] : [''];
  for (const candidate of candidates) {
    for (const extension of extname(candidate) ? [''] : extensions) {
      const path = candidate + extension;
      try { await access(path, process.platform === 'win32' || ['.js', '.mjs', '.cjs'].includes(extname(path)) ? constants.F_OK : constants.X_OK); }
      catch { continue; }
      const resolved = await realpath(path);
      if (!(await stat(resolved)).isFile()) throw new Error('Unsupported Qoder launcher; provide the actual CLI JavaScript file');
      const ext = extname(resolved).toLowerCase();
      if (['.js', '.mjs', '.cjs'].includes(ext)) return { command: process.execPath, args: [resolved] };
      if (['.cmd', '.bat', '.ps1'].includes(ext) || (process.platform === 'win32' && !ext)) {
        const source = await readFile(resolved, 'utf8');
        // Only an npm-style basedir-relative node_modules path is accepted.
        const match = source.match(/(?:%~?dp0%?|%dp0%|\$basedir)[\\/]([^"'\r\n]*?node_modules[\\/][^"'\r\n]+)/i);
        if (match) {
          const target = await realpath(resolve(dirname(resolved), match[1]!.replace(/[\\/]/g, '/')));
          await access(target, constants.R_OK);
          // A recognized shim must point to a Node entry, not a shell or directory.
          if (!(await stat(target)).isFile() || (!['.js', '.mjs', '.cjs'].includes(extname(target).toLowerCase())
            && (extname(target) || !/^#![^\r\n]*\bnode\b/.test(await readFile(target, 'utf8'))))) {
            throw new Error('Unsupported Qoder launcher; provide the actual CLI JavaScript file');
          }
          return { command: process.execPath, args: [target] };
        }
        if (!ext && /^#![^\r\n]*\bnode\b/.test(source)) return { command: process.execPath, args: [resolved] };
        throw new Error('Unsupported Qoder launcher; provide the actual CLI JavaScript file');
      }
      return { command: resolved, args: [] };
    }
  }
  throw new Error('Qoder executable not found; install qodercli or configure bin');
}


/**
 * Children must run as plain Node. When the DSH host is an Electron app,
 * process.execPath is the GUI binary: spawning it with a script argument would
 * start a second GUI instance that never answers and hangs the request until
 * timeout. ELECTRON_RUN_AS_NODE makes an Electron binary behave as plain Node;
 * a real Node executable simply ignores the variable.
 */
export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  // Both regions use the CLI's own disk login, never inherited shell PATs.
  // Preserve home/config paths; Windows environment names ignore casing.
  for (const key of Object.keys(env)) if (['QODER_PERSONAL_ACCESS_TOKEN', 'QODERCN_PERSONAL_ACCESS_TOKEN'].includes(key.toUpperCase())) delete env[key];
  return env;
}

export async function killTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await new Promise<void>(resolveKill => {
      const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => { killer.kill(); child.kill('SIGKILL'); resolveKill(); }, 3000);
      killer.once('error', () => { clearTimeout(timer); child.kill('SIGKILL'); resolveKill(); });
      killer.once('close', () => { clearTimeout(timer); resolveKill(); });
    });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch { try { child.kill('SIGKILL'); } catch { /* Already exited. */ } }
  }
}

/** One fresh native ACP session per complete conversation prompt. */
export async function* runQoder(request: QoderRequest): AsyncGenerator<BridgeEvent> {
  yield* runQoderAcp(request);
}
