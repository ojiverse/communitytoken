// Hono Context用の型定義

export type Env = {
  Variables: {
    userId?: string
    // 将来的にDBクライアントなどを追加
  }
}
