export function isPublicAuthPath(path) {
  return path === '/api/auth/login' || path.startsWith('/login.html')
}

export function allowsQueryToken(path) {
  return path === '/api/events'
}
