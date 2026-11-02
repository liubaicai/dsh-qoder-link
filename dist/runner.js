import { spawn } from 'node:child_process';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { runQoderAcp } from "./acp.js";
/** Resolve PATH and official per-user installs without invoking a shell or crossing regions. */
export async function resolveQoderBin(bin = 'qodercli', cwd = process.cwd(), env = process.env) {
    const explicitPath = isAbsolute(bin) || /[\\/]/.test(bin);
    const cli = /^(qodercli|qoderclicn)(?:\.exe)?$/i.exec(bin)?.[1]?.toLowerCase();
    let candidates;
    if (explicitPath)
        candidates = [resolve(cwd, bin)];
    else {
        // Electron can retain a PATH from before the CLI was installed. Keep PATH
        // precedence, then inspect only known locations for the requested region.
        const path = Object.entries(env).find(([key]) => process.platform === 'win32' ? key.toUpperCase() === 'PATH' : key === 'PATH')?.[1] ?? '';
        candidates = path.split(delimiter).filter(Boolean).map(path => join(path.replace(/^"|"$/g, ''), bin));
        if (cli) {
            const home = (process.platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir();
            candidates.push(join(home, cli === 'qoderclicn' ? '.qoder-cn' : '.qoder', 'bin', cli, cli + (process.platform === 'win32' ? '.exe' : '')));
            if (process.platform === 'win32')
                candidates.push(join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'npm', cli));
            else
                candidates.push(join(home, '.local', 'bin', cli));
        }
    }
    const extensions = process.platform === 'win32' ? ['', '.cmd', '.exe', '.ps1', '.bat'] : [''];
    for (const candidate of candidates) {
        for (const extension of extname(candidate) ? [''] : extensions) {
            const path = candidate + extension;
            try {
                await access(path, process.platform === 'win32' || ['.js', '.mjs', '.cjs'].includes(extname(path)) ? constants.F_OK : constants.X_OK);
            }
            catch {
                continue;
            }
            const resolved = await realpath(path);
            if (!(await stat(resolved)).isFile())
                throw new Error('Unsupported Qoder launcher; provide the actual CLI JavaScript file');
            const ext = extname(resolved).toLowerCase();
            if (['.js', '.mjs', '.cjs'].includes(ext))
                return { command: process.execPath, args: [resolved] };
            if (['.cmd', '.bat', '.ps1'].includes(ext) || (process.platform === 'win32' && !ext)) {
                const source = await readFile(resolved, 'utf8');
                // Only an npm-style basedir-relative node_modules path is accepted.
                const match = source.match(/(?:%~?dp0%?|%dp0%|\$basedir)[\\/]([^"'\r\n]*?node_modules[\\/][^"'\r\n]+)/i);
                if (match) {
                    const target = await realpath(resolve(dirname(resolved), match[1].replace(/[\\/]/g, '/')));
                    await access(target, constants.R_OK);
                    // A recognized shim must point to a Node entry, not a shell or directory.
                    if (!(await stat(target)).isFile() || (!['.js', '.mjs', '.cjs'].includes(extname(target).toLowerCase())
                        && (extname(target) || !/^#![^\r\n]*\bnode\b/.test(await readFile(target, 'utf8'))))) {
                        throw new Error('Unsupported Qoder launcher; provide the actual CLI JavaScript file');
                    }
                    return { command: process.execPath, args: [target] };
                }
                if (!ext && /^#![^\r\n]*\bnode\b/.test(source))
                    return { command: process.execPath, args: [resolved] };
                throw new Error('Unsupported Qoder launcher; provide the actual CLI JavaScript file');
            }
            return { command: resolved, args: [] };
        }
    }
    throw new Error(cli && !explicitPath
        ? `Qoder executable not found (${cli}); check that CLI's installation or configure its full path in Qoder Link settings`
        : 'Qoder executable not found at the configured path or command; check the selected region and CLI path in Qoder Link settings');
}
/**
 * Children must run as plain Node. When the DSH host is an Electron app,
 * process.execPath is the GUI binary: spawning it with a script argument would
 * start a second GUI instance that never answers and hangs the request until
 * timeout. ELECTRON_RUN_AS_NODE makes an Electron binary behave as plain Node;
 * a real Node executable simply ignores the variable.
 */
export function childEnv() {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    // Both regions use the CLI's own disk login, never inherited shell PATs.
    // Preserve home/config paths; Windows environment names ignore casing.
    for (const key of Object.keys(env))
        if (['QODER_PERSONAL_ACCESS_TOKEN', 'QODERCN_PERSONAL_ACCESS_TOKEN'].includes(key.toUpperCase()))
            delete env[key];
    return env;
}
export async function killTree(child) {
    if (!child.pid)
        return;
    if (process.platform === 'win32') {
        await new Promise(resolveKill => {
            const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
            const timer = setTimeout(() => { killer.kill(); child.kill('SIGKILL'); resolveKill(); }, 3000);
            killer.once('error', () => { clearTimeout(timer); child.kill('SIGKILL'); resolveKill(); });
            killer.once('close', () => { clearTimeout(timer); resolveKill(); });
        });
    }
    else {
        try {
            process.kill(-child.pid, 'SIGKILL');
        }
        catch {
            try {
                child.kill('SIGKILL');
            }
            catch { /* Already exited. */ }
        }
    }
}
/** One fresh native ACP session per complete conversation prompt. */
export async function* runQoder(request) {
    yield* runQoderAcp(request);
}
//# sourceMappingURL=runner.js.map