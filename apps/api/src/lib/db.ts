/**
 * Database client setup for Supabase
 *
 * This module provides a singleton Supabase client instance with type-safe database schema.
 * PERMANENT - will be used for production database operations.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types.ts'

/**
 * Singleton Supabase client instance
 */
let supabaseClient: SupabaseClient<Database> | null = null

/**
 * Gets or creates the Supabase client instance with typed database schema
 *
 * Reads configuration from environment variables:
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_ANON_KEY: Supabase anonymous key
 *
 * @returns SupabaseClient instance with Database types
 * @throws Error if environment variables are not set
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (supabaseClient) {
    return supabaseClient
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Missing required environment variables: SUPABASE_URL and SUPABASE_ANON_KEY must be set',
    )
  }

  supabaseClient = createClient<Database>(supabaseUrl, supabaseKey)
  return supabaseClient
}
