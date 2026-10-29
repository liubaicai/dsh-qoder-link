import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore } from '../src/settings.ts'
import { registerSettingsRoutes } from '../src/web.ts'
import { AccountStore } from '../src/accounts.ts'
import { AccountService } from '../src/account-service.ts'

type Handler = (req: IncomingMessage, res: ServerResponse) => void
async function fixture(run: (ctx: {base: string; store: SettingsStore; notifications: () => number; routes: Map<string, Handler>; dispose: () => void}) => Promise<void>, runs: unknown[] = []) {
  const directory = mkdtempSync(join(tmpdir(), 'qoder-web-'))
  const routes = new Map<string, Handler>()
  const store = new SettingsStore({}, join(directory, 'settings.json'))
  let count = 0
  const dispose = registerSettingsRoutes({register(route) {routes.set(route.path, route.handler); return () => routes.delete(route.path)}}, store, () => {count++}, () => runs)
  const server = createServer((req, res) => { const handler = routes.get(req.url || ''); if (handler) handler(req, res); else {res.writeHead(404); res.end()} })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  try { await run({base: `http://127.0.0.1:${address.port}`, store, notifications: () => count, routes, dispose}) }
  finally { dispose(); await new Promise<void>((resolve, reject) => {server.close(error => error ? reject(error) : resolve()); server.closeAllConnections()}); rmSync(directory, {recursive: true, force: true}) }
}
const post = (body: unknown, headers = {}) => ({method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)})

test('only status/config routes, safe headers, separate paths and shared models', async () => {
  await fixture(async ({base, store, notifications, routes, dispose}) => {
    assert.deepEqual([...routes.keys()], ['/plugins/qoder-link/status', '/plugins/qoder-link/config'])
    const first = await fetch(base + '/plugins/qoder-link/status')
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('cache-control'), 'no-store')
    assert.equal(first.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(Object.keys(await first.json()).sort(), ['config', 'runs'])
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

test('recovery status is safe, writes remain blocked, account errors use only fixed diagnostics', async () => {
  const dir=mkdtempSync(join(tmpdir(),'qoder-recovery-web-')),routes=new Map<string,Handler>()
  const path=join(dir,'settings.json'), accountPath=join(dir,'accounts.json')
  writeFileSync(path,'{"SECRET": invalid')
  const settings=new SettingsStore({},path)
  const accounts=new AccountService(new AccountStore(accountPath),settings.config)
  let notifications=0
  const dispose=registerSettingsRoutes({register(route){routes.set(route.path,route.handler)}},settings,()=>{notifications++},()=>[],accounts)
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
    writeFileSync(accountPath,'SECRET invalid account JSON')
    const broken=await fetch(base+'/status');assert.equal(broken.status,500)
    assert.deepEqual(await broken.json(),{error:'Cannot access Qoder account store; repair the store before continuing'})
    accounts.snapshot=()=>{throw new Error('SECRET raw filesystem error C:\\private')}
    assert.deepEqual(await (await fetch(base+'/status')).json(),{error:'状态读取失败，请重试。'})
    assert.equal(readFileSync(accountPath,'utf8'),'SECRET invalid account JSON')
  } finally {dispose();await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections()});rmSync(dir,{recursive:true,force:true})}
})

test('all existing advanced panel fields remain editable', async () => {
  await fixture(async ({base,store})=>{
    const patch={...store.config,enabled:false,askTool:false,cliVariant:'qoderclicn',qodercliBin:'global-cli',qoderclicnBin:'china-cli',workspaceRoot:tmpdir(),timeoutMs:1234,contextWindow:9000,maxPromptChars:5000,maxConcurrency:3,queueTimeoutMs:2345,stallWarnMs:0,tools:'Read',permissionMode:'accept_edits',reasoningEffort:'high',modelContext:{default:8000}}
    assert.equal((await fetch(base+'/plugins/qoder-link/config',post(patch))).status,200)
    assert.deepEqual(store.config,patch)
  })
})

test('account routes enforce origin and JSON, reject cross-region writes, never disclose PAT',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'qoder-account-web-')),routes=new Map<string,Handler>()
  const settings=new SettingsStore({},join(dir,'settings.json')),accounts=new AccountService(new AccountStore(join(dir,'accounts.json')),settings.config)
  const dispose=registerSettingsRoutes({register(route){routes.set(route.path,route.handler)}},settings,()=>{},()=>[],accounts)
  const server=createServer((req,res)=>{const handler=routes.get(req.url||'');if(handler)handler(req,res);else{res.writeHead(404);res.end()}})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address && typeof address==='object')
  const base=`http://127.0.0.1:${address.port}/plugins/qoder-link`
  try{
    const input={cliVariant:'qodercli',name:'Test',token:'SECRET-PAT'}
    assert.equal((await fetch(base+'/accounts/add',post(input,{Origin:'https://evil.test'}))).status,403)
    assert.equal((await fetch(base+'/accounts/add',{method:'POST',body:JSON.stringify(input)})).status,415)
    assert.equal((await fetch(base+'/accounts/add',post({...input,cliVariant:'qoderclicn'}))).status,400)
    const added=await fetch(base+'/accounts/add',post(input));assert.equal(added.status,200)
    const text=await added.text();assert.doesNotMatch(text,/SECRET|token/);const snapshot=JSON.parse(text)
    const id=snapshot.accounts[0].id
    assert.equal(snapshot.managed,true);assert.equal(snapshot.selectedAccountId,id)
    assert.equal((await fetch(base+'/accounts/update',post({id,token:'SECRET\nINVALID'}))).status,400)
    const status=await (await fetch(base+'/status')).text();assert.doesNotMatch(status,/SECRET|token/)
    await fetch(base+'/accounts/remove',post({id}))
    const empty=await (await fetch(base+'/accounts')).json();assert.equal(empty.managed,true);assert.deepEqual(empty.accounts,[])
    await assert.rejects(accounts.acquire({prompt:'test',cwd:dir}))
    const oversized=await fetch(base+'/accounts/add',post({...input,token:'SECRET'.repeat(6000)}));assert.equal(oversized.status,400);assert.doesNotMatch(await oversized.text(),/SECRET/)
  }finally{dispose();await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections()});rmSync(dir,{recursive:true,force:true})}
})
