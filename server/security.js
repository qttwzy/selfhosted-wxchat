export const WEAK_ACCESS_PASSWORDS = new Set([
  'wxchat2024',
  'password',
  '123456',
  'admin',
])

export const WEAK_JWT_SECRETS = new Set([
  'change-this-jwt-secret',
  'change-me-long-random-string',
  'secret',
])

export function parseSessionExpireHours(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 720) return 24
  return parsed
}

export function assertSecureAuth({ accessPassword, jwtSecret }) {
  if (!accessPassword) {
    throw new Error('必须设置 ACCESS_PASSWORD，模板示例值不可用')
  }
  if (WEAK_ACCESS_PASSWORDS.has(accessPassword) || accessPassword.length < 12) {
    throw new Error('ACCESS_PASSWORD 过弱或为仓内示例值，请改用至少 12 位的独立密码')
  }
  if (!jwtSecret) {
    throw new Error('必须设置 JWT_SECRET，模板示例值不可用')
  }
  if (WEAK_JWT_SECRETS.has(jwtSecret) || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET 过弱或为仓内示例值，请改用至少 32 位随机串')
  }
}
