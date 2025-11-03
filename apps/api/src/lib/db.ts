/**
 * Database client setup for Supabase
 *
 * This module provides a singleton Supabase client instance.
 * PERMANENT - will be used for production database operations.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Singleton Supabase client instance
 */
let supabaseClient: SupabaseClient | null = null

/**
 * Gets or creates the Supabase client instance
 *
 * Reads configuration from environment variables:
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_ANON_KEY: Supabase anonymous key
 *
 * @returns SupabaseClient instance
 * @throws Error if environment variables are not set
 */
export function getSupabaseClient(): SupabaseClient {
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

  supabaseClient = createClient(supabaseUrl, supabaseKey)
  return supabaseClient
}
