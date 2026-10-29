import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore } from '../src/settings.ts'
import { registerSettingsRoutes, type RefreshModels } from '../src/web.ts'

type Handler = (req: IncomingMessage, res: ServerResponse) => void
async function fixture(run: (ctx: {base: string; store: SettingsStore; notifications: () => number; routes: Map<string, Handler>; dispose: () => void}) => Promise<void>, runs: unknown[] = [], refreshModels?: RefreshModels) {
  const directory = mkdtempSync(join(tmpdir(), 'qoder-web-'))
  const routes = new Map<string, Handler>()
  const store = new SettingsStore({}, join(directory, 'settings.json'))
  let count = 0
  const dispose = registerSettingsRoutes({register(route) {routes.set(route.path, route.handler); return () => routes.delete(route.path)}}, store, () => {count++}, () => runs, refreshModels)
  const server = createServer((req, res) => { const handler = routes.get(req.url || ''); if (handler) handler(req, res); else {res.writeHead(404); res.end()} })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  try { await run({base: `http://127.0.0.1:${address.port}`, store, notifications: () => count, routes, dispose}) }
  finally { dispose(); await new Promise<void>((resolve, reject) => {server.close(error => error ? reject(error) : resolve()); server.closeAllConnections()}); rmSync(directory, {recursive: true, force: true}) }
}
const post = (body: unknown, headers = {}) => ({method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)})

test('only status/config/models routes, safe headers, separate paths and shared models', async () => {
  await fixture(async ({base, store, notifications, routes, dispose}) => {
    assert.deepEqual([...routes.keys()], ['/plugins/qoder-link/status', '/plugins/qoder-link/config', '/plugins/qoder-link/models'])
    const first = await fetch(base + '/plugins/qoder-link/status')
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('cache-control'), 'no-store')
    assert.equal(first.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(Object.keys(await first.json()).sort(), ['catalogModels', 'config', 'modelMessage', 'runs'])
    const saved = await fetch(base + '/plugins/qoder-link/config', post({cliVariant: 'qoderclicn', qodercliBin: 'C:\\Global\\qodercli.exe', qoderclicnBin: 'C:\\China\\qoderclicn.exe', models: ['default', 'model-a'], defaultModel: 'model-a', reasoningEffort: 'high'}))
    assert.equal(saved.status, 200)
    assert.equal((await saved.json()).config.cliVariant, 'qoderclicn')
    assert.equal(notifications(), 1)
    assert.equal(store.config.qodercliBin, 'C:\\Global\\qodercli.exe')
    await fetch(base + '/plugins/qoder-link/config', post({cliVariant: 'qodercli'}))
    assert.equal(store.config.qoderclicnBin, 'C:\\China\\qoderclicn.exe')
    assert.equal(store.config.defaultModel, 'model-a')
    dispose(); dispose(); assert.equal(routes.size, 0)
  })
})
test('rejects wrong methods, origins, content types and invalid or oversized JSON', async () => {
  await fixture(async ({base, notifications}) => {
    const url = base + '/plugins/qoder-link/config'
    assert.equal((await fetch(url)).status, 405)
    assert.equal((await fetch(base + '/plugins/qoder-link/status', post({}))).status, 405)
    for (const headers of [{Origin: 'https://evil.example'}, {Origin: 'null'}, {'Sec-Fetch-Site': 'cross-site'}, {Origin: base + '/not-an-origin'}]) {
      assert.equal((await fetch(url, post({}, headers))).status, 403)
    }
    assert.equal((await fetch(url, {method: 'POST', body: '{}'})).status, 415)
    assert.equal((await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{broken'})).status, 400)
    for (const body of [null, [], {token: 'SECRET'}, {cliVariant: 'wrong'}, {maxConcurrency: 0}, {reasoningEffort: 'max'}, {tools: 'x'.repeat(33000)}]) {
      const response = await fetch(url, post(body)); assert.equal(response.status, 400)
      assert.ok(!(await response.text()).includes('SECRET'))
    }
    assert.equal(notifications(), 0)
    assert.equal((await fetch(url, post({}, {Origin: base}))).status, 200)
  })
})
test('metadata snapshots redact run internals and retain newest five', async () => {
  const runs = Array.from({length: 8}, (_, index) => ({id: `run-${index}`, source: 'model', state: 'completed', requestedModel: 'default', requestedEffort: 'high', queuedAt: index, prompt: 'SECRET', rawOutput: 'SECRET', error: 'SECRET', accessToken: 'SECRET', totalCredits: 25, contextWindow: 128000}))
  await fixture(async ({base, store}) => {
    Object.assign(store.config, {accessToken: 'SECRET'})
    const response = await fetch(base + '/plugins/qoder-link/status')
    const text = await response.text(); assert.ok(!text.includes('SECRET')); assert.ok(!text.includes('totalCredits'))
    const body = JSON.parse(text)
    assert.deepEqual(body.runs.map((run: {id: string}) => run.id), ['run-7', 'run-6', 'run-5', 'run-4', 'run-3'])
    assert.equal(body.runs[0].contextOverrideSent, false)
    assert.equal(body.runs[0].reasoningConfirmed, false)
  }, [...runs, {id: 'bad', source: 'model', state: 'secret-state', queuedAt: 999}])
})

test('public runs retain stable top five ties from large unsorted inputs without sorting', async () => {
  const runs=Array.from({length:1000},(_,i)=>({id:`run-${i}`,source:'model',state:'completed',queuedAt:i%7}))
  await fixture(async ({base})=>{
    const body=await (await fetch(base+'/plugins/qoder-link/status')).json()
    assert.deepEqual(body.runs.map((run:{id:string})=>run.id),['run-6','run-13','run-20','run-27','run-34'])
  },runs)
  const source=readFileSync(new URL('../src/web.ts',import.meta.url),'utf8')
  assert.doesNotMatch(source.slice(source.indexOf('function publicRuns')), /\.sort\(/)
})

test('recovery status is safe, writes remain blocked, obsolete account files are ignored', async () => {
  const dir=mkdtempSync(join(tmpdir(),'qoder-recovery-web-')),routes=new Map<string,Handler>()
  const path=join(dir,'settings.json'), accountPath=join(dir,'accounts.json')
  writeFileSync(path,'{"SECRET": invalid')
  const settings=new SettingsStore({},path)
  let notifications=0, discoveries=0
  const dispose=registerSettingsRoutes({register(route){routes.set(route.path,route.handler)}},settings,()=>{notifications++},()=>[],async()=>{discoveries++;return {models:[],message:'SECRET'}})
  const server=createServer((req,res)=>routes.get(req.url!)!(req,res))
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address && typeof address==='object')
  const base=`http://127.0.0.1:${address.port}/plugins/qoder-link`
  try {
    const response=await fetch(base+'/status');assert.equal(response.status,200)
    const body=await response.json();assert.equal(body.settingsError,settings.loadError)
    assert.equal(body.config.enabled,false);assert.equal(body.config.askTool,false)
    assert.doesNotMatch(JSON.stringify(body),/SECRET/)
    assert.equal((await fetch(base+'/config',post({enabled:true,askTool:true}))).status,400)
    assert.equal(notifications,0);assert.equal(readFileSync(path,'utf8'),'{"SECRET": invalid')
    assert.equal((await fetch(base+'/models',post({}))).status,503)
    assert.equal(discoveries,0)
    writeFileSync(accountPath,'SECRET invalid account JSON')
    const broken=await fetch(base+'/status');assert.equal(broken.status,200)
    assert.doesNotMatch(await broken.text(),/SECRET|accounts/)
    assert.equal(readFileSync(accountPath,'utf8'),'SECRET invalid account JSON')
  } finally {dispose();await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections()});rmSync(dir,{recursive:true,force:true})}
})

test('explicit model refresh is passive on GET, sanitized, JSON-only and never changes settings',async()=>{
  let calls=0
  await fixture(async({base,store})=>{
    const root=base+'/plugins/qoder-link'
    for(let i=0;i<2;i++) assert.equal((await fetch(root+'/status')).status,200)
    assert.equal(calls,0)
    assert.equal((await fetch(root+'/models')).status,405)
    assert.equal((await fetch(root+'/models',post({},{Origin:'https://evil.test'}))).status,403)
    assert.equal((await fetch(root+'/models',{method:'POST',body:'{}'})).status,415)
    assert.equal((await fetch(root+'/models',post({token:'SECRET'}))).status,400)
    const response=await fetch(root+'/models',post({}));assert.equal(response.status,200)
    const body=await response.json()
    assert.deepEqual(body.catalogModels,[{id:'model-a',name:'Model A'}]);assert.equal(body.modelMessage,'已获取当前 CLI 模型列表。')
    assert.doesNotMatch(JSON.stringify(body),/SECRET/)
    assert.deepEqual(store.config.models,['default']);assert.equal(store.config.cliVariant,'qodercli');assert.equal(calls,1)
    await fetch(root+'/config',post({qodercliBin:'new-cli'}))
    const next=await (await fetch(root+'/status')).json();assert.deepEqual(next.catalogModels,[]);assert.equal(next.modelMessage,'模型列表尚未加载。')
  },[],async config=>{calls++;config.models.push('do-not-save');return {models:[{id:'model-a',name:'Model A',token:'SECRET'},{id:'../bad',name:'SECRET'}],message:'SECRET arbitrary CLI diagnostic'}})
})

test('model refresh rejects stale region/path results including change-back and dispose',async()=>{
  for(const change of [{cliVariant:'qoderclicn'}, {qodercliBin:'another-cli'}]) {
    let finish!:(value:{models:{id:string;name:string}[];message:string})=>void,started!:()=>void
    const ready=new Promise<void>(resolve=>{started=resolve})
    await fixture(async({base})=>{
      const root=base+'/plugins/qoder-link',pending=fetch(root+'/models',post({}));await ready
      await fetch(root+'/config',post(change));await fetch(root+'/config',post({cliVariant:'qodercli',qodercliBin:'qodercli'}))
      finish({models:[{id:'stale',name:'Stale'}],message:'Stale'})
      assert.equal((await pending).status,409)
      assert.deepEqual((await (await fetch(root+'/status')).json()).catalogModels,[])
    },[],()=>{started();return new Promise(resolve=>{finish=resolve})})
  }
  let finish!:(value:{models:{id:string;name:string}[];message:string})=>void,started!:()=>void
  const ready=new Promise<void>(resolve=>{started=resolve})
  await fixture(async({base,dispose})=>{
    const pending=fetch(base+'/plugins/qoder-link/models',post({}));await ready;dispose();finish({models:[],message:'late'})
    assert.equal((await pending).status,503)
  },[],()=>{started();return new Promise(resolve=>{finish=resolve})})
})

test('model discovery has one process slot across same and changed configuration epochs',async()=>{
  let calls=0,started!:()=>void,finish!:(value:{models:{id:string;name:string}[];message:string})=>void
  const ready=new Promise<void>(resolve=>{started=resolve})
  await fixture(async({base})=>{
    const root=base+'/plugins/qoder-link',first=fetch(root+'/models',post({}));await ready
    const same=await Promise.all(Array.from({length:8},()=>fetch(root+'/models',post({}))))
    assert.ok(same.every(response=>response.status===409));assert.equal(calls,1)
    await fetch(root+'/config',post({cliVariant:'qoderclicn'}))
    assert.equal((await fetch(root+'/models',post({}))).status,409);assert.equal(calls,1)
    finish({models:[],message:'SECRET'});assert.equal((await first).status,409)
    const next=await fetch(root+'/models',post({}));assert.equal(next.status,200);assert.equal(calls,2)
  },[],()=>{calls++;if(calls>1)return Promise.resolve({models:[],message:'SECRET'});started();return new Promise(resolve=>{finish=resolve})})
})

test('model discovery exceptions do not expose credentials or paths',async()=>{
  await fixture(async({base})=>{
    const response=await fetch(base+'/plugins/qoder-link/models',post({}));assert.equal(response.status,400)
    assert.doesNotMatch(await response.text(),/SECRET/)
  },[],async()=>{throw new Error('SECRET PAT C:/private')})
})

test('all existing advanced panel fields remain editable', async () => {
  await fixture(async ({base,store})=>{
    const patch={...store.config,enabled:false,askTool:false,cliVariant:'qoderclicn',qodercliBin:'global-cli',qoderclicnBin:'china-cli',workspaceRoot:tmpdir(),timeoutMs:1234,contextWindow:9000,maxPromptChars:5000,maxConcurrency:3,queueTimeoutMs:2345,stallWarnMs:0,tools:'Read',permissionMode:'accept_edits',reasoningEffort:'high',modelContext:{default:8000}}
    assert.equal((await fetch(base+'/plugins/qoder-link/config',post(patch))).status,200)
    assert.deepEqual(store.config,patch)
  })
})
