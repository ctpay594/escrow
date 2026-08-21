/** PM2 config for Hostinger VPS — restart before memory/hang kills the portal. */
module.exports = {
  apps: [
    {
      name: 'escrow-api',
      script: 'dist/main.js',
      cwd: '/var/www/escrow/apps/backend',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '400M',
      exp_backoff_restart_delay: 1000,
      kill_timeout: 10_000,
      listen_timeout: 10_000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
