// Explicit opt-in integration probe. Uses real CLI credits, never business tools.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { QoderAdapter } from '../dist/adapter.js'
import { SettingsStore } from '../dist/settings.js'
import { runQoder } from '../dist/runner.js'

const ctx = new Context(), controller = new AbortController()
const timer = setTimeout(()=>controller.abort(),120000)
let promptFiber, toolsFiber, probeFiber, runtime, executions=0, secret, spawns=0
const challenge=randomUUID()
try {
  promptFiber=ctx.plugin(SystemPrompt,{includeHarnessIdentity:false,includeRuntimeContext:false}); await promptFiber
  toolsFiber=ctx.plugin(ToolRuntime,{mode:'native'}); await toolsFiber
  probeFiber=ctx.plugin({inject:['tools'],apply(c){
    runtime=c.tools
    c.tools.register(defineTool({name:'readonly_probe',description:'Read-only integration probe. Call once with the exact supplied challenge.',parameters:{challenge:{type:'string',required:true}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},async execute(args){assert.equal(args.challenge,challenge);assert.equal(++executions,1);secret=randomUUID();return 'PROBE_OK:'+secret}}))
    c.tools.guard(exec=>exec.name==='readonly_probe'?undefined:'Integration probe only')
  }}); await probeFiber
  const cfg=new SettingsStore().config
  const runner=async function*(request){spawns++;yield* runQoder(request)}
  const adapter=new QoderAdapter(cfg,runner)
  const messages=[{id:randomUUID(),role:'user',source:{kind:'user'},content:[{type:'text',text:`Call readonly_probe exactly once with challenge ${challenge}. After receiving its tool result, reply only with the PROBE_OK value from that result. Do not invent the result.`}]}]
  const invoke=async()=>{
    const chunks=[]
    for await(const chunk of adapter.stream({provider:'qoder',model:cfg.defaultModel,messages,tools:runtime.schemas(),signal:controller.signal}))chunks.push(chunk)
    const finish=chunks.at(-1)
    assert.equal(finish?.type,'finish')
    assert.notEqual(finish.reason.kind,'error',finish.reason.failure?.message)
    return {chunks,finish,calls:chunks.filter(c=>c.type==='block-end'&&c.block.type==='tool-call').map(c=>c.block)}
  }
  const first=await invoke()
  assert.equal(first.finish.reason.kind,'tool-calls');assert.equal(first.calls.length,1)
  const call=first.calls[0];assert.equal(call.name,'readonly_probe')
  const result=await runtime.execute({callId:call.id,name:call.name,arguments:JSON.parse(call.arguments),signal:controller.signal})
  assert.equal(result.isError,false,JSON.stringify(result.content))
  messages.push({id:randomUUID(),role:'assistant',source:{kind:'model',provider:'qoder',model:cfg.defaultModel},content:[call]}, {id:randomUUID(),role:'user',source:{kind:'tool',callId:call.id},content:[{type:'tool-result',toolCallId:call.id,content:result.content,isError:result.isError}]})
  const second=await invoke()
  assert.equal(second.calls.length,0);assert.equal(second.finish.reason.kind,'stop');assert.equal(executions,1)
  const text=second.chunks.filter(c=>c.type==='text-delta').map(c=>c.text).join('')
  assert.ok(text.includes(secret),'Second ACP turn must read the execution-generated secret from the actual tool result')
  console.log(JSON.stringify({region:cfg.cliVariant,transport:'ACP stdio',toolRuntime:'DSH ToolRuntime',logicalTurns:2,cliRequests:spawns,executions,toolResultObserved:true,status:'passed'}))
} finally {
  clearTimeout(timer);controller.abort()
  await probeFiber?.dispose();await toolsFiber?.dispose();await promptFiber?.dispose()
}
