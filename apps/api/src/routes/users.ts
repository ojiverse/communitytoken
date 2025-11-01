import { Hono } from 'hono'
import type { Env } from '../lib/types.ts'

const users = new Hono<Env>()

// GET /v1/users/@me
users.get('/@me', (c) => {
  return c.json({
    id: 'mock-user-id',
    username: 'mock-user',
  })
})

// GET /v1/users/@me/wallet
users.get('/@me/wallet', (c) => {
  return c.json({
    id: 'mock-wallet-id',
    balance: 0,
  })
})

export { users }
