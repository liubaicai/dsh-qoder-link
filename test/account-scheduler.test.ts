import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountStore } from '../src/accounts.ts'
import { AccountScheduler } from '../src/account-scheduler.ts'

test('pool spreads parallel calls, serializes per account, aborts and releases idempotently',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'qoder-scheduler-'))
 try{
  const store=new AccountStore(join(dir,'accounts.json'))
  store.add({name:'A',cliVariant:'qodercli',token:'PAT-A'});store.add({name:'B',cliVariant:'qodercli',token:'PAT-B'})
  store.configure({cliVariant:'qodercli',mode:'pool'})
  const scheduler=new AccountScheduler(store,()=>500)
  const a=await scheduler.acquire('qodercli'),b=await scheduler.acquire('qodercli')
  assert.notEqual(a.accountId,b.accountId)
  const controller=new AbortController(),aborted=assert.rejects(scheduler.acquire('qodercli',controller.signal),{name:'AbortError'})
  controller.abort();await aborted
  let granted=false
  const next=scheduler.acquire('qodercli').then(lease=>{granted=true;return lease})
  await Promise.resolve();assert.equal(granted,false)
  a.release();a.release();b.release();const c=await next;c.release()
  assert.deepEqual(scheduler.activeCounts(),{})
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('fixed selection changes invalidate waiting calls and timeout frees queue entries',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'qoder-scheduler-'))
 try{
  const store=new AccountStore(join(dir,'accounts.json'))
  store.add({name:'A',cliVariant:'qodercli',token:'PAT-A'});const b=store.add({name:'B',cliVariant:'qodercli',token:'PAT-B'})
  const scheduler=new AccountScheduler(store,()=>10),a=await scheduler.acquire('qodercli')
  await assert.rejects(scheduler.acquire('qodercli'),{name:'QueueTimeoutError'})
  const pending=assert.rejects(scheduler.acquire('qodercli'),{name:'AccountSelectionError'})
  store.configure({cliVariant:'qodercli',mode:'fixed',accountId:b.id});scheduler.refresh();await pending
  a.release();const next=await scheduler.acquire('qodercli');assert.equal(next.accountId,b.id);next.release()
 }finally{rmSync(dir,{recursive:true,force:true})}
})
