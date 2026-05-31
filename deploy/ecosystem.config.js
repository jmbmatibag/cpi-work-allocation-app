'use strict';

/**
 * PM2 ecosystem config — CPI Work Allocation API
 *
 * Hardware: t3a.small — 2 vCPUs, 2 GB RAM (shared with Postgres + OS).
 *
 * Worker count: 1  (fork mode is not used — cluster mode with 1 instance
 * ─────────────    still gives PM2 crash recovery and zero-downtime restarts)
 *
 * Why not 2 workers on 2 vCPUs?
 *   t3a.small has only 2 GB RAM. Rough budget:
 *     OS + systemd + misc          ~300 MB
 *     Postgres (default settings)  ~400 MB  (shared_buffers 128 MB + overhead)
 *     1 Node.js worker (ceiling)   ~200 MB
 *     Page cache / buffer          ~1.1 GB  ← Postgres reads benefit heavily from this
 *   Two workers would consume up to 400 MB of that buffer, starving Postgres's
 *   page cache and causing it to hit disk far more often. One worker is the
 *   correct choice for this box size. Upgrade to t3a.medium to run 2 workers.
 *
 * Connection pool
 * ───────────────
 * 1 worker × DB_POOL_LIMIT=3 = 3 total Postgres connections.
 * This is intentionally conservative. Postgres on 2 GB RAM is already memory-
 * constrained; each connection costs ~5–10 MB of Postgres backend memory.
 * 3 connections is plenty for the app's workload (sequential CRUD, no fan-out).
 *
 * Memory ceiling
 * ──────────────
 * 200 MB per worker. If the process leaks past this limit, PM2 sends SIGINT
 * (graceful shutdown) then SIGKILL, restarting the worker. The app starts up
 * fast enough that this is effectively zero-downtime. The ceiling keeps a
 * leaking Node.js process from triggering the Linux OOM killer, which would
 * take down Postgres on the same box.
 *
 * Scheduler guard
 * ───────────────
 * index.ts checks NODE_APP_INSTANCE === '0' before starting cleanup/reminder
 * schedulers. This is a no-op with a single worker (instance 0 is always the
 * only worker) but keeps the guard in place for if you ever scale to 2+.
 *
 * Usage
 * ─────
 *   pm2 start deploy/ecosystem.config.js --env production
 *   pm2 save          # persist across reboots
 *   pm2 startup       # install systemd unit (run the printed command as root)
 *   pm2 logs cpi-api  # tail merged log stream
 */

module.exports = {
  apps: [
    {
      name: 'cpi-api',
      script: './dist/index.js',
      cwd: '/opt/cpi/cpi-work-allocation-app/cpi-work-allocation-api',

      // ── Single worker — correct for t3a.small with co-located Postgres ──────
      // Increase to 2 only after upgrading to t3a.medium or larger.
      instances: 1,
      exec_mode: 'cluster',

      // ── Memory ceiling ───────────────────────────────────────────────────────
      max_memory_restart: '200M',

      // ── Restart policy ───────────────────────────────────────────────────────
      max_restarts:  10,
      min_uptime:    '5s',
      restart_delay: 1000,

      // ── Logging ──────────────────────────────────────────────────────────────
      merge_logs:      true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file:      '/var/log/cpi/api-error.log',
      out_file:        '/var/log/cpi/api-out.log',

      // ── Environment ──────────────────────────────────────────────────────────
      // Secrets (DATABASE_URL, JWT_SECRET, CORS_ORIGIN, SMTP_*) stay in .env —
      // never hardcode them here.
      env_production: {
        NODE_ENV:        'production',
        PORT:            4000,
        DB_POOL_LIMIT:   '3',   // 1 worker × 3 = 3 total Postgres connections
        DB_POOL_TIMEOUT: '10',  // seconds to wait for a free connection
      },
    },
  ],
};
