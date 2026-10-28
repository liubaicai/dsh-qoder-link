import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {SettingsStore} from '../src/settings.ts'
import {resolveConfig, selectedBin} from '../src/config.ts'
import {QoderAdapter, type Runner} from '../src/adapter.ts'

test('variants never fall back across regions, and accept separate executable overrides', () => {
  assert.equal(selectedBin(resolveConfig({}, {})), 'qodercli')
  assert.equal(selectedBin(resolveConfig({cliVariant:'qoderclicn'}, {})), 'qoderclicn')
  const cfg = resolveConfig({qodercliBin:'qoder',qoderclicnBin:'qodercn'}, {})
  assert.equal(selectedBin(cfg),'qoder'); cfg.cliVariant='qoderclicn'; assert.equal(selectedBin(cfg),'qodercn')
  assert.throws(() => resolveConfig({cliVariant:'other'}, {}))
  assert.throws(() => resolveConfig({timeoutMs:2147483648}, {}))
  assert.throws(() => resolveConfig({workspaceRoot:'relative'}, {}))
  assert.throws(() => resolveConfig({defaultModel:'default',hiddenModels:['default']}, {}))
})

test('settings persist both paths atomically, preserve live identity, and reject invalid updates', () => {
  const root=mkdtempSync(join(tmpdir(),'qoder-settings-'))
  try {
    const path=join(root,'settings.json'); const store=new SettingsStore({},path); const identity=store.config
    store.update({cliVariant:'qoderclicn',qodercliBin:'qoder',qoderclicnBin:'qodercn',models:['Qwen3.8-Flash']})
    assert.equal(store.config,identity); assert.equal(selectedBin(identity),'qodercn')
    const raw=readFileSync(path,'utf8'); assert.equal(new SettingsStore({},path).config.qodercliBin,'qoder')
    assert.throws(() => store.update({cliVariant:'bad'})); assert.throws(() => store.update({token:'secret'}))
    assert.equal(readFileSync(path,'utf8'),raw); assert.equal(store.config.cliVariant,'qoderclicn')
    writeFileSync(path,'invalid'); assert.throws(() => new SettingsStore({},path), /Cannot read/)
  } finally {rmSync(root,{recursive:true,force:true})}
})

test('provider follows live region changes but never enables CLI tools', async () => {
  const cfg=resolveConfig({tools:'default',permissionMode:'accept_edits',qodercliBin:'international',qoderclicnBin:'china'}, {})
  const seen:string[]=[]
  const runner:Runner=async function* (request) {
    seen.push(request.bin!); assert.equal(request.tools,''); assert.equal(request.permissionMode,'dont_ask')
    yield {type:'result',text:'ok'}
  }
  const adapter=new QoderAdapter(cfg,runner)
  for await(const _ of adapter.stream({provider:'qoder',model:'default',messages:[]})) { /* consume */ }
  cfg.cliVariant='qoderclicn'
  for await(const _ of adapter.stream({provider:'qoder',model:'default',messages:[]})) { /* consume */ }
  assert.deepEqual(seen,['international','china'])
  cfg.enabled=false; assert.deepEqual(await adapter.listModels(),[])
})
