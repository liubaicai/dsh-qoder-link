import { AccountStore } from './accounts.ts';
import { AccountScheduler, type AccountLease } from './account-scheduler.ts';
import type { PluginConfig } from './config.ts';
import type { QoderRequest } from './runner.ts';
/** PAT storage is not remote authentication verification. Official ACP supports both regional PAT variables. */
export declare class AccountService {
    readonly scheduler: AccountScheduler;
    readonly store: AccountStore;
    private readonly config;
    constructor(store: AccountStore, config: PluginConfig);
    snapshot(): {
        accounts: {
            active: number;
            id: string;
            name: string;
            cliVariant: import("./accounts.ts").CliVariant;
            enabled: boolean;
            authState: "unverified";
            createdAt: string;
        }[];
        managed: boolean;
        cliVariant: import("./accounts.ts").CliVariant;
        mode: "fixed" | "pool";
        selectedAccountId?: string;
        patSupport: "supported" | "unknown";
    };
    acquire(request: QoderRequest): Promise<AccountLease | undefined>;
    beforeRun(lease: AccountLease | undefined, request: QoderRequest): string | undefined;
    add(value: unknown): void;
    update(id: string, value: unknown): void;
    remove(id: string): void;
    configure(value: unknown): void;
    changed(): void;
    private assertCurrent;
}
