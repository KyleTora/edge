#!/usr/bin/env node
import { Command } from 'commander'
import { loadConfigFromDisk, loadEnv } from './config.js'
import { createSupabase } from './db/client.js'
import { runCard } from './commands/card.js'
import { runReport } from './commands/report.js'

const program = new Command()
program.name('edge').description('Personal +EV sports betting CLI').version('0.1.0')

program
  .command('card', { isDefault: true })
  .description('Generate today\'s top-5 daily card across all sports')
  .action(async () => {
    try {
      const config = loadConfigFromDisk()
      const env = loadEnv()
      const supabase = createSupabase(env)
      await runCard({
        supabase,
        config,
        env,
        print: (msg) => process.stdout.write(msg + '\n'),
      })
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })

program
  .command('report')
  .description('Run a scan and email the results via Resend')
  .option('--sports <list>', 'comma-separated sports list (overrides config.sports)')
  .option('--dry-run', 'render the email but do not send it; print to stdout instead')
  .action(async (opts: { sports?: string; dryRun?: boolean }) => {
    try {
      const config = loadConfigFromDisk()
      const env = loadEnv()
      const supabase = createSupabase(env)
      const sports = opts.sports ? opts.sports.split(',').map((s) => s.trim()) : config.sports
      const now = new Date()
      const runDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Toronto',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now)
      const runLabel = sports.length === 1 && sports[0] === 'mlb'
        ? '11am ET (MLB only)'
        : '4pm ET'

      const result = await runReport({
        supabase,
        config,
        env,
        sports,
        runLabel,
        runDate,
        dryRun: !!opts.dryRun,
        resendApiKey: process.env.RESEND_API_KEY,
        emailTo: process.env.REPORT_EMAIL_TO,
        emailFrom: process.env.REPORT_EMAIL_FROM,
      })

      if (opts.dryRun) {
        process.stdout.write(`SUBJECT: ${result.email.subject}\n\n`)
        process.stdout.write(`HTML:\n${result.email.html}\n\n`)
        process.stdout.write(`CSV:\n${result.email.csv}\n`)
      } else {
        process.stdout.write(`Sent email (${result.picks.length} picks). Resend id: ${result.resendId}\n`)
      }
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })

program
  .command('resolve')
  .description('Capture closing lines and/or grade finished picks')
  .option('--close', 'capture closing lines for picks whose games are starting')
  .option('--grade', 'grade picks whose games have finished')
  .action(async (opts: { close?: boolean; grade?: boolean }) => {
    try {
      const config = loadConfigFromDisk()
      const env = loadEnv()
      const supabase = createSupabase(env)
      const mode: 'close' | 'grade' | 'both' = opts.close && !opts.grade
        ? 'close'
        : opts.grade && !opts.close
        ? 'grade'
        : 'both'
      const { runResolve } = await import('./commands/resolve.js')
      await runResolve({
        supabase,
        config,
        env,
        mode,
        print: (msg) => process.stdout.write(msg + '\n'),
      })
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })

program
  .command('record')
  .description('Print paper-trade dashboard (P&L, hit rate, CLV)')
  .option('--since <date>', 'YYYY-MM-DD start of window')
  .option('--until <date>', 'YYYY-MM-DD end of window (default: today)')
  .option('--sport <key>', 'filter to one sport')
  .action(async (opts: { since?: string; until?: string; sport?: string }) => {
    try {
      const env = loadEnv()
      const supabase = createSupabase(env)
      const { runRecord } = await import('./commands/record.js')
      await runRecord({
        supabase,
        since: opts.since,
        until: opts.until,
        sport: opts.sport,
        print: (msg) => process.stdout.write(msg + '\n'),
      })
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })

program
  .command('recap')
  .description('Email a recap of recently settled picks and rolling 7d/30d/all-time totals')
  .action(async () => {
    try {
      const env = loadEnv()
      const supabase = createSupabase(env)
      const resendApiKey = process.env.RESEND_API_KEY
      const emailTo = process.env.REPORT_EMAIL_TO
      const emailFrom = process.env.REPORT_EMAIL_FROM
      if (!resendApiKey || !emailTo || !emailFrom) {
        throw new Error(
          'RESEND_API_KEY, REPORT_EMAIL_TO, and REPORT_EMAIL_FROM are required for `edge recap`'
        )
      }
      const { runRecap } = await import('./commands/recap.js')
      const result = await runRecap({
        supabase,
        resendApiKey,
        emailFrom,
        emailTo,
      })
      if (result.sent) {
        process.stdout.write(
          `Sent recap (${result.settledCount} settled, ${result.metrics7d.units >= 0 ? '+' : ''}${result.metrics7d.units.toFixed(2)}u 7d). Resend id: ${result.resendId}\n`
        )
      } else {
        process.stdout.write(`recap: ${result.reason}, skipping email\n`)
      }
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`)
      process.exit(1)
    }
  })

program.parseAsync(process.argv)
