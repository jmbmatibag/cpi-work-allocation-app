// Captured once at module load — i.e., exactly when this server process
// started. Used by the auth middleware to reject any JWT whose iat predates
// this moment, ensuring that tokens from a previous server run (yesterday's
// sessions) are mathematically dead after a nightly restart.
export const SERVER_BOOT_TIME = Math.floor(Date.now() / 1000);
