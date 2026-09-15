const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn(
    'DATABASE_URL is not set. The app will fail to start once lib/store.js ' +
    'tries to connect. Get a free connection string from neon.tech or ' +
    'supabase.com and put it in your .env file.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Most free hosted Postgres providers (Neon, Supabase, Render) require SSL
  // and use certificates that Node's default chain doesn't recognize.
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=disable')
    ? false
    : { rejectUnauthorized: false },
});

module.exports = pool;
