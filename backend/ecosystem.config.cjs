/**
 * PM2 ecosystem for ringtable.io production.
 * Deploy workflow also sets these env vars; this file is a fallback for manual restarts:
 *   cd backend && npx pm2 start ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: "ringtable-api",
      script: "src/index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      env: {
        APP_ENV: "production",
        RINGTABLE_DEPLOYMENT: "1",
        PORT: process.env.PORT || "5059",
        NODE_ENV: "production",
      },
    },
  ],
};
