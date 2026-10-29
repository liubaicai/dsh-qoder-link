export type CliVariant = 'qodercli' | 'qoderclicn';
export interface AccountMetadata {
    id: string;
    name: string;
    cliVariant: CliVariant;
    enabled: boolean;
    authState: 'unverified';
    createdAt: string;
}
export interface AccountConfiguration {
    cliVariant: CliVariant;
    mode: 'fixed' | 'pool';
    accountId?: string;
}
export interface AccountSnapshot {
    managed: boolean;
    cliVariant: CliVariant;
    mode: 'fixed' | 'pool';
    selectedAccountId?: string;
    accounts: AccountMetadata[];
    patSupport: 'supported' | 'unknown';
}
export declare function isVariant(value: unknown): value is CliVariant;
export declare function object(value: unknown, allowed: string[]): Record<string, unknown>;
/** Dedicated secret file; no CLI login discovery and no tokens in public projections. */
export declare class AccountStore {
    readonly path: string;
    private observed;
    private revision;
    private managed;
    constructor(path?: string);
    private load;
    private mutate;
    snapshot(cliVariant: CliVariant): AccountSnapshot;
    read(id: string, cliVariant: CliVariant): string | undefined;
    add(input: unknown): AccountMetadata;
    update(id: string, patch: unknown): void;
    remove(id: string): void;
    configure(input: unknown): void;
}
