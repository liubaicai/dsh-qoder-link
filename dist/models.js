import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectedBin } from "./config.js";
import { childEnv, resolveQoderBin, killTree } from "./runner.js";
import { isModelIdentifier } from "./metadata.js";
export const modelFailure = '模型列表获取失败，请检查 CLI 安装、登录与网络后重试。';
const fail = () => new Error(modelFailure);
/** Parse only the observed official --list-models table, never arbitrary diagnostics. */
export function parseModels(output) {
    const lines = output.replace(/\x1b\[[0-9;]*m/g, '').trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.shift() !== 'MODEL' || !lines.length || lines.length > 256 || lines.some(line => !isModelIdentifier(line)))
        throw fail();
    return [...new Set(lines)].map(id => ({ id, name: id }));
}
/** No prompt, auth inspection, shell, or workspace settings: CLI owns authentication. */
export async function discoverModels(config, timeoutMs = 12000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000)
        throw fail();
    let cwd;
    try {
        const bin = await resolveQoderBin(selectedBin(config), process.cwd());
        cwd = await mkdtemp(join(tmpdir(), 'qoder-models-'));
        const output = await new Promise((resolve, reject) => {
            const child = spawn(bin.command, [...bin.args, '--list-models'], { cwd, env: childEnv(), shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
            let settled = false, stopping = false, bytes = 0;
            const chunks = [];
            const finish = (error) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                if (error)
                    reject(error);
                else
                    resolve(Buffer.concat(chunks).toString('utf8'));
            };
            const stop = () => {
                if (settled || stopping)
                    return;
                stopping = true;
                void killTree(child).catch(() => { }).finally(() => finish(fail()));
            };
            const timer = setTimeout(stop, timeoutMs);
            child.once('error', () => finish(fail()));
            child.once('close', code => { if (!stopping)
                finish(code === 0 ? undefined : fail()); });
            child.stdout.on('data', (chunk) => { bytes += chunk.length; if (bytes > 65536)
                stop();
            else if (!stopping)
                chunks.push(chunk); });
            child.stderr.on('data', (chunk) => { bytes += chunk.length; if (bytes > 65536)
                stop(); });
        });
        return { models: parseModels(output), message: '已获取当前 CLI 模型列表。' };
    }
    catch {
        throw fail();
    }
    finally {
        if (cwd)
            await rm(cwd, { recursive: true, force: true }).catch(() => { });
    }
}
//# sourceMappingURL=models.js.map