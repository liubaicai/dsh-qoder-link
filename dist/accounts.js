import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { settingsPath } from "./settings.js";
const invalid = () => new Error('Invalid Qoder account configuration');
const fail = () => new Error('Cannot access Qoder account store; repair the store before continuing');
export function isVariant(value) { return value === 'qodercli' || value === 'qoderclicn'; }
export function object(value, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)))
        throw invalid();
    return value;
}
function name(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\x00-\x1f\x7f]/.test(value))
        throw invalid();
    return value.trim();
}
function token(value) {
    if (typeof value !== 'string' || !value || value.length > 8192 || /[\s\x00-\x1f\x7f]/.test(value))
        throw invalid();
    return value;
}
function metadata(row) { return { id: row.id, name: row.name, cliVariant: row.cliVariant, enabled: row.enabled, authState: 'unverified', createdAt: row.createdAt }; }
function empty() { return { version: 1, revision: 0, managed: [], selections: { qodercli: { mode: 'fixed' }, qoderclicn: { mode: 'fixed' } }, accounts: [] }; }
function validate(value) {
    const root = object(value, ['version', 'revision', 'managed', 'selections', 'accounts']);
    if (root.version !== 1 || !Number.isSafeInteger(root.revision) || Number(root.revision) < 0 || !Array.isArray(root.managed) || root.managed.some(v => !isVariant(v)) || new Set(root.managed).size !== root.managed.length || !Array.isArray(root.accounts) || root.accounts.length > 20)
        throw invalid();
    const selections = object(root.selections, ['qodercli', 'qoderclicn']);
    const ids = new Set();
    for (const value of root.accounts) {
        const row = object(value, ['id', 'name', 'cliVariant', 'enabled', 'authState', 'createdAt', 'token']);
        if (typeof row.id !== 'string' || !/^[a-f0-9-]{36}$/.test(row.id) || ids.has(row.id) || !isVariant(row.cliVariant) || !root.managed.includes(row.cliVariant) || typeof row.enabled !== 'boolean' || row.authState !== 'unverified' || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)))
            throw invalid();
        name(row.name);
        token(row.token);
        ids.add(row.id);
    }
    for (const variant of ['qodercli', 'qoderclicn']) {
        const selection = object(selections[variant], ['mode', 'selectedAccountId']);
        if (selection.mode !== 'fixed' && selection.mode !== 'pool')
            throw invalid();
        if (selection.selectedAccountId !== undefined && (selection.mode !== 'fixed' || !root.accounts.some(row => row.id === selection.selectedAccountId && row.cliVariant === variant && row.enabled)))
            throw invalid();
    }
    return root;
}
function directories(path) {
    for (let current = dirname(resolve(path));;) {
        try {
            const stat = lstatSync(current);
            if (!stat.isDirectory() || stat.isSymbolicLink())
                throw invalid();
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        const parent = dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
}
/** Dedicated secret file; no CLI login discovery and no tokens in public projections. */
export class AccountStore {
    path;
    observed = false;
    revision = 0;
    managed = new Set();
    constructor(path = join(dirname(settingsPath()), 'accounts.json')) { this.path = resolve(path); }
    load() {
        let fd;
        try {
            directories(this.path);
            let before;
            try {
                before = lstatSync(this.path);
            }
            catch (error) {
                if (error.code === 'ENOENT' && !this.observed) {
                    try {
                        lstatSync(this.path + '.managed');
                    }
                    catch (markerError) {
                        if (markerError.code === 'ENOENT')
                            return empty();
                        throw markerError;
                    }
                }
                throw error;
            }
            if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 512 * 1024)
                throw invalid();
            fd = openSync(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            const after = fstatSync(fd);
            if (before.dev !== after.dev || before.ino !== after.ino || after.nlink !== 1 || after.size > 512 * 1024)
                throw invalid();
            const bytes = Buffer.alloc(512 * 1024 + 1);
            let length = 0;
            while (length < bytes.length) {
                const count = readSync(fd, bytes, length, bytes.length - length, length);
                if (!count)
                    break;
                length += count;
            }
            if (length >= bytes.length)
                throw invalid();
            const final = lstatSync(this.path);
            if (final.isSymbolicLink() || final.dev !== after.dev || final.ino !== after.ino || final.nlink !== 1)
                throw invalid();
            const state = validate(JSON.parse(bytes.subarray(0, length).toString('utf8')));
            if (state.revision < this.revision || [...this.managed].some(v => !state.managed.includes(v)))
                throw invalid();
            this.observed = true;
            this.revision = state.revision;
            this.managed = new Set(state.managed);
            return state;
        }
        catch {
            throw fail();
        }
        finally {
            if (fd !== undefined)
                closeSync(fd);
        }
    }
    mutate(change) {
        // Exclusive lock prevents lost updates across multiple store instances/processes.
        const lock = this.path + '.lock', tmp = this.path + '.' + randomUUID() + '.tmp';
        let lockFd, fd;
        try {
            directories(this.path);
            mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
            directories(this.path);
            lockFd = openSync(lock, 'wx', 0o600);
            const state = this.load();
            change(state);
            state.revision++;
            validate(state);
            const data = JSON.stringify(state) + '\n';
            if (Buffer.byteLength(data) > 512 * 1024)
                throw invalid();
            fd = openSync(tmp, 'wx', 0o600);
            writeFileSync(fd, data, 'utf8');
            fsyncSync(fd);
            closeSync(fd);
            fd = undefined;
            chmodSync(tmp, 0o600);
            // Durable non-secret tombstone: removing the secret file must not re-enable local login after restart.
            const marker = this.path + '.managed';
            let markerFd;
            try {
                markerFd = openSync(marker, 'wx', 0o600);
                writeFileSync(markerFd, 'managed\n');
                fsyncSync(markerFd);
            }
            catch (error) {
                if (error.code !== 'EEXIST')
                    throw error;
                const stat = lstatSync(marker);
                if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
                    throw invalid();
            }
            finally {
                if (markerFd !== undefined)
                    closeSync(markerFd);
            }
            directories(this.path);
            try {
                const stat = lstatSync(this.path);
                if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
                    throw invalid();
            }
            catch (error) {
                if (error.code !== 'ENOENT' || this.observed)
                    throw error;
            }
            renameSync(tmp, this.path);
            if (process.platform !== 'win32') {
                const directoryFd = openSync(dirname(this.path), constants.O_RDONLY);
                try {
                    fsyncSync(directoryFd);
                }
                finally {
                    closeSync(directoryFd);
                }
            }
            this.observed = true;
            this.revision = state.revision;
            this.managed = new Set(state.managed);
        }
        catch {
            throw fail();
        }
        finally {
            if (fd !== undefined)
                closeSync(fd);
            try {
                unlinkSync(tmp);
            }
            catch { /* only owned temporary path */ }
            if (lockFd !== undefined) {
                closeSync(lockFd);
                try {
                    unlinkSync(lock);
                }
                catch { /* stale lock fails closed */ }
            }
        }
    }
    snapshot(cliVariant) {
        if (!isVariant(cliVariant))
            throw invalid();
        const state = this.load();
        return { managed: state.managed.includes(cliVariant), cliVariant, ...state.selections[cliVariant], accounts: state.accounts.filter(row => row.cliVariant === cliVariant).map(metadata), patSupport: 'supported' };
    }
    read(id, cliVariant) { return this.load().accounts.find(row => row.id === id && row.cliVariant === cliVariant && row.enabled)?.token; }
    add(input) {
        const value = object(input, ['cliVariant', 'name', 'token']);
        if (!isVariant(value.cliVariant))
            throw invalid();
        const row = { id: randomUUID(), cliVariant: value.cliVariant, name: name(value.name), token: token(value.token), enabled: true, authState: 'unverified', createdAt: new Date().toISOString() };
        this.mutate(state => {
            if (state.accounts.length >= 20)
                throw invalid();
            const first = !state.managed.includes(row.cliVariant);
            if (first)
                state.managed.push(row.cliVariant);
            state.accounts.push(row);
            if (first && state.selections[row.cliVariant].mode === 'fixed')
                state.selections[row.cliVariant].selectedAccountId = row.id;
        });
        return metadata(row);
    }
    update(id, patch) {
        const value = object(patch, ['name', 'enabled', 'token']);
        if ('name' in value)
            name(value.name);
        if ('token' in value)
            token(value.token);
        if ('enabled' in value && typeof value.enabled !== 'boolean')
            throw invalid();
        this.mutate(state => {
            const row = state.accounts.find(row => row.id === id);
            if (!row)
                throw invalid();
            if ('name' in value)
                row.name = name(value.name);
            if ('token' in value)
                row.token = token(value.token);
            if ('enabled' in value)
                row.enabled = value.enabled;
            if (!row.enabled && state.selections[row.cliVariant].selectedAccountId === id)
                delete state.selections[row.cliVariant].selectedAccountId;
        });
    }
    remove(id) {
        this.mutate(state => {
            const row = state.accounts.find(row => row.id === id);
            if (!row)
                throw invalid();
            state.accounts = state.accounts.filter(row => row.id !== id);
            if (state.selections[row.cliVariant].selectedAccountId === id)
                delete state.selections[row.cliVariant].selectedAccountId;
        });
    }
    configure(input) {
        const value = object(input, ['cliVariant', 'mode', 'accountId']);
        if (!isVariant(value.cliVariant) || (value.mode !== 'fixed' && value.mode !== 'pool') || ('accountId' in value && typeof value.accountId !== 'string') || (value.mode === 'pool' && value.accountId !== undefined))
            throw invalid();
        this.mutate(state => {
            const variant = value.cliVariant;
            if (!state.managed.includes(variant))
                state.managed.push(variant);
            if (value.mode === 'fixed' && !state.accounts.some(row => row.id === value.accountId && row.cliVariant === variant && row.enabled))
                throw invalid();
            state.selections[variant] = { mode: value.mode, ...(value.mode === 'fixed' ? { selectedAccountId: value.accountId } : {}) };
        });
    }
}
//# sourceMappingURL=accounts.js.map