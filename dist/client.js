window.__ModuleLoader__.load({ id: "dsh-qoder-link", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = exports.name = void 0;
exports.validateConfig = validateConfig;
exports.parseStatus = parseStatus;
exports.apply = apply;
const { createElement, useState, useEffect, useRef } = require('react');
exports.name = 'dsh-qoder-link-client';
exports.inject = ['slots'];
const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const efforts = ['auto', 'low', 'medium', 'high'];
const modes = ['dont_ask', 'default', 'accept_edits'];
const modelId = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.exec(value)?.[0] === value && !value.includes(':/') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
const integer = (value, min, max = Number.MAX_SAFE_INTEGER) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const modelMessages = ['已获取当前 CLI 模型列表。', '模型列表获取失败，请检查 CLI 安装、登录与网络后重试。', '模型列表尚未加载。'];
function validateConfig(value) {
    if (!record(value))
        return '设置格式无效';
    if (typeof value.enabled !== 'boolean' || typeof value.askTool !== 'boolean' || !['qodercli', 'qoderclicn'].includes(String(value.cliVariant)))
        return '请选择有效的 CLI 版本';
    if (!['qodercliBin', 'qoderclicnBin', 'workspaceRoot', 'tools'].every(key => typeof value[key] === 'string'))
        return 'CLI 路径和工具配置必须是文本';
    if (String(value.workspaceRoot).trim() && !/^(?:[a-zA-Z]:[\\/]|\/|\\\\)/.test(String(value.workspaceRoot).trim()))
        return '工作目录必须是绝对路径';
    if (!Array.isArray(value.models) || !value.models.length || !value.models.every(modelId) || !Array.isArray(value.hiddenModels) || !value.hiddenModels.every(modelId))
        return '模型列表不能为空，模型 ID 只能包含字母、数字和 . _ : / -';
    if (!modelId(value.defaultModel) || !value.models.includes(value.defaultModel) || value.hiddenModels.includes(value.defaultModel))
        return '默认模型必须在列表中且未被隐藏';
    if (!modes.includes(String(value.permissionMode)) || !efforts.includes(String(value.reasoningEffort)))
        return '请选择有效的权限模式与推理强度';
    if (!integer(value.maxConcurrency, 1, 16) || !integer(value.timeoutMs, 1, 2147483647) || !integer(value.queueTimeoutMs, 1, 2147483647) || !integer(value.stallWarnMs, 0, 2147483647))
        return '并发数须为 1 至 16；时间须为有效整数，无进展提醒可设为 0';
    if (!integer(value.contextWindow, 1) || !integer(value.maxPromptChars, 1))
        return '上下文预算与提示词长度必须是正整数';
    if (!record(value.modelContext) || !Object.entries(value.modelContext).every(([id, size]) => modelId(id) && integer(size, 1)))
        return '模型上下文映射须为模型 ID 到正整数的 JSON 对象';
    return '';
}
function parseStatus(value) {
    if (!record(value) || (value.settingsError !== undefined && typeof value.settingsError !== 'string') || validateConfig(value.config) || !Array.isArray(value.runs))
        throw new Error('服务端状态格式无效');
    const catalog = value.catalogModels ?? [];
    if (!Array.isArray(catalog) || catalog.length > 1000 || !catalog.every(item => record(item) && modelId(item.id) && typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 128 && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(item.name)))
        throw new Error('服务端状态格式无效');
    const runs = [];
    for (const run of value.runs) {
        if (!record(run) || typeof run.id !== 'string' || !['queued', 'starting', 'waiting', 'responding', 'completed', 'failed', 'cancelled'].includes(String(run.state)) || !integer(run.queuedAt, 0))
            continue;
        runs.push({ id: run.id, state: String(run.state), requestedModel: modelId(run.requestedModel) ? run.requestedModel : 'unknown', requestedEffort: efforts.includes(String(run.requestedEffort)) ? String(run.requestedEffort) : 'auto', queuedAt: run.queuedAt, warning: run.warning === true,
            failure: ['timeout', 'queue-timeout', 'aborted', 'error'].includes(String(run.failure)) ? String(run.failure) : undefined,
            lastProgressAt: integer(run.lastProgressAt, 0) ? run.lastProgressAt : undefined });
    }
    const c = value.config;
    const config = { enabled: c.enabled, cliVariant: c.cliVariant, qodercliBin: c.qodercliBin, qoderclicnBin: c.qoderclicnBin, models: c.models, hiddenModels: c.hiddenModels, defaultModel: c.defaultModel, tools: c.tools, permissionMode: c.permissionMode, reasoningEffort: c.reasoningEffort, timeoutMs: c.timeoutMs, contextWindow: c.contextWindow, maxPromptChars: c.maxPromptChars, workspaceRoot: c.workspaceRoot, maxConcurrency: c.maxConcurrency, queueTimeoutMs: c.queueTimeoutMs, stallWarnMs: c.stallWarnMs, askTool: c.askTool, modelContext: c.modelContext };
    return { settingsError: typeof value.settingsError === 'string' && value.settingsError.length > 0, config, runs: runs.sort((a, b) => b.queuedAt - a.queuedAt).slice(0, 5),
        catalogModels: catalog.map(item => ({ id: item.id, name: item.name })), modelMessage: modelMessages.includes(String(value.modelMessage)) ? String(value.modelMessage) : modelMessages[2] };
}
async function request(action, body) {
    let response;
    try {
        response = await fetch(`/plugins/qoder-link/${action}`, { method: action === 'status' ? 'GET' : 'POST', credentials: 'same-origin', mode: 'same-origin', signal: AbortSignal.timeout(20000),
            ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    }
    catch {
        throw new Error('请求失败或超时，请检查连接后重试。');
    }
    if (!response.ok)
        throw new Error(`请求失败（HTTP ${response.status}），请检查设置后重试。`);
    try {
        return parseStatus(await response.json());
    }
    catch {
        throw new Error('服务端状态格式无效，请重试。');
    }
}
const border = '0.5px solid var(--dsw-alias-border-l2, var(--gray-6))';
const foreground = 'var(--dsw-alias-label-primary, var(--gray-12))';
const secondary = 'var(--dsw-alias-label-secondary, var(--gray-11))';
const accent = 'var(--dsw-alias-state-business-primary, var(--accent-9))';
const control = { font: 'inherit', fontSize: '13px', minHeight: '30px', boxSizing: 'border-box', border, borderRadius: '6px', padding: '4px 9px', color: foreground, background: 'var(--dsw-alias-bg-layer-1, var(--gray-2))' };
const field = { display: 'flex', flexDirection: 'column', gap: '5px', minWidth: 0 };
const box = { padding: '14px', border, borderRadius: '8px', marginBottom: '14px', minWidth: 0 };
const row = { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: '12px', marginBottom: '12px' };
const selectedStyle = { borderColor: accent, color: accent, background: 'var(--accent-3)' };
function h(type, props, ...children) {
    const styles = {
        input: props?.type === 'checkbox' ? { width: '16px', height: '16px', accentColor: accent, marginRight: '8px' } : { ...control, width: '100%' },
        select: { ...control, width: '100%' }, textarea: { ...control, width: '100%', minHeight: '64px' },
        button: { ...control, fontWeight: 500, cursor: props?.disabled ? 'not-allowed' : 'pointer', opacity: props?.disabled ? 0.5 : 1 },
        h2: { fontSize: '16px', margin: 0, fontWeight: 600 }, h3: { fontSize: '14px', margin: 0, fontWeight: 600 },
        legend: { fontSize: '14px', fontWeight: 600, padding: '0 6px' },
        p: { margin: '8px 0', lineHeight: 1.6, color: secondary },
    };
    return createElement(type, { ...props, style: { ...(typeof type === 'string' ? styles[type] : {}), ...(props?.role === 'alert' ? { color: 'var(--red-11)' } : {}), ...(props?.style ?? {}) } }, ...children);
}
const cliKey = (c) => JSON.stringify([c.cliVariant, c.qodercliBin, c.qoderclicnBin, c.workspaceRoot]);
const safety = '模型提供方调用始终禁用 CLI 内置工具。独立委派仅在显式配置 tools 后启用 CLI 工具，在 DSH 文件沙箱之外执行，可访问系统账户有权访问的资源。权限模式不是 DSH 沙箱，default 可能要求交互确认。仅在信任当前工作区时启用。';
function SettingsPanel() {
    const [status, storeStatus] = useState(null);
    const [draft, storeDraft] = useState(null);
    const draftRef = useRef(null);
    const statusRef = useRef(null);
    const setStatus = (result) => { statusRef.current = result; storeStatus(result); };
    const setDraft = (config) => { draftRef.current = config; storeDraft(config); };
    const [busy, setBusy] = useState('正在加载状态');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [hover, setHover] = useState(false);
    const [focus, setFocus] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const helpId = useRef(`qoder-safety-${Math.random().toString(36).slice(2)}`);
    const live = useRef(false);
    const pending = useRef(false);
    const sequence = useRef(0);
    const polling = useRef(null);
    const dirtyCli = () => !!draftRef.current && !!statusRef.current && cliKey(draftRef.current) !== cliKey(statusRef.current.config);
    async function load(action) {
        if (!live.current || pending.current || (action === 'config' && (statusRef.current?.settingsError || !draftRef.current || validateConfig(draftRef.current))) || (action === 'models' && (dirtyCli() || statusRef.current?.settingsError)))
            return;
        pending.current = true;
        const ticket = ++sequence.current;
        const current = () => live.current && ticket === sequence.current;
        setBusy(action === 'config' ? '正在保存设置' : action === 'models' ? '正在获取模型' : '正在加载状态');
        setError('');
        setNotice('');
        try {
            if (polling.current)
                await polling.current;
            if (!current())
                return;
            if (action === 'config' && statusRef.current?.settingsError)
                return;
            if (action === 'models' && dirtyCli())
                return;
            const previousKey = statusRef.current ? cliKey(statusRef.current.config) : '';
            const result = await request(action === 'initial' ? 'status' : action, action === 'config' ? draftRef.current : action === 'models' ? {} : undefined);
            if (!current())
                return;
            setStatus(result);
            if (action === 'config' || !draftRef.current)
                setDraft(result.config);
            if (action === 'config')
                setNotice('设置已保存。后续调用使用新设置。');
            if (!result.settingsError && (action === 'initial' || (action === 'config' && previousKey !== cliKey(result.config)))) {
                setBusy('正在获取模型');
                const models = await request('models', {});
                if (!current())
                    return;
                setStatus(models);
            }
        }
        catch (cause) {
            if (current())
                setError(cause instanceof Error ? cause.message : '请求失败，请重试。');
        }
        finally {
            if (ticket === sequence.current) {
                pending.current = false;
                if (live.current)
                    setBusy('');
            }
        }
    }
    function poll() {
        if (!live.current || pending.current || polling.current)
            return;
        const ticket = ++sequence.current;
        const work = request('status').then(result => { if (live.current && ticket === sequence.current)
            setStatus(result); })
            .catch(() => { }).finally(() => { if (polling.current === work)
            polling.current = null; });
        polling.current = work;
    }
    useEffect(() => {
        live.current = true;
        void load('initial');
        const timer = setInterval(poll, 2000);
        return () => { clearInterval(timer); live.current = false; ++sequence.current; pending.current = false; polling.current = null; };
    }, []);
    const update = (patch) => { if (draftRef.current)
        setDraft({ ...draftRef.current, ...patch }); setNotice(''); };
    const valueChange = (key) => (event) => update({ [key]: event.target.value });
    const textField = (key, label) => h('label', { style: field }, label, h('input', { value: draft?.[key] ?? '', onChange: valueChange(key) }));
    const select = (key, label, values, labels) => h('label', { style: field }, label, h('select', { value: draft?.[key], disabled: key === 'defaultModel' && dirtyCli(), onChange: valueChange(key) }, !values.includes(draft?.[key] ?? '') ? h('option', { value: draft?.[key] ?? '', disabled: true }, '请选择有效值') : null, ...values.map(value => h('option', { key: value, value }, labels?.get(value) ?? value))));
    const validation = draft ? validateConfig(draft) : '';
    const changedCli = dirtyCli();
    const locked = !!busy;
    const models = new Map();
    if (!changedCli) {
        for (const model of status?.catalogModels ?? [])
            models.set(model.id, model.name);
        for (const id of [...(draft?.models ?? []), ...(draft?.hiddenModels ?? [])])
            if (!models.has(id))
                models.set(id, id);
    }
    const enabled = [...models.keys()].filter(id => draft?.models.includes(id) && !draft.hiddenModels.includes(id));
    const tooltip = !dismissed && (hover || focus);
    return h('section', { 'aria-label': 'Qoder 设置', 'aria-busy': locked, style: { maxWidth: '800px', width: '100%', boxSizing: 'border-box', padding: '16px', fontSize: '13px', lineHeight: 1.5, color: foreground } }, h('div', { style: { ...row, marginBottom: '12px' } }, h('h2', null, 'Qoder')), h('div', { role: 'status', 'aria-live': 'polite', style: { color: secondary } }, busy ? `${busy}…` : notice), status?.settingsError ? h('p', { role: 'alert' }, 'Qoder 配置无法加载，模型调用与独立委派已停用。请修复插件 settings.json 或管理员配置后重启 DSH；原文件未修改，无法保存覆盖。') : null, error ? h('p', { role: 'alert' }, error, !status ? h('button', { type: 'button', disabled: locked, onClick: () => void load('initial') }, '重试加载') : null) : null, draft ? h('div', null, h('div', { style: { marginBottom: '14px' } }, h('select', { 'aria-label': 'CLI区域', disabled: locked, value: draft.cliVariant, onChange: valueChange('cliVariant') }, h('option', { value: 'qodercli' }, '国际版'), h('option', { value: 'qoderclicn' }, '中国版'))), h('fieldset', { disabled: locked, style: box }, h('legend', null, h('span', { style: row }, '模型与独立委派设置', h('span', { style: { position: 'relative', display: 'inline-flex' }, onMouseEnter: () => { setHover(true); setDismissed(false); }, onMouseLeave: () => setHover(false) }, h('button', { type: 'button', 'aria-label': '模型与独立委派安全说明', 'aria-describedby': tooltip ? helpId.current : undefined,
        onFocus: () => { setFocus(true); setDismissed(false); }, onBlur: () => setFocus(false), onClick: () => { setFocus(true); setDismissed(false); }, onKeyDown: (event) => { if (event.key === 'Escape')
            setDismissed(true); },
        style: { fontSize: '12px', minHeight: '24px', minWidth: '24px', padding: '1px 6px', color: secondary } }, '?'), tooltip ? h('span', { id: helpId.current, role: 'tooltip', style: { position: 'absolute', zIndex: 10, top: '100%', left: '-160px', width: 'min(320px, 70vw)', boxSizing: 'border-box', padding: '10px 12px', border, borderRadius: '6px', background: 'var(--dsw-alias-bg-base, var(--gray-2))', color: foreground, fontSize: '12px', fontWeight: 400, lineHeight: 1.6 } }, safety) : null))), h('div', { style: { ...row, justifyContent: 'space-between', marginBottom: '10px' } }, h('h3', null, '启用模型'), h('button', { type: 'button', disabled: locked || changedCli || !!status?.settingsError, onClick: () => void load('models') }, '获取模型列表')), changedCli ? h('p', { role: 'status' }, 'CLI 区域或路径尚未保存。请先保存设置，再获取该区域的模型；旧区域模型已隐藏。') : h('p', { style: { fontSize: '12px' }, role: 'status' }, status?.modelMessage), h('div', { role: 'group', 'aria-label': '启用模型', style: { ...row, gap: '6px', marginBottom: '14px' } }, ...[...models].map(([id, label]) => h('button', { key: id, type: 'button', 'aria-label': `${label} (${id})`, 'aria-pressed': enabled.includes(id), style: { borderRadius: '16px', overflowWrap: 'anywhere', ...(enabled.includes(id) ? selectedStyle : {}) },
        onClick: () => { if (dirtyCli() || pending.current)
            return; const current = draftRef.current; const on = current.models.includes(id) && !current.hiddenModels.includes(id); update({ models: on ? current.models : [...new Set([...current.models, id])], hiddenModels: on ? [...new Set([...current.hiddenModels, id])] : current.hiddenModels.filter(item => item !== id), defaultModel: on && current.defaultModel === id ? enabled.find(item => item !== id) ?? '' : current.defaultModel }); } }, label))), h('div', { style: grid }, select('defaultModel', '默认模型', enabled, models), select('permissionMode', '权限模式', modes, new Map([['dont_ask', '不询问'], ['default', '默认'], ['accept_edits', '接受编辑']])), select('reasoningEffort', '默认推理强度', efforts)), h('div', { style: { ...row, justifyContent: 'flex-end' } }, h('button', { type: 'button', disabled: locked || !!status?.settingsError || !!validation, onClick: () => void load('config') }, '保存设置')), validation ? h('p', { role: 'alert' }, validation) : null), h('details', { style: box }, h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '高级设置'), h('fieldset', { disabled: locked, style: { border: 0, padding: '12px 0 0', margin: 0, minWidth: 0 } }, h('div', { style: grid }, textField('qodercliBin', '国际版 CLI 路径'), textField('qoderclicnBin', '中国版 CLI 路径'))))) : null, h('details', { style: box, 'aria-label': '运行记录' }, h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, `运行记录（${status?.runs.length ?? 0}）`), h('p', { style: { fontSize: '12px' } }, '当前进程内最近 5 条，每 2 秒刷新。不展示提示词、原始输出或错误详情。'), h('div', { style: { maxHeight: '360px', overflowY: 'auto' } }, ...(status?.runs.length ? status.runs.map(run => h('article', { key: run.id, style: { borderTop: border, padding: '8px 0', overflowWrap: 'anywhere' } }, h('p', null, `${{ queued: '排队中', starting: '启动中', waiting: '等待响应', responding: '响应中', completed: '已完成', failed: '失败', cancelled: '已取消' }[run.state]}；模型：${run.requestedModel}；推理强度请求：${run.requestedEffort}（未确认）`), run.lastProgressAt !== undefined ? h('p', null, `最近进展：${new Date(run.lastProgressAt).toLocaleTimeString()}`) : null, run.failure ? h('p', null, { timeout: '无进展超时', 'queue-timeout': '排队超时', aborted: '已中止', error: '执行失败' }[run.failure]) : null, run.warning ? h('p', { role: 'status' }, '长时间无进展，仍在等待；这不代表失败。') : null)) : [h('p', { key: 'empty' }, '暂无运行记录')]))));
}
function apply(ctx) {
    ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'qoder-link', order: 20, label: 'Qoder Link' }, SettingsPanel));
    const panel = (props) => record(props) && props.view === 'summary' ? null : h(SettingsPanel);
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-qoder-link' }, panel));
    ctx.slots.inject('plugins.row.config', () => ctx.slots.register({ name: 'plugins.row.config', key: 'dsh-qoder-link#qoder-link' }, panel));
}

return module.exports;
} });
