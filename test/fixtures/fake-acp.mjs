import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const reply = (id, result) => send({ id, result });
const update = row => send({ method: 'session/update', params: { sessionId: 'test-session', update: row } });
let mode = '';
for await (const line of createInterface({ input: process.stdin })) {
  const row = JSON.parse(line);
  if (row.method === 'initialize') {
    if (row.params.clientCapabilities.terminal !== false || row.params.clientCapabilities.fs.writeTextFile !== false) process.exit(2);
    reply(row.id, { protocolVersion: 1, agentCapabilities: {} });
  } else if (row.method === 'session/new') {
    if (row.params.mcpServers.length) process.exit(3);
    update({ sessionUpdate: 'available_commands_update', availableCommands: [] });
    reply(row.id, { sessionId: 'test-session' });
  } else if (row.method === 'session/set_model') reply(row.id, {});
  else if (row.method === 'session/cancel') {
    writeFileSync('cancelled', 'yes');
    if (mode.startsWith('exit-tree:')) process.exit(0);
  } else if (row.method === 'session/prompt') {
    mode = row.params.prompt[0].text;
    if (mode.includes('tree:')) {
      const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
      writeFileSync(mode.slice(mode.indexOf(':') + 1), String(child.pid));
      if (mode.startsWith('yield-tree:')) update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ready' } });
    } else if (mode === 'hang') { /* remain alive */ }
    else if (mode === 'noise') setInterval(() => { process.stderr.write('SECRET_TOKEN'); send({ method: 'heartbeat' }); }, 30);
    else if (mode === 'error') { process.stderr.write('SECRET_TOKEN'.repeat(100)); process.exit(7); }
    else if (mode === 'protocol-error') send({ id: row.id, error: { code: -32603, message: 'SECRET_TOKEN' } });
    else if (mode === 'auth-error') send({ id: row.id, error: { code: -32000, message: 'SECRET_TOKEN' } });
    else if (mode === 'malformed') process.stdout.write('{SECRET_TOKEN\n');
    else if (mode === 'wrong-session') send({ method: 'session/update', params: { sessionId: 'other', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'no' } } } });
    else if (mode === 'oversized') process.stdout.write('x'.repeat(9 * 1024 * 1024));
    else if (mode === 'unexpected-id') reply(999, {});
    else if (mode === 'refusal') reply(row.id, { stopReason: 'refusal' });
    else if (mode === 'model') { update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'model-ok' } }); reply(row.id, { stopReason: 'end_turn' }); }
    else if (mode === 'missing') process.exit(0);
    else if (mode === 'permission') send({ id: 'server-1', method: 'session/request_permission', params: { sessionId: 'test-session', toolCall: {}, options: [{ optionId: 'yes', kind: 'allow_always' }] } });
    else if (mode === 'client-requests') send({ id: 'server-1', method: 'fs/read_text_file', params: { path: 'SECRET_TOKEN' } });
    else if (mode === 'tool') {
      update({ sessionUpdate: 'tool_call', toolCallId: 't', title: 'Read', status: 'in_progress', rawInput: {} });
      update({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed', rawOutput: 'ok' });
      reply(row.id, { stopReason: 'end_turn' });
    } else if (mode === 'slow') {
      for (let n = 0; n < 8; n++) { await new Promise(r => setTimeout(r, 80)); update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'x' } }); }
      reply(row.id, { stopReason: 'end_turn' });
    } else {
      const text = mode === 'argv' ? JSON.stringify(process.argv.slice(2)) : mode === 'env' ? String(process.env.QODER_PERSONAL_ACCESS_TOKEN === 'test-pat') : mode;
      update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } });
      const bytes = Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'test-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } }) + '\n');
      for (const byte of bytes) process.stdout.write(Buffer.from([byte]));
      reply(row.id, { stopReason: 'end_turn' });
    }
  } else if (row.id === 'server-1') {
    writeFileSync('client-response.json', JSON.stringify(row));
    if (mode === 'client-requests') reply(3, { stopReason: 'end_turn' });
  }
}
