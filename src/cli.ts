#!/usr/bin/env node
import { Command } from 'commander'
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadConfigFromDisk, loadEnv } from './config.js'
import { applySchema } from './db/schema.js'
import { runScan } from './commands/scan.js'

const program = new Command()
program.name('edge').description('Personal +EV sports betting CLI').version('0.1.0')

program
  .command('scan', { isDefault: true })
  .description('Fetch odds, devig sharp anchor, print +EV picks')
  .action(async () => {
    try {
      const config = loadConfigFromDisk()
      const env = loadEnv()
      const dbPath = resolve(process.cwd(), 'data/edge.db')
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

program.parseAsync(process.argv)
