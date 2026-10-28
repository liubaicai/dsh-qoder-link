import { isQoderEffort } from "./config.js";
/** An explicit auto uses the CLI default; omission inherits the plugin default. */
export function resolveEffort(value, fallback) {
    const selected = value === undefined ? fallback : value;
    if (selected === 'auto')
        return undefined;
    if (!isQoderEffort(selected))
        throw new Error('Unsupported reasoning effort');
    return selected;
}
//# sourceMappingURL=effort.js.map