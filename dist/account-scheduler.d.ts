import type { AccountStore, CliVariant } from './accounts.ts';
export interface AccountLease {
    accountId: string;
    cliVariant: CliVariant;
    mode: 'fixed' | 'pool';
    authToken: string;
    release(): void;
}
/** Process-local, one active operation per account. Reservations and store reads are synchronous. */
export declare class AccountScheduler {
    private readonly active;
    private readonly queue;
    private last;
    private readonly store;
    private readonly timeout;
    constructor(store: AccountStore, timeout?: () => number);
    activeCounts(): Record<string, number>;
    refresh(): void;
    acquire(variant: CliVariant, signal?: AbortSignal): Promise<AccountLease>;
    private remove;
    private fail;
    private pump;
}
