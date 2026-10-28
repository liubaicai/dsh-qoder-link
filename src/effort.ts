import { isQoderEffort, type QoderEffort } from './config.ts'

/** An explicit auto uses the CLI default; omission inherits the plugin default. */
export function resolveEffort(value: unknown, fallback: string): QoderEffort | undefined {
  const selected = value === undefined ? fallback : value
  if (selected === 'auto') return undefined
  if (!isQoderEffort(selected)) throw new Error('Unsupported reasoning effort')
  return selected
}
