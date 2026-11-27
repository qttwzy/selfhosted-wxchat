import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('frontend cache-busting matches the service worker version', () => {
  const serviceWorker = read('public/sw.js')
  const swVersion = serviceWorker.match(/wxchat-v(\d+\.\d+\.\d+)/)?.[1]
  assert.ok(swVersion)

  for (const path of ['public/index.html', 'public/login.html']) {
    const versions = [...read(path).matchAll(/\?v=(\d+\.\d+\.\d+)/g)].map((match) => match[1])
    assert.ok(versions.length > 0)
    assert.deepEqual([...new Set(versions)], [swVersion])
  }

  assert.match(read('public/js/components/functionMenu.js'), new RegExp(`STYLE_VERSION: '${swVersion}'`))
})

test('marked html renderer override is registered once', () => {
  const source = read('public/js/utils.js')
  assert.match(source, /if \(!markedHtmlRendererRegistered && typeof marked\.use === 'function'\)/)
  assert.equal((source.match(/marked\.use\(/g) || []).length, 1)
})
