import { Hono } from 'hono'
import { users } from './routes/users.ts'
import type { Env } from './lib/types.ts'

export function createApp() {
  const app = new Hono<Env>()

  // Debug: log all requests
  app.use('*', async (c, next) => {
    console.log('Request:', c.req.method, c.req.url)
    await next()
  })

  // Health check
  app.get('/health', (c) => {
    return c.json({ status: 'ok' })
  })

  // API v1 routes
  app.route('/v1/users', users)

  // Debug: catch-all for unmatched routes
  app.all('*', (c) => {
    return c.json({ error: 'Not Found', path: c.req.path }, 404)
  })

  return app
}
