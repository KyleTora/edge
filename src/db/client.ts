import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Env } from '../config.js'

export type EdgeSupabase = SupabaseClient

export function createSupabase(env: Env): EdgeSupabase {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
