#!/usr/bin/env node
import { Command } from 'commander'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadConfigFromDisk, loadEnv, resolveEdgeHome } from './config.js'
import { applySchema } from './db/schema.js'
import { runScan } from './commands/scan.js'
import { runReport } from './commands/report.js'

const program = new Command()
program.name('edge').description('Personal +EV sports betting CLI').version('0.1.0')

program
  .command('scan', { isDefault: true })
  .description('Fetch odds, devig sharp anchor, print +EV picks')
  .action(async () => {
    try {
      const config = loadConfigFromDisk()
      const env = loadEnv()
      const dbPath = resolve(resolveEdgeHome(), 'data/edge.db')
      mkdirSync(dirname(dbPath), { recursive: true })
      const db = new Database(dbPath)
      applySchema(db)
      await runScan({
        db,
        config,
        env,
        print: (msg) => process.stdout.write(msg + '\n'),
      })
      db.close()
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

program.parseAsync(process.argv)
