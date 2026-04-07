import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadDotenv } from 'dotenv'

export const ConfigSchema = z.object({
  books: z.array(z.string()).min(1),
  manual_books: z.array(z.string()),
  sharp_anchor: z.literal('pinnacle'),
  ev_threshold: z.number().min(0).max(1),
  max_sharp_implied_prob: z.number().min(0).max(1),
  sports: z.array(z.string()).min(1),
  bankroll_units: z.number().positive(),
  unit_size_cad: z.number().positive(),
  watch_interval_minutes: z.number().int().positive(),
  closing_line_capture_minutes_before_game: z.number().int().positive(),
  stale_sharp_max_age_minutes: z.number().int().positive(),
})

export type Config = z.infer<typeof ConfigSchema>

export function parseConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw)
}

export interface Env {
  ODDS_API_KEY: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
}

export function loadEnv(): Env {
  loadDotenv()
  const oddsKey = process.env.ODDS_API_KEY
  if (!oddsKey) throw new Error('ODDS_API_KEY missing from .env')
  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl) throw new Error('SUPABASE_URL missing from .env')
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing from .env')
  return {
    ODDS_API_KEY: oddsKey,
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: supabaseKey,
  }
}

export function resolveEdgeHome(): string {
  return process.env.EDGE_HOME ?? process.cwd()
}

export function loadConfigFromDisk(path = 'edge.config.json'): Config {
  const absolute = resolve(resolveEdgeHome(), path)
  const raw = JSON.parse(readFileSync(absolute, 'utf8'))
  return parseConfig(raw)
}
