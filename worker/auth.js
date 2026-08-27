import { Hono } from 'hono'
import { allowsQueryToken, isPublicAuthPath } from './auth-policy.js'

export { allowsQueryToken, isPublicAuthPath }

const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 5
const loginAttempts = new Map()

function clientKey(c) {
  const forwarded = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || ''
  return forwarded.split(',')[0].trim() || 'local'
}

function readLoginBucket(key) {
  const now = Date.now()
  const bucket = loginAttempts.get(key)
  if (!bucket || now - bucket.startedAt > LOGIN_WINDOW_MS) {
    return { startedAt: now, count: 0 }
  }
  return bucket
}

function rememberFailure(key) {
  const bucket = readLoginBucket(key)
  bucket.count += 1
  loginAttempts.set(key, bucket)
  return bucket
}

function clearFailures(key) {
  loginAttempts.delete(key)
}

// 鉴权工具函数
export const AuthUtils = {
  // 生成简单的JWT token
  async generateToken(payload, secret) {
    const header = { alg: 'HS256', typ: 'JWT' }
    const encodedHeader = btoa(JSON.stringify(header))
    const encodedPayload = btoa(JSON.stringify(payload))
    const signature = await this.sign(`${encodedHeader}.${encodedPayload}`, secret)
    return `${encodedHeader}.${encodedPayload}.${signature}`
  },

  // 验证JWT token
  async verifyToken(token, secret) {
    try {
      const [header, payload, signature] = token.split('.')
      const expectedSignature = await this.sign(`${header}.${payload}`, secret)

      if (signature !== expectedSignature) {
        return null
      }

      const decodedPayload = JSON.parse(atob(payload))

      // 检查过期时间
      if (decodedPayload.exp && Date.now() > decodedPayload.exp) {
        return null
      }

      return decodedPayload
    } catch (error) {
      return null
    }
  },

  // 生成签名
  async sign(data, secret) {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
    return btoa(String.fromCharCode(...new Uint8Array(signature)))
  }
}

// 鉴权中间件
export const authMiddleware = async (c, next) => {
  const path = c.req.path
  if (isPublicAuthPath(path)) {
    return next()
  }

  let token = null
  const authHeader = c.req.header('Authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7)
  } else if (allowsQueryToken(path)) {
    token = c.req.query('token')
  }

  if (!token) {
    // 对于API请求返回401，对于页面请求重定向到登录页
    if (path.startsWith('/api/')) {
      return c.json({ success: false, message: '未授权访问' }, 401)
    }
    return c.redirect('/login.html')
  }

  const payload = await AuthUtils.verifyToken(token, c.env.JWT_SECRET)

  if (!payload) {
    // 对于API请求返回401，对于页面请求重定向到登录页
    if (path.startsWith('/api/')) {
      return c.json({ success: false, message: 'Token无效或已过期' }, 401)
    }
    return c.redirect('/login.html')
  }

  // 将用户信息添加到上下文
  c.set('user', payload)
  return next()
}

// 鉴权API路由
export const authRoutes = new Hono()

// 登录接口
authRoutes.post('/login', async (c) => {
  try {
    const key = clientKey(c)
    const bucket = readLoginBucket(key)
    if (bucket.count >= LOGIN_MAX_ATTEMPTS) {
      return c.json({ success: false, message: '登录尝试次数过多，请稍后再试' }, 429)
    }

    const { password } = await c.req.json()

    if (!password) {
      return c.json({ success: false, message: '密码不能为空' }, 400)
    }

    const expectedPassword = c.env.ACCESS_PASSWORD

    if (password !== expectedPassword) {
      rememberFailure(key)
      return c.json({ success: false, message: '密码错误' }, 401)
    }

    clearFailures(key)

    const expireHours = Number.parseInt(c.env.SESSION_EXPIRE_HOURS || '24', 10)
    if (!Number.isFinite(expireHours) || expireHours < 1 || expireHours > 720) {
      return c.json({ success: false, message: '会话时长配置无效' }, 500)
    }
    const payload = {
      iat: Date.now(),
      exp: Date.now() + (expireHours * 60 * 60 * 1000),
      type: 'access'
    }

    const token = await AuthUtils.generateToken(payload, c.env.JWT_SECRET)

    return c.json({
      success: true,
      token,
      expiresIn: expireHours * 60 * 60
    })
  } catch (error) {
    console.error('登录错误:', error)
    return c.json({ success: false, message: '服务器错误' }, 500)
  }
})

// 验证token接口
authRoutes.get('/verify', async (c) => {
  try {
    const authHeader = c.req.header('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ valid: false, message: '缺少认证信息' }, 401)
    }

    const token = authHeader.substring(7)
    const payload = await AuthUtils.verifyToken(token, c.env.JWT_SECRET)

    if (!payload) {
      return c.json({ valid: false, message: 'Token无效或已过期' }, 401)
    }

    return c.json({ valid: true, payload })
  } catch (error) {
    console.error('验证token错误:', error)
    return c.json({ valid: false, message: '服务器错误' }, 500)
  }
})

// 登出接口
authRoutes.post('/logout', async (c) => {
  // 简单的登出响应，实际的token清理在前端处理
  return c.json({ success: true, message: '已登出' })
})
