import test from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'

async function authApp(name) {
  const { authRoutes } = await import(`../worker/auth.js?${name}`)
  return new Hono().route('/api/auth', authRoutes)
}

function failedLogin(app, clientIp, headers = {}) {
  return app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ password: 'wrong' }),
  }, { CLIENT_IP: clientIp, ACCESS_PASSWORD: 'test-password' })
}

test('self-hosted clients cannot reset their limit with proxy headers', async () => {
  const app = await authApp('headers')
  for (let i = 0; i < 5; i++) {
    const response = await failedLogin(app, 'peer-one', {
      'CF-Connecting-IP': `spoofed-${i}`,
      'X-Forwarded-For': `spoofed-${i}`,
    })
    assert.equal(response.status, 401)
  }
  assert.equal((await failedLogin(app, 'peer-one', {
    'CF-Connecting-IP': 'another-spoof',
  })).status, 429)
  assert.equal((await failedLogin(app, 'peer-two')).status, 401)
})

test('login buckets have a fixed bound and expire for inactive peers', async (t) => {
  const app = await authApp('expiry')
  const now = Date.now()
  t.mock.method(Date, 'now', () => now)
  for (let i = 0; i < 1000; i++) {
    assert.equal((await failedLogin(app, `peer-${i}`)).status, 401)
  }
  assert.equal((await failedLogin(app, 'overflow-peer')).status, 429)
  t.mock.method(Date, 'now', () => now + 15 * 60 * 1000)
  assert.equal((await failedLogin(app, 'new-peer')).status, 401)
  assert.equal((await failedLogin(app, 'peer-0')).status, 401)
})
