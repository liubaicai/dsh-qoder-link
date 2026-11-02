import test from 'node:test'
import assert from 'node:assert/strict'
import { QoderAdapter, type Runner } from '../src/adapter.ts'
import { resolveConfig } from '../src/config.ts'
import { parseResponse, ToolResponseFormatError } from '../src/response.ts'
import type { StreamChunk, GenerateOptions } from '@deepseek-ai/dsh-llm'

const tools = [{name:'read',description:'read file',parameters:{}}]
const call = {name:'read',arguments:{file_path:'C:/example/package.json'}}
const canonical = JSON.stringify({text:'checking',toolCalls:[call]})
const leaked = '我先确认仓库信息，再准备条目文件。\n\n<tool_call>\n' + canonical
const options = {provider:'qoder',model:'default',messages:[{id:'task',role:'user' as const,source:{kind:'user'},content:[{type:'text' as const,text:'TASK_SENTINEL: inspect the requested file'}]}],tools} as GenerateOptions
const collect = async (runner: Runner) => {
  const chunks: StreamChunk[] = []
  for await (const chunk of new QoderAdapter(resolveConfig({},{}),runner).stream(options)) chunks.push(chunk)
  return chunks
}

test('prose and standalone tool marker cannot silently succeed as plain text', () => {
  assert.throws(()=>parseResponse(leaked,tools),ToolResponseFormatError)
  // An inline mention does not become an executable fragment.
  assert.equal(parseResponse('The token <tool_call> is a marker.',tools).toolCalls.length,0)
})

test('one strict format retry emits only validated calls and preserves the original task', async () => {
  let calls=0
  const out=await collect(async function* (request) {
    calls++
    assert.ok(request.prompt.includes('TASK_SENTINEL'))
    assert.ok(request.prompt.includes('"name":"read"'))
    assert.equal(request.tools,'')
    assert.equal(request.permissionMode,'dont_ask')
    assert.ok(request.systemPrompt?.includes('ONLY one JSON object'))
    if(calls===2) assert.ok(request.prompt.includes('No tools from that response were executed'))
    const text=calls===1?leaked:canonical
    for(let i=0;i<text.length;i+=7) yield {type:'text',delta:text.slice(i,i+7)}
    yield {type:'usage',input:5,output:2,cacheRead:0,cacheWrite:0}
    yield {type:'usage',input:10,output:5,cacheRead:0,cacheWrite:0}
    yield {type:'result',text}
  })
  assert.equal(calls,2)
  assert.deepEqual(out.filter(c=>c.type==='text-delta').map(c=>c.text),['checking'])
  assert.deepEqual(out.filter(c=>c.type==='tool-call-delta').map(c=>({name:c.name,args:JSON.parse(c.argumentsDelta)})),[{name:'read',args:call.arguments}])
  assert.equal(out.some(c=>c.type==='text-delta'&&c.text.includes('<tool_call>')),false)
  assert.ok(out.some(c=>c.type==='usage'&&c.usage.inputTokens===20))
  const finish=out.at(-1)
  assert.equal(finish?.type==='finish'&&finish.reason.kind,'tool-calls')
})

test('tool markup hidden in a canonical text field also triggers one repair', async () => {
  let calls=0
  const out=await collect(async function*(){calls++;yield {type:'result',text:calls===1?JSON.stringify({text:leaked,toolCalls:[]}):canonical}})
  assert.equal(calls,2)
  assert.equal(out.filter(c=>c.type==='tool-call-delta').length,1)
  assert.equal(out.some(c=>c.type==='text-delta'&&c.text.includes('<tool_call>')),false)
})

test('format retry is bounded and never executes examples, invalid or mixed responses', async () => {
  for(const retry of [leaked,'<tool_call>'+canonical,canonical+' trailing',JSON.stringify({text:'',toolCalls:[{name:'missing',arguments:{}}]}),JSON.stringify({text:leaked,toolCalls:[]})]) {
    let calls=0
    const out=await collect(async function*(){calls++;yield {type:'result',text:calls===1?'Example:\n\n<tool_call>\n'+canonical:retry}})
    assert.equal(calls,2)
    assert.equal(out.filter(c=>c.type==='tool-call-delta'||c.type==='text-delta').length,0)
    const finish=out.at(-1)
    assert.equal(finish?.type==='finish'&&finish.reason.kind,'error')
  }
})
