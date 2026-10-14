import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const execute = promisify(execFile)
const binaries = [
  process.env.BADEM_TEST_POSTGRES_BIN,
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/18/bin',
].find((dir) => dir && ['initdb', 'pg_ctl', 'psql'].every((name) => existsSync(join(dir, name))))

test(
  'persistent SQL quota is atomic, isolated by user/UTC day and unavailable to browser roles',
  {
    skip:
      !binaries || process.getuid?.() === 0
        ? 'Install PostgreSQL binaries and run as a non-root user; see docs/private-beta.md.'
        : false,
    timeout: 60000,
  },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'badem-beta-pg-'))
    const data = join(directory, 'data')
    const socket = join(directory, 'socket')
    mkdirSync(socket)
    let started = false
    const run = (name, args) =>
      execute(join(binaries, name), args, { timeout: 20000, maxBuffer: 1024 * 1024 })
    const sql = async (query) =>
      (
        await run('psql', [
          '-h',
          socket,
          '-p',
          '6543',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '-X',
          '-A',
          '-t',
          '-q',
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          query,
        ])
      ).stdout.trim()
    const start = async () => {
      await run('pg_ctl', [
        '-D',
        data,
        '-l',
        join(directory, 'postgres.log'),
        '-o',
        `-k ${socket} -p 6543 -c listen_addresses=''`,
        '-w',
        'start',
      ])
      started = true
    }
    const first = '7d210ad9-3c1e-4b65-af95-a749924b39f0'
    const second = 'b07127c3-7a8e-44da-b43f-a5fdd2b83d21'
    const consume = (user) =>
      sql(`set role service_role; select public.consume_badem_discovery('${user}');`)
    try {
      await run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--no-locale'])
      await start()
      await sql(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users (id uuid primary key);
      insert into auth.users values ('${first}'), ('${second}');`)
      const migration = fileURLToPath(new URL('../supabase/private-beta.sql', import.meta.url))
      await run('psql', [
        '-h',
        socket,
        '-p',
        '6543',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-X',
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        migration,
      ])
      // Separate database connections race the actual ON CONFLICT update, not a JS counter.
      const outcomes = await Promise.all(Array.from({ length: 24 }, () => consume(first)))
      assert.equal(outcomes.filter((value) => value === 't').length, 3)
      assert.equal(outcomes.filter((value) => value === 'f').length, 21)
      assert.equal(
        await sql(
          `select discoveries from badem_beta_private.discovery_usage where user_id = '${first}';`,
        ),
        '3',
      )
      assert.equal(await consume(second), 't')
      assert.equal(
        await sql(
          `select discoveries from badem_beta_private.discovery_usage where user_id = '${second}';`,
        ),
        '1',
      )
      await sql(
        `insert into badem_beta_private.discovery_usage values ('${second}', (now() at time zone 'UTC')::date - 1, 3);`,
      )
      assert.equal(await consume(second), 't', 'yesterday does not count toward today')
      assert.equal(
        await sql(`set time zone 'Pacific/Kiritimati'; set role service_role;
      select public.consume_badem_discovery('${second}');`),
        't',
      )
      assert.equal(
        await sql(`select count(*) from badem_beta_private.discovery_usage
      where user_id = '${second}' and usage_day = (now() at time zone 'UTC')::date and discoveries = 3;`),
        '1',
      )
      for (const role of ['anon', 'authenticated']) {
        await assert.rejects(
          sql(`set role ${role}; select public.consume_badem_discovery('${first}');`),
          /permission denied for function/,
        )
        await assert.rejects(
          sql(`set role ${role}; select * from badem_beta_private.discovery_usage;`),
          /permission denied/,
        )
        await assert.rejects(
          sql(`set role ${role}; delete from badem_beta_private.discovery_usage;`),
          /permission denied/,
        )
      }
      assert.equal(
        await sql(
          `select relrowsecurity from pg_class where oid = 'badem_beta_private.discovery_usage'::regclass;`,
        ),
        't',
      )
      await run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'])
      started = false
      await start()
      assert.equal(await consume(first), 'f', 'server restart cannot reset the persistent limit')
    } finally {
      try {
        if (started) await run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'])
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    }
  },
)
