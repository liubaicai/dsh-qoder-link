import '@deepseek-ai/dsh-commands';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { QoderAdapter } from "./adapter.js";
import { QODER_EFFORTS, resolveConfig, selectedBin } from "./config.js";
import { resolveEffort } from "./effort.js";
import { CallRuntime } from "./runtime.js";
import { runQoder } from "./runner.js";
import { SettingsStore } from "./settings.js";
import { registerSettingsRoutes } from "./web.js";
import { discoverModels } from "./models.js";
export const name = 'dsh-qoder-link';
export const inject = ['llm', 'commands'];
export function apply(ctx, entry = {}) {
    const store = new SettingsStore(entry);
    const config = store.config;
    const runtime = new CallRuntime(config);
    ctx.inject(['webServer'], sub => {
        const server = sub.get('webServer');
        if (!server)
            return;
        return registerSettingsRoutes(server, store, () => { runtime.refresh(); ctx.emit('llm/adapters-updated'); }, () => runtime.snapshots(), snapshot => discoverModels(snapshot));
    });
    const sessionCwd = (id) => {
        const sessions = ctx.get('sessions');
        return sessions?.get(id)?.header?.cwd;
    };
    // Register even when disabled, allowing settings to enable the bridge without restart.
    ctx.llm.registerAdapter(['qoder'], new QoderAdapter(config, runQoder, sessionCwd, runtime));
    ctx.commands.register({
        name: 'qoder', description: 'Qoder Link status, models and setup', input: { hint: '<status|models|runs|help>' },
        handler: ({ rawInput }) => {
            const command = rawInput.trim() || 'help';
            if (command === 'runs')
                return { kind: 'success', text: JSON.stringify(runtime.snapshots(), null, 2) };
            if (command === 'models')
                return { kind: 'success', text: config.models.filter(id => !config.hiddenModels.includes(id)).map(id => `- qoder/${id}`).join('\n') };
            if (command === 'status')
                return { kind: 'success', text: [
                        '**Qoder Link**', ...(store.loadError ? [store.loadError] : []), `Enabled: ${config.enabled}`, `CLI variant: ${config.cliVariant}`, `Executable: ${selectedBin(config)}`,
                        `Default model: ${config.defaultModel}; effort: ${config.reasoningEffort}`, `Transport: ACP stdio; concurrency: ${config.maxConcurrency}; inactivity timeout: ${config.timeoutMs}ms`,
                        'Provider tools: DSH-managed; CLI built-in tools and MCP disabled.',
                        `Delegation tools: ${config.tools || 'disabled'} (${config.permissionMode})`,
                        'Authentication: existing login of the selected official CLI. The plugin does not manage accounts or credentials.',
                    ].join('\n') };
            if (command !== 'help')
                return { kind: 'error', text: 'Unknown subcommand. Use /qoder help.' };
            return { kind: 'success', text: '/qoder status — configuration\n/qoder models — enabled models\n/qoder runs — recent calls\nSelect qoder/default in DSH. Choose qodercli or qoderclicn in Qoder Link settings, install and log in to that CLI first.' };
        },
    });
    ctx.inject(['tools'], sub => {
        const tool = defineTool({
            name: 'qoder_ask',
            description: 'Ask the selected Qoder CLI a standalone question without changing the DSH model. No DSH history is sent. CLI built-in tools are disabled unless configured by the administrator; enabled tools operate outside the DSH sandbox.',
            parameters: {
                prompt: { type: 'string', required: true, description: 'Self-contained question or task.' },
                model: { type: 'string', description: 'Enabled Qoder model ID, or default.' },
                reasoningEffort: { type: 'string', description: `Thinking effort: ${QODER_EFFORTS.join(', ')}. Omit to inherit settings.` },
            },
            output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
            async execute(args, exec) {
                if (!config.enabled || !config.askTool)
                    throw new Error('Qoder delegation is disabled');
                const agent = exec.agent;
                const cwd = config.workspaceRoot || agent?.session?.header?.cwd;
                if (config.tools && !cwd)
                    throw new Error('Set workspaceRoot before enabling Qoder delegation tools');
                if (!args.prompt.trim())
                    throw new Error('prompt must not be empty');
                if (args.prompt.length > config.maxPromptChars)
                    throw new Error('prompt exceeds maxPromptChars');
                const model = args.model || config.defaultModel;
                if (!config.models.includes(model) || config.hiddenModels.includes(model))
                    throw new Error('Qoder model is not enabled in settings');
                let text = '';
                let result = '';
                for await (const event of runtime.run({ prompt: args.prompt, cwd: cwd || process.cwd(), bin: selectedBin(config), cliVariant: config.cliVariant,
                    model: model === 'default' ? undefined : model, effort: resolveEffort(args.reasoningEffort, config.reasoningEffort),
                    tools: config.tools, permissionMode: config.permissionMode, timeoutMs: config.timeoutMs, signal: exec.signal }, 'ask')) {
                    if (event.type === 'text')
                        text += event.delta;
                    if (event.type === 'result')
                        result = event.text;
                }
                return result || text;
            },
        });
        // The ACP runner enforces inactivity, not wall-clock duration. Avoid the
        // host's former ten-minute total deadline terminating a progressing task.
        Object.defineProperty(tool, 'timeoutMs', { enumerable: true, value: 2147483647 });
        sub.tools.register(tool);
    });
}
export { QoderAdapter, resolveConfig };
//# sourceMappingURL=index.js.map