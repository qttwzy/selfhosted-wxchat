import test from 'node:test'
import assert from 'node:assert/strict'
import { assertSecureAuth, parseSessionExpireHours, WEAK_ACCESS_PASSWORDS } from '../server/security.js'
import { isPublicAuthPath, allowsQueryToken } from '../worker/auth-policy.js'

test('rejects missing and example credentials', () => {
  assert.throws(() => assertSecureAuth({ accessPassword: '', jwtSecret: 'x'.repeat(32) }), /ACCESS_PASSWORD/)
  assert.throws(() => assertSecureAuth({ accessPassword: 'wxchat2024', jwtSecret: 'x'.repeat(32) }), /过弱/)
  assert.throws(() => assertSecureAuth({ accessPassword: 'a-valid-long-password', jwtSecret: 'change-me-long-random-string' }), /JWT_SECRET/)
  assert.throws(() => assertSecureAuth({ accessPassword: 'a-valid-long-password', jwtSecret: 'short' }), /JWT_SECRET/)
  assert.doesNotThrow(() => assertSecureAuth({
    accessPassword: 'a-valid-long-password',
    jwtSecret: 'n'.repeat(32),
  }))
  assert.ok(WEAK_ACCESS_PASSWORDS.has('wxchat2024'))
})

test('session expiry rejects non-numeric values', () => {
  assert.equal(parseSessionExpireHours('abc'), 24)
  assert.equal(parseSessionExpireHours('0'), 24)
  assert.equal(parseSessionExpireHours('48'), 48)
})

test('auth middleware does not skip API by file extension', () => {
  assert.equal(isPublicAuthPath('/api/files/note.js'), false)
  assert.equal(isPublicAuthPath('/api/files/style.css'), false)
  assert.equal(isPublicAuthPath('/api/auth/login'), true)
  assert.equal(allowsQueryToken('/api/files/secret.ico'), false)
  assert.equal(allowsQueryToken('/api/events'), true)
})
