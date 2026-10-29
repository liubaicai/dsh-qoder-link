import { AccountStore } from "./accounts.js";
import { AccountScheduler } from "./account-scheduler.js";
/** PAT storage is not remote authentication verification. Official ACP supports both regional PAT variables. */
export class AccountService {
    scheduler;
    store;
    config;
    constructor(store, config) {
        this.store = store;
        this.config = config;
        this.scheduler = new AccountScheduler(store, () => config.queueTimeoutMs);
    }
    snapshot() { const value = this.store.snapshot(this.config.cliVariant), active = this.scheduler.activeCounts(); return { ...value, accounts: value.accounts.map(row => ({ ...row, active: active[row.id] ?? 0 })) }; }
    async acquire(request) {
        const variant = request.cliVariant ?? this.config.cliVariant;
        const snapshot = this.store.snapshot(variant);
        if (!snapshot.managed)
            return undefined;
        if (snapshot.patSupport !== 'supported')
            throw new Error('Managed PAT authentication for qoderclicn is not verified; CLI-local fallback is disabled');
        return this.scheduler.acquire(variant, request.signal);
    }
    beforeRun(lease, request) {
        const variant = request.cliVariant ?? this.config.cliVariant;
        const snapshot = this.store.snapshot(variant);
        if (!lease) {
            if (snapshot.managed)
                throw new Error('Qoder account management changed while queued');
            return undefined;
        }
        if (lease.cliVariant !== variant || snapshot.mode !== lease.mode || (snapshot.mode === 'fixed' && snapshot.selectedAccountId !== lease.accountId) || !snapshot.accounts.some(row => row.id === lease.accountId && row.enabled))
            throw new Error('Qoder account selection changed while queued');
        const token = this.store.read(lease.accountId, variant);
        if (!token || token !== lease.authToken)
            throw new Error('Qoder account credential changed while queued');
        return token;
    }
    add(value) { this.store.add(value); this.scheduler.refresh(); }
    update(id, value) { this.assertCurrent(id); this.store.update(id, value); this.scheduler.refresh(); }
    remove(id) { this.assertCurrent(id); this.store.remove(id); this.scheduler.refresh(); }
    configure(value) { this.store.configure(value); this.scheduler.refresh(); }
    changed() { this.scheduler.refresh(); }
    assertCurrent(id) { if (!this.store.snapshot(this.config.cliVariant).accounts.some(row => row.id === id))
        throw new Error('Qoder account does not exist for this CLI variant'); }
}
//# sourceMappingURL=account-service.js.map