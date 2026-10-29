import type { AccountStore, CliVariant } from './accounts.ts'
export interface AccountLease { accountId: string; cliVariant: CliVariant; mode: 'fixed'|'pool'; authToken: string; release(): void }
interface Waiter { variant: CliVariant; selected?: string; mode?: 'fixed'|'pool'; resolve(value:AccountLease):void; reject(error:Error):void; cleanup():void }
function failure(name: string, message: string): Error { const error = new Error(message); error.name = name; return error }
/** Process-local, one active operation per account. Reservations and store reads are synchronous. */
export class AccountScheduler {
  private readonly active = new Map<string,number>()
  private readonly queue: Waiter[] = []
  private last = ''
  private readonly store: AccountStore
  private readonly timeout: () => number
  constructor(store: AccountStore, timeout: () => number = () => 60000) { this.store=store; this.timeout=timeout }
  activeCounts(): Record<string,number> { return Object.fromEntries(this.active) }
  refresh(): void { this.pump() }
  acquire(variant: CliVariant, signal?: AbortSignal): Promise<AccountLease> {
    if (signal?.aborted) return Promise.reject(failure('AbortError','Account acquisition aborted'))
    if (this.queue.length >= 64) return Promise.reject(failure('QueueFullError','Account queue is full'))
    return new Promise((resolve,reject) => {
      const timeout = this.timeout()
      if (!Number.isFinite(timeout) || timeout < 1 || timeout > 2147483647) { reject(failure('AccountSelectionError','Invalid account queue timeout')); return }
      const abort = () => this.fail(waiter, failure('AbortError','Account acquisition aborted'))
      const timer = setTimeout(() => this.fail(waiter,failure('QueueTimeoutError','Account queue wait timed out')),timeout)
      const waiter: Waiter = {variant,resolve,reject,cleanup:() => {clearTimeout(timer);signal?.removeEventListener('abort',abort)}}
      this.queue.push(waiter); signal?.addEventListener('abort',abort,{once:true})
      if (signal?.aborted) abort(); else this.pump()
    })
  }
  private remove(waiter:Waiter): void { const at=this.queue.indexOf(waiter); if(at>=0)this.queue.splice(at,1);waiter.cleanup() }
  private fail(waiter:Waiter,error:Error):void { if(!this.queue.includes(waiter))return;this.remove(waiter);waiter.reject(error) }
  private pump():void {
    for(const waiter of [...this.queue]) {
      try {
        const snapshot=this.store.snapshot(waiter.variant)
        if(!snapshot.managed)throw new Error()
        if(waiter.mode && (waiter.mode!==snapshot.mode || (snapshot.mode==='fixed' && waiter.selected!==snapshot.selectedAccountId)))throw new Error()
        const eligible=snapshot.accounts.filter(row=>row.enabled)
        if(!waiter.mode) {
          waiter.mode=snapshot.mode
          if(snapshot.mode==='fixed')waiter.selected=snapshot.selectedAccountId
          else {
            const available=eligible.filter(row=>!this.active.has(row.id))
            const pool=available.length ? available : eligible
            waiter.selected=pool[(pool.findIndex(row=>row.id===this.last)+1)%pool.length]?.id
            this.last=waiter.selected??''
          }
        }
        if(!waiter.selected || !eligible.some(row=>row.id===waiter.selected))throw new Error()
        if(this.active.has(waiter.selected))continue
        const authToken=this.store.read(waiter.selected,waiter.variant);if(!authToken)throw new Error()
        const id=waiter.selected;this.active.set(id,1);this.remove(waiter)
        let released=false
        waiter.resolve({accountId:id,cliVariant:waiter.variant,mode:snapshot.mode,authToken,release:()=>{if(released)return;released=true;this.active.delete(id);this.pump()}})
      }catch {this.fail(waiter,failure('AccountSelectionError','No usable managed Qoder account; configure an account before retrying'))}
    }
  }
}
