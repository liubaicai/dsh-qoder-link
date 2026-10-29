import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, unlinkSync, linkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountStore } from '../src/accounts.ts'
import { AccountService } from '../src/account-service.ts'
import { resolveConfig } from '../src/config.ts'
function fixture(run:(store:AccountStore,path:string)=>void) {const dir=mkdtempSync(join(tmpdir(),'qoder-accounts-'));try{const path=join(dir,'accounts.json');run(new AccountStore(path),path)}finally{rmSync(dir,{recursive:true,force:true})}}

test('PAT metadata, region isolation, updates and durable managed tombstones',()=>fixture((store,path)=>{
  assert.equal(store.snapshot('qodercli').managed,false)
  const global=store.add({cliVariant:'qodercli',name:'Global',token:'SECRET-GLOBAL'})
  const cn=store.add({cliVariant:'qoderclicn',name:'China',token:'SECRET-CN'})
  assert.doesNotMatch(JSON.stringify(store.snapshot('qodercli')),/SECRET|China/)
  assert.equal(store.snapshot('qodercli').selectedAccountId,global.id)
  assert.equal(store.read(global.id,'qoderclicn'),undefined)
  assert.equal(store.read(cn.id,'qoderclicn'),'SECRET-CN')
  store.update(global.id,{name:'Renamed',token:'SECRET-NEW',enabled:false})
  assert.equal(store.read(global.id,'qodercli'),undefined)
  assert.equal(store.snapshot('qodercli').selectedAccountId,undefined)
  store.update(global.id,{enabled:true});store.configure({cliVariant:'qodercli',mode:'fixed',accountId:global.id})
  store.remove(global.id)
  assert.equal(new AccountStore(path).snapshot('qodercli').managed,true)
  assert.equal(new AccountStore(path).snapshot('qodercli').accounts.length,0)
  assert.equal(new AccountStore(path).snapshot('qoderclicn').accounts.length,1)
}))
test('invalid PAT input and corrupted/removed stores fail closed and sanitized',()=>fixture((store,path)=>{
  for(const value of ['', 'with space','newline\nsecret', 'x'.repeat(8193)])assert.throws(()=>store.add({cliVariant:'qodercli',name:'Test',token:value}))
  store.add({cliVariant:'qodercli',name:'Test',token:'SECRET'})
  unlinkSync(path);assert.throws(()=>store.snapshot('qodercli'),/Cannot access/);assert.throws(()=>new AccountStore(path).snapshot('qodercli'),/Cannot access/)
  writeFileSync(path,'SECRET broken');assert.throws(()=>new AccountStore(path).snapshot('qodercli'),error=>error instanceof Error && !error.message.includes('SECRET'))
}))
test('store rejects hard links, stale revisions and locked mutation without corrupting data',()=>fixture((store,path)=>{
  const account=store.add({cliVariant:'qodercli',name:'Test',token:'SECRET'})
  const first=readFileSync(path,'utf8');store.update(account.id,{name:'New'})
  writeFileSync(path,first);assert.throws(()=>store.snapshot('qodercli'))
  const fresh=new AccountStore(path);writeFileSync(path+'.lock','lock')
  assert.throws(()=>fresh.remove(account.id));assert.equal(readFileSync(path,'utf8'),first)
  unlinkSync(path+'.lock');linkSync(path,path+'.hardlink');assert.throws(()=>fresh.snapshot('qodercli'))
}))
test('service only permits local CLI authentication before management is enabled',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'qoder-service-'))
  try {
    const store=new AccountStore(join(dir,'accounts.json')),config=resolveConfig({},{}),service=new AccountService(store,config)
    const request={prompt:'x',cwd:dir}
    assert.equal(await service.acquire(request),undefined)
    const row=store.add({cliVariant:'qodercli',name:'Account',token:'SECRET'})
    assert.throws(()=>service.beforeRun(undefined,request))
    const lease=await service.acquire(request);assert.ok(lease)
    assert.equal(service.beforeRun(lease,request),'SECRET')
    service.update(row.id,{token:'SECRET-NEW'});assert.throws(()=>service.beforeRun(lease,request));lease.release()
    service.remove(row.id);await assert.rejects(service.acquire(request),/No usable/)
    assert.equal(await service.acquire({...request,cliVariant:'qoderclicn'}),undefined)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
