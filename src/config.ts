import { z } from 'zod'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'

export const ConfigSchema = z.object({
  books: z.array(z.string()).min(1),
  manual_books: z.array(z.string()),
  sharp_anchor: z.literal('pinnacle'),
  daily_picks: z.number().int().positive().default(5),
  sports: z.array(z.string()).min(1),
  bankroll_units: z.number().positive(),
  unit_size_cad: z.number().positive(),
  closing_line_capture_minutes_before_game: z.number().int().positive(),
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
  // Look for .env in the edge installation directory first (so the binary
  // works from any cwd), then fall back to dotenv's default cwd lookup.
  const dotenvPath = resolve(resolveEdgeHome(), '.env')
  if (existsSync(dotenvPath)) {
    loadDotenv({ path: dotenvPath })
  } else {
    loadDotenv()
  }
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

/**
 * The edge installation root — directory containing package.json, .env, and
 * edge.config.json. Resolution order:
 *   1. EDGE_HOME env var (used by GitHub Actions to point at $GITHUB_WORKSPACE)
 *   2. Walk up from this module's location to find package.json. Works whether
 *      the binary runs from src/ via tsx or from dist/src/ after `npm run build`.
 *   3. Fall back to process.cwd() (legacy behavior).
 */
export function resolveEdgeHome(): string {
  if (process.env.EDGE_HOME) return process.env.EDGE_HOME
  try {
    let dir = dirname(fileURLToPath(import.meta.url))
    for (let i = 0; i < 5; i++) {
      if (existsSync(resolve(dir, 'package.json'))) return dir
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {
    // import.meta.url unavailable in some environments — fall through
  }
  return process.cwd()
}

export function loadConfigFromDisk(path = 'edge.config.json'): Config {
  const absolute = resolve(resolveEdgeHome(), path)
  const raw = JSON.parse(readFileSync(absolute, 'utf8'))
  return parseConfig(raw)
}
