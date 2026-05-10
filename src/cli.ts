#!/usr/bin/env node
import { Command } from 'commander'
import { loadConfigFromDisk, loadEnv } from './config.js'
import { createSupabase } from './db/client.js'
import { runScan } from './commands/scan.js'
import { runResolve } from './commands/resolve.js'
import { runReport } from './commands/report.js'

const program = new Command()
program.name('edge').description('Daily player-prop parlay generator').version('0.2.0')

program
  .command('scan', { isDefault: true })
  .description("Build today's parlay, persist, and email")
  .option('--card-date <YYYY-MM-DD>', 'override card date (default: today ET)')
  .option('--force-rescan', 'overwrite existing parlay for the date')
  .option('--dry-run', 'compute but do not write or email')
  .action(async (opts: { cardDate?: string; forceRescan?: boolean; dryRun?: boolean }) => {
    try {
      const config = loadConfigFromDisk()
      const env = loadEnv()
      const supabase = createSupabase(env)
      await runScan({
        supabase, config, env,
        cardDate: opts.cardDate, forceRescan: opts.forceRescan, dryRun: opts.dryRun,
        print: (m) => process.stdout.write(m + '\n'),
      })
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })

program
  .command('resolve')
  .description('Grade pending parlays and apply streak transitions')
  .action(async () => {
    try {
      const config = loadConfigFromDisk()
      const env = loadEnv()
      const supabase = createSupabase(env)
      await runResolve({ supabase, config, env, print: (m) => process.stdout.write(m + '\n') })
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })

program
  .command('report')
  .description("Re-render and send today's parlay email")
  .option('--card-date <YYYY-MM-DD>', 'override card date')
  .option('--dry-run', 'render but do not send')
  .action(async (opts: { cardDate?: string; dryRun?: boolean }) => {
    try {
      const config = loadConfigFromDisk()
      const env = loadEnv()
      const supabase = createSupabase(env)
      await runReport({
        supabase, config, env,
        cardDate: opts.cardDate, dryRun: opts.dryRun,
        print: (m) => process.stdout.write(m + '\n'),
      })
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })

program.parseAsync(process.argv)
