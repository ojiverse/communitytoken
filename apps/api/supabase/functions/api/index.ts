import { createApp } from '../../../src/app.ts'

// Create Hono app
const app = createApp()

// Edge Functions passes /functions/v1/api/* as /api/*,
// so we need to strip the /api prefix before routing
const handler = (req: Request) => {
  // Remove /api prefix for routing
  const url = new URL(req.url)
  url.pathname = url.pathname.replace(/^\/api/, '') || '/'
  return app.fetch(new Request(url, req))
}

// Start with Deno.serve
Deno.serve(handler)
