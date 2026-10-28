import { isAbsolute } from 'node:path';
import { isModelIdentifier } from "./metadata.js";
export const QODER_EFFORTS = ['auto', 'low', 'medium', 'high'];
export function isQoderEffort(value) {
    return typeof value === 'string' && QODER_EFFORTS.includes(value);
}
export function resolveConfig(entry = {}, env = process.env) {
    const value = (key, variable, fallback) => entry[key] ?? env[variable] ?? fallback;
    const string = (key, variable, fallback = '') => {
        const v = value(key, variable, fallback);
        if (typeof v !== 'string')
            throw new Error(`${key} must be a string`);
        return v.trim();
    };
    const bool = (key, variable, fallback) => {
        const v = value(key, variable, fallback);
        if (v === true || v === 'true')
            return true;
        if (v === false || v === 'false')
            return false;
        throw new Error(`${key} must be true or false`);
    };
    const number = (key, variable, fallback) => {
        const v = Number(value(key, variable, fallback));
        if (!Number.isSafeInteger(v) || v <= 0)
            throw new Error(`${key} must be a positive integer`);
        return v;
    };
    const boundedInteger = (key, variable, fallback, min, max) => {
        const raw = value(key, variable, fallback);
        const v = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? Number(raw) : NaN;
        if (!Number.isSafeInteger(v) || v < min || v > max)
            throw new Error(`${key} must be an integer from ${min} to ${max}`);
        return v;
    };
    const reasoningEffort = string('reasoningEffort', 'DSH_QODER_REASONING_EFFORT', 'auto');
    if (!isQoderEffort(reasoningEffort))
        throw new Error(`reasoningEffort must be ${QODER_EFFORTS.join(', ')}`);
    const mode = string('permissionMode', 'DSH_QODER_MODE', 'dont_ask');
    if (mode !== 'dont_ask' && mode !== 'default' && mode !== 'accept_edits')
        throw new Error('permissionMode must be dont_ask, default or accept_edits');
    const model = string('defaultModel', 'DSH_QODER_DEFAULT_MODEL', 'default') || 'default';
    const rawModels = value('models', 'DSH_QODER_MODELS', '');
    if (!Array.isArray(rawModels) && typeof rawModels !== 'string')
        throw new Error('models must be an array or comma-separated string');
    const models = Array.isArray(rawModels) ? rawModels : rawModels.split(',');
    const hidden = value('hiddenModels', 'DSH_QODER_HIDDEN_MODELS', []);
    const hiddenModels = Array.isArray(hidden) ? hidden : typeof hidden === 'string' ? hidden.split(',').filter(Boolean) : null;
    if (!hiddenModels || hiddenModels.some(v => !isModelIdentifier(v)))
        throw new Error('Invalid hiddenModels');
    const cleanModels = [...new Set(['default', model, ...models].map(v => {
            if (typeof v !== 'string')
                throw new Error('models must contain strings');
            return v.trim();
        }).filter(Boolean))];
    if (cleanModels.some(v => !isModelIdentifier(v)))
        throw new Error('Invalid model id');
    const rawModelContext = value('modelContext', 'DSH_QODER_MODEL_CONTEXT', {});
    const modelContextSource = typeof rawModelContext === 'string' ? JSON.parse(rawModelContext) : rawModelContext;
    if (!modelContextSource || typeof modelContextSource !== 'object' || Array.isArray(modelContextSource))
        throw new Error('modelContext must be an object');
    const modelContext = {};
    for (const [id, window] of Object.entries(modelContextSource)) {
        if (!isModelIdentifier(id))
            throw new Error('Invalid modelContext id');
        const size = Number(window);
        if (!Number.isSafeInteger(size) || size <= 0)
            throw new Error(`Invalid context window for ${id}`);
        modelContext[id] = size;
    }
    const cliVariant = string('cliVariant', 'DSH_QODER_CLI_VARIANT', 'qodercli');
    if (cliVariant !== 'qodercli' && cliVariant !== 'qoderclicn')
        throw new Error('cliVariant must be qodercli or qoderclicn');
    const workspaceRoot = string('workspaceRoot', 'DSH_QODER_WORKSPACE_ROOT');
    if (workspaceRoot && !isAbsolute(workspaceRoot))
        throw new Error('workspaceRoot must be absolute');
    if (hiddenModels.includes(model))
        throw new Error('Default model must be enabled');
    return {
        enabled: bool('enabled', 'DSH_QODER_ENABLED', true),
        cliVariant,
        qodercliBin: string('qodercliBin', 'DSH_QODERCLI_BIN'),
        qoderclicnBin: string('qoderclicnBin', 'DSH_QODERCLICN_BIN'),
        defaultModel: model, models: cleanModels, hiddenModels: [...new Set(hiddenModels)],
        workspaceRoot,
        permissionMode: mode, tools: string('tools', 'DSH_QODER_TOOLS'),
        timeoutMs: boundedInteger('timeoutMs', 'DSH_QODER_TIMEOUT_MS', 600000, 1, 2147483647),
        reasoningEffort,
        maxConcurrency: boundedInteger('maxConcurrency', 'DSH_QODER_MAX_CONCURRENCY', 2, 1, 16),
        queueTimeoutMs: boundedInteger('queueTimeoutMs', 'DSH_QODER_QUEUE_TIMEOUT_MS', 600000, 1, 2147483647),
        stallWarnMs: boundedInteger('stallWarnMs', 'DSH_QODER_STALL_WARN_MS', 90000, 0, 2147483647),
        contextWindow: number('contextWindow', 'DSH_QODER_CONTEXT_WINDOW', 128000),
        modelContext,
        maxPromptChars: number('maxPromptChars', 'DSH_QODER_MAX_PROMPT_CHARS', 1000000),
        askTool: bool('askTool', 'DSH_QODER_ASK_TOOL', true),
    };
}
/** No cross-region fallback: each binary uses its own CLI login. */
export function selectedBin(config) {
    return (config.cliVariant === 'qoderclicn' ? config.qoderclicnBin : config.qodercliBin) || config.cliVariant;
}
//# sourceMappingURL=config.js.map