// Real, concurrency-safe data layer backed by Postgres.
//
// Sequential numbering is handled by a Postgres SEQUENCE, so two servers
// or two simultaneous requests can never be handed the same wish number.
// That's a guarantee the earlier JSON-file version could only give you
// within a single process; this version holds even if you later run more
// than one server instance behind a load balancer.

const pool = require('./db');

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wishes (
      id UUID PRIMARY KEY,
      number INTEGER UNIQUE,
      text TEXT,
      silent BOOLEAN NOT NULL DEFAULT false,
      privacy TEXT NOT NULL,
      ribbon TEXT NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 100,
      hidden BOOLEAN NOT NULL DEFAULT false,
      payment_status TEXT NOT NULL DEFAULT 'pending',
      payment_intent_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      confirmed_at TIMESTAMPTZ
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS wishes_number_idx ON wishes (number);`);
  await pool.query(`CREATE SEQUENCE IF NOT EXISTS wish_number_seq;`);
}

function row(r) {
  if (!r) return null;
  return {
    id: r.id,
    number: r.number,
    text: r.text,
    silent: r.silent,
    privacy: r.privacy,
    ribbon: r.ribbon,
    amountCents: r.amount_cents,
    hidden: r.hidden,
    paymentStatus: r.payment_status,
    paymentIntentId: r.payment_intent_id,
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
  };
}

function publicShape(w) {
  const sealed = w.privacy === 'private' || w.silent || w.hidden;
  return {
    id: w.id,
    number: w.number,
    ribbon: w.ribbon,
    privacy: w.privacy,
    silent: w.silent,
    hidden: !!w.hidden,
    text: sealed ? undefined : w.text,
  };
}

async function getCounter() {
  const res = await pool.query(
    `SELECT number FROM wishes WHERE payment_status = 'paid' ORDER BY number DESC LIMIT 1;`
  );
  return res.rows[0] ? res.rows[0].number : 0;
}

async function createPendingWish({ text, silent, privacy, ribbon, amountCents }) {
  const id = require('crypto').randomUUID();
  const cleanText = silent ? '' : String(text || '').slice(0, 1000);
  const cleanPrivacy = privacy === 'public' ? 'public' : 'private';
  const cleanRibbon = ribbon || 'gold';
  const cleanAmount = Number.isFinite(amountCents) ? Math.max(100, Math.round(amountCents)) : 100;

  const res = await pool.query(
    `INSERT INTO wishes (id, text, silent, privacy, ribbon, amount_cents, payment_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING *;`,
    [id, cleanText, !!silent, cleanPrivacy, cleanRibbon, cleanAmount]
  );
  return row(res.rows[0]);
}

async function attachPaymentIntent(id, paymentIntentId) {
  const res = await pool.query(
    `UPDATE wishes SET payment_intent_id = $2 WHERE id = $1 RETURNING *;`,
    [id, paymentIntentId]
  );
  if (!res.rows[0]) throw new Error('wish not found');
  return row(res.rows[0]);
}

// Idempotent: if the wish is already paid, just returns it unchanged, so a
// retried confirmation (e.g. a webhook firing twice) can never double count.
async function confirmWish(id) {
  const already = await pool.query(`SELECT * FROM wishes WHERE id = $1;`, [id]);
  if (!already.rows[0]) throw new Error('wish not found');
  if (already.rows[0].payment_status === 'paid') return row(already.rows[0]);

  const res = await pool.query(
    `UPDATE wishes
     SET number = nextval('wish_number_seq'),
         payment_status = 'paid',
         confirmed_at = now()
     WHERE id = $1 AND payment_status != 'paid'
     RETURNING *;`,
    [id]
  );
  return row(res.rows[0]);
}

async function getWishById(id) {
  const res = await pool.query(`SELECT * FROM wishes WHERE id = $1;`, [id]);
  return row(res.rows[0]);
}

async function listPaidWishesInRange(start, end) {
  const res = await pool.query(
    `SELECT * FROM wishes WHERE payment_status = 'paid' AND number BETWEEN $1 AND $2 ORDER BY number ASC;`,
    [start, end]
  );
  return res.rows.map(row).map(publicShape);
}

async function listAllWishesAdmin() {
  const res = await pool.query(
    `SELECT * FROM wishes WHERE payment_status = 'paid' ORDER BY number ASC;`
  );
  return res.rows.map(row);
}

async function toggleHidden(id) {
  const res = await pool.query(
    `UPDATE wishes SET hidden = NOT hidden WHERE id = $1 RETURNING *;`,
    [id]
  );
  if (!res.rows[0]) throw new Error('wish not found');
  return row(res.rows[0]);
}

module.exports = {
  init,
  getCounter,
  createPendingWish,
  attachPaymentIntent,
  confirmWish,
  getWishById,
  listPaidWishesInRange,
  listAllWishesAdmin,
  toggleHidden,
  publicShape,
};
