const configKeys = ['enabled', 'cliVariant', 'qodercliBin', 'qoderclicnBin', 'models', 'defaultModel', 'hiddenModels', 'tools', 'permissionMode', 'reasoningEffort', 'timeoutMs', 'contextWindow', 'maxPromptChars', 'workspaceRoot', 'maxConcurrency', 'queueTimeoutMs', 'stallWarnMs', 'askTool', 'modelContext'];
const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const modelId = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.exec(value)?.[0] === value && !value.includes(':/') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
/** Host authentication remains authoritative; additionally reject browser cross-origin requests. */
export function registerSettingsRoutes(server, store, notify, readRuns = () => []) {
    let disposed = false;
    const disposers = [];
    const snapshot = () => ({ config: Object.fromEntries(configKeys.map(key => [key, store.config[key]])), runs: publicRuns(readRuns()) });
    for (const action of ['status', 'config']) {
        const dispose = server.register({ kind: 'exact', path: `/plugins/qoder-link/${action}`, handler: (req, res) => {
                void (async () => {
                    const send = (code, body) => {
                        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
                        res.end(JSON.stringify(body));
                    };
                    if (disposed) {
                        send(503, { error: '插件已停用' });
                        return;
                    }
                    const method = action === 'status' ? 'GET' : 'POST';
                    if (req.method !== method) {
                        res.setHeader('Allow', method);
                        send(405, { error: `${method} only` });
                        return;
                    }
                    const origin = req.headers.origin;
                    if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && !sameHost(origin, req.headers.host))) {
                        send(403, { error: 'Cross-origin request denied' });
                        return;
                    }
                    try {
                        if (action === 'config') {
                            if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
                                send(415, { error: 'JSON required' });
                                return;
                            }
                            const body = await readJson(req);
                            if (!record(body) || Object.keys(body).some(key => !configKeys.includes(key))) {
                                send(400, { error: '设置必须是仅包含已知字段的 JSON 对象' });
                                return;
                            }
                            if (disposed) {
                                send(503, { error: '插件已停用' });
                                return;
                            }
                            store.update(body);
                            // Saving has succeeded even if a host refresh listener fails.
                            try {
                                notify();
                            }
                            catch { /* no host diagnostics in public responses */ }
                        }
                        send(200, snapshot());
                    }
                    catch {
                        // Never echo parser, filesystem, runner or submitted-value diagnostics.
                        send(action === 'config' ? 400 : 500, { error: action === 'config' ? '设置保存失败，请检查字段类型、取值范围和配置目录权限。' : '状态读取失败，请重试。' });
                    }
                })();
            } });
        if (typeof dispose === 'function')
            disposers.push(dispose);
    }
    return () => { if (disposed)
        return; disposed = true; for (const dispose of disposers.reverse())
        dispose(); };
}
function sameHost(origin, host) {
    try {
        const url = new URL(origin);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.origin === origin && url.host === host;
    }
    catch {
        return false;
    }
}
async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += data.length;
        if (size > 32768)
            throw new Error('Request body too large');
        chunks.push(data);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** Deliberate allowlist: prompts, outputs, errors, credentials and billing never leave the runner. */
function publicRuns(values) {
    if (!Array.isArray(values))
        return [];
    const result = [];
    for (const run of values) {
        if (!record(run) || typeof run.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(run.id)
            || !['model', 'ask'].includes(String(run.source))
            || !['queued', 'starting', 'waiting', 'responding', 'completed', 'failed', 'cancelled'].includes(String(run.state))
            || typeof run.queuedAt !== 'number' || !Number.isFinite(run.queuedAt) || run.queuedAt < 0)
            continue;
        const clean = { id: run.id, source: run.source, state: run.state, queuedAt: run.queuedAt,
            requestedModel: modelId(run.requestedModel) ? run.requestedModel : 'unknown',
            requestedEffort: ['auto', 'low', 'medium', 'high'].includes(String(run.requestedEffort)) ? run.requestedEffort : 'auto',
            warning: run.warning === true, contextOverrideSent: false, reasoningConfirmed: false,
            queuePosition: Number.isSafeInteger(run.queuePosition) && Number(run.queuePosition) >= 0 ? run.queuePosition : 0 };
        if (modelId(run.returnedModel))
            clean.returnedModel = run.returnedModel;
        if (run.contextSource === 'model' || run.contextSource === 'fallback')
            clean.contextSource = run.contextSource;
        for (const key of ['contextWindow', 'startedAt', 'lastProgressAt', 'endedAt']) {
            if (typeof run[key] === 'number' && Number.isFinite(run[key]) && run[key] >= 0)
                clean[key] = run[key];
        }
        if (['timeout', 'queue-timeout', 'aborted', 'error'].includes(String(run.failure)))
            clean.failure = run.failure;
        result.push(clean);
    }
    return result.sort((a, b) => Number(b.queuedAt) - Number(a.queuedAt)).slice(0, 5);
}
//# sourceMappingURL=web.js.map