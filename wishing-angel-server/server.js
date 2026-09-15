require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const store = require('./lib/store');
const { WISHES_PER_WALL, totalWalls, wallBounds } = require('./lib/wallConfig');
const AUSPICIOUS_DAYS = require('./lib/auspiciousDays');

const MIN_AMOUNT_CENTS = 100; // $1.00 floor, no ceiling

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';

const stripe = STRIPE_SECRET_KEY ? require('stripe')(STRIPE_SECRET_KEY) : null;

app.use(helmet({
  contentSecurityPolicy: false, // tighten this once you finalize which CDNs (fonts, Stripe.js) you use
}));
app.use(compression());
app.use(express.json({ limit: '20kb' }));

// Basic abuse protection on the endpoints that write data.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(503).json({ error: 'Admin access is not configured on this server yet. Set ADMIN_KEY.' });
  }
  const provided = req.get('x-admin-key');
  if (provided !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---------- public API ----------

app.get('/api/config', (req, res) => {
  res.json({
    wishesPerWall: WISHES_PER_WALL,
    minAmountCents: MIN_AMOUNT_CENTS,
    paymentMode: stripe ? 'stripe' : 'test',
    stripePublishableKey: stripe ? STRIPE_PUBLISHABLE_KEY : null,
  });
});

app.get('/api/auspicious-days', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = AUSPICIOUS_DAYS
    .filter((d) => d.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  res.json({ days: upcoming });
});

app.get('/api/counter', async (req, res) => {
  const count = await store.getCounter();
  res.json({ count });
});

app.get('/api/wall', async (req, res) => {
  const total = await store.getCounter();
  const walls = totalWalls(total);
  let page = parseInt(req.query.wall, 10);
  if (!Number.isFinite(page) || page < 1) page = walls;
  page = Math.min(page, walls);
  const { start, end } = wallBounds(page);

  const wishes = await store.listPaidWishesInRange(start, end);

  res.json({
    total,
    wallIndex: page,
    totalWalls: walls,
    start,
    end: Math.min(end, total || end),
    wishes,
  });
});

app.post('/api/wishes', writeLimiter, async (req, res) => {
  const { text, silent, privacy, ribbon, amountCents } = req.body || {};
  if (privacy !== 'private' && privacy !== 'public') {
    return res.status(400).json({ error: 'privacy must be "private" or "public"' });
  }
  if (!silent && (!text || !String(text).trim())) {
    return res.status(400).json({ error: 'A wish needs either text or the silent option.' });
  }
  const amount = parseInt(amountCents, 10);
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT_CENTS) {
    return res.status(400).json({ error: `The minimum wish is $${(MIN_AMOUNT_CENTS / 100).toFixed(2)}.` });
  }

  const wish = await store.createPendingWish({ text, silent: !!silent, privacy, ribbon, amountCents: amount });

  if (stripe) {
    try {
      const intent = await stripe.paymentIntents.create({
        amount: wish.amountCents,
        currency: 'usd',
        metadata: { wishId: wish.id },
        automatic_payment_methods: { enabled: true },
      });
      await store.attachPaymentIntent(wish.id, intent.id);
      return res.json({ id: wish.id, mode: 'stripe', clientSecret: intent.client_secret });
    } catch (e) {
      return res.status(502).json({ error: 'Could not start payment. Please try again.' });
    }
  }

  // Test mode: no Stripe keys configured, so nothing is actually charged.
  return res.json({ id: wish.id, mode: 'test' });
});

app.post('/api/wishes/:id/confirm', writeLimiter, async (req, res) => {
  const { id } = req.params;
  const wish = await store.getWishById(id);
  if (!wish) return res.status(404).json({ error: 'Wish not found' });

  if (stripe) {
    if (!wish.paymentIntentId) {
      return res.status(400).json({ error: 'No payment was started for this wish.' });
    }
    const intent = await stripe.paymentIntents.retrieve(wish.paymentIntentId);
    if (intent.status !== 'succeeded') {
      return res.status(402).json({ error: 'Payment has not completed yet.' });
    }
  }
  // In test mode (no Stripe configured) we confirm immediately, since there is
  // no real charge to verify. Do not run this branch in a real launch.

  const confirmed = await store.confirmWish(id);
  res.json({
    number: confirmed.number,
    ribbon: confirmed.ribbon,
    privacy: confirmed.privacy,
    silent: confirmed.silent,
    amountCents: confirmed.amountCents,
  });
});

// ---------- admin API (requires x-admin-key header) ----------

app.get('/api/admin/wishes', requireAdmin, async (req, res) => {
  const wishes = await store.listAllWishesAdmin();
  res.json({ wishes });
});

app.post('/api/admin/wishes/:id/hide', requireAdmin, async (req, res) => {
  const wish = await store.toggleHidden(req.params.id);
  res.json({ id: wish.id, hidden: wish.hidden });
});

// ---------- static frontend ----------

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
}));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function main() {
  try {
    await store.init();
    console.log('Database ready.');
  } catch (e) {
    console.error('Could not initialize the database:', e.message);
    console.error('Check that DATABASE_URL is set correctly in your environment.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`The Wishing Angel is listening on port ${PORT}`);
    console.log(`Payment mode: ${stripe ? 'stripe (live keys detected)' : 'test (no charges will occur)'}`);
    if (!ADMIN_KEY) {
      console.log('Note: ADMIN_KEY is not set, so the admin view is disabled until you set one.');
    }
  });
}

main();
