import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverModels, parseModels, modelFailures, ModelDiscoveryError } from '../src/models.ts'
import { resolveConfig } from '../src/config.ts'

test('official model table parser validates header, bounds and identifiers', () => {
  assert.deepEqual(parseModels('\x1b[1mMODEL\x1b[0m\r\nAuto\r\nFast\r\nAuto\n'), [{id:'Auto',name:'Auto'},{id:'Fast',name:'Fast'}])
  for (const output of ['', 'MODEL', 'Please login', 'MODEL\nhttps://secret', 'MODEL\ninvalid model', 'MODEL\n' + Array(257).fill('Auto').join('\n')]) assert.throws(() => parseModels(output), {message:modelFailures.format})
})
test('discovery selects each regional binary, strips PAT, and sanitizes failure paths', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'qoder-discovery-test-'))
  t.after(() => rm(directory, {recursive:true,force:true}))
  const bin = join(directory, 'fake.mjs')
  await writeFile(bin, `if (process.argv.slice(2).join() !== '--list-models' || Object.keys(process.env).some(k=>['QODER_PERSONAL_ACCESS_TOKEN','QODERCN_PERSONAL_ACCESS_TOKEN'].includes(k.toUpperCase()))) process.exit(3); console.log('MODEL\\nAuto\\nFast')`)
  const previous = process.env.QODER_PERSONAL_ACCESS_TOKEN
  process.env.QODER_PERSONAL_ACCESS_TOKEN = 'SECRET'
  try {
    for (const cliVariant of ['qodercli','qoderclicn']) {
      const config = resolveConfig({cliVariant,qodercliBin:cliVariant === 'qodercli' ? bin : 'missing',qoderclicnBin:cliVariant === 'qoderclicn' ? bin : 'missing'}, {})
      assert.equal((await discoverModels(config)).models.length, 2)
    }
  } finally { if (previous === undefined) delete process.env.QODER_PERSONAL_ACCESS_TOKEN; else process.env.QODER_PERSONAL_ACCESS_TOKEN = previous }
  const config = resolveConfig({qodercliBin:bin}, {})
  for (const [source, kind] of [
    [`console.error('SECRET');process.exit(1)`, 'exit'], [`console.log('SECRET')`, 'format'],
    [`process.stdout.write('x'.repeat(70000));setInterval(()=>{},1000)`, 'output'], [`setInterval(()=>{},1000)`, 'timeout'],
  ] as const) {
    await writeFile(bin, source)
    await assert.rejects(discoverModels(config, kind === 'timeout' ? 500 : 4000), error => {
      assert.ok(error instanceof ModelDiscoveryError)
      assert.equal(error.kind, kind)
      assert.equal(error.message, modelFailures[kind])
      assert.doesNotMatch(error.message, /SECRET|private|fake\.mjs/)
      return true
    })
  }
  await assert.rejects(discoverModels(resolveConfig({qodercliBin:join(directory,'missing')}, {})), {message:modelFailures.unavailable})
})
