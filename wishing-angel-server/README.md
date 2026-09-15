# The Wishing Angel, server edition

A real, runnable backend for the wish flow: atomic sequential wish numbers,
a Postgres data layer, variable wish amounts, an optional fee-coverage
toggle, an auspicious-days feature, and a Stripe payment integration that
runs safely in test mode until you add real keys.

## First, a correction on hosting

WordPress, Wix, Google Sites, and most of Hostinger's plans are website
*builders*. They're built for pages made of text, images, and pre-made
blocks, not for running a custom backend process that talks to a database
and a payment processor. There's no free or paid tier of any of those four
where this app could run as-is. What you actually need is:

1. Somewhere to run a Node.js process (this app)
2. A Postgres database for it to talk to
3. A domain (optional at first, both hosts below give you a free one)

GitHub fits in here too, just not as a host: it's where your code lives and
where the hosting platform pulls from, not where the app runs.

## The free stack this app is built for

- **Render** (render.com), free web service tier, to run this Node app
- **Neon** (neon.tech), free Postgres tier, to store wishes
- **Stripe**, test mode to start, real keys when you're ready to charge
- **GitHub**, to hold the code so Render can deploy from it

This combination is genuinely free to start, no credit card required for
either Render or Neon. The trade-offs: Render's free web service spins down
after 15 minutes of no traffic (the first visitor after a quiet spell waits
about a minute for it to wake up), and Neon's free compute scales to zero
after 5 minutes idle (it wakes in under a second on the next request). For
an MVP you're testing with real users, both are fine. Neither is a reason
to pay yet.

## Step by step

### 1. Put the code on GitHub

```bash
cd wishing-angel-server
git init
git add .
git commit -m "Initial commit"
```

Create a new repository on github.com, then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/wishing-angel.git
git branch -M main
git push -u origin main
```

### 2. Create the free database on Neon

1. Go to neon.tech, sign up (no credit card needed).
2. Create a new project. Any name and region is fine.
3. Copy the connection string it gives you. It looks like:
   `postgresql://user:password@ep-xxxx.neon.tech/neondb?sslmode=require`
4. Keep this open, you'll paste it into Render in the next step.

### 3. Deploy the app on Render

1. Go to render.com, sign up, and connect your GitHub account.
2. Click "New +" then "Web Service", and pick your `wishing-angel` repo.
3. Set:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Under "Environment", add these variables (from `.env.example`):
   - `DATABASE_URL` — paste the Neon connection string from step 2
   - `ADMIN_KEY` — any long random string (generate one with
     `node -e "console.log(require('crypto').randomUUID())"`)
   - `WISHES_PER_WALL` — `500` (or leave unset, that's the default)
   - Leave `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` blank for now,
     the app runs in safe test mode without them
5. Click "Create Web Service". Render will build and deploy. You'll get a
   URL like `https://wishing-angel.onrender.com`.
6. Open it. You should see the homepage, and be able to make a test wish
   (no real charge, since Stripe isn't configured yet).

Your MVP is now live at a public URL. This is a good point to test the
whole flow yourself before inviting anyone else.

### 4. Turn on real payments

1. Create a Stripe account at stripe.com if you don't have one.
2. In the Stripe dashboard, grab your **test** keys first
   (`sk_test_...` and `pk_test_...`) and add them to Render's environment
   variables as `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`. Redeploy.
3. Test a real payment flow with Stripe's test card `4242 4242 4242 4242`,
   any future expiry, any CVC.
4. When you're satisfied, switch to your **live** keys
   (`sk_live_...` / `pk_live_...`) in the same environment variables.
   That's the only change needed to go from test to real charges.

### 5. Point a real domain at it (optional)

Render's free tier includes a subdomain (`yourapp.onrender.com`) with
HTTPS already set up. If you want your own domain, Render's dashboard has
a "Custom Domains" tab that walks you through adding a CNAME record at
whichever registrar you bought the domain from (that could be Hostinger,
Namecheap, GoDaddy, wherever, the registrar doesn't need to be the host).

## Making a $1 minimum actually make economic sense

At a flat $1, Stripe's standard fee (2.9% + $0.30) takes about 33% of the
transaction. That's real and worth solving for directly, not something a
clever setting fixes on its own. Here's what actually moves the number,
all of which is already built into this app:

**1. Variable amounts, not a fixed $1.** The app now lets people choose
$1, $3, $5, $10, or any custom amount at or above $1. The fee's fixed
$0.30 component matters far less as the amount grows:

| Amount | Stripe fee | Effective rate |
|---|---|---|
| $1.00 | $0.33 | 32.9% |
| $3.00 | $0.39 | 12.9% |
| $5.00 | $0.45 | 8.9% |
| $10.00 | $0.59 | 5.9% |

The payment step defaults to a $3 preset (people can still tap $1), which
alone meaningfully improves your average economics without hiding the
$1 option or making anyone feel pressured.

**2. An optional "cover the fee" toggle.** Also built in: a checkbox at
checkout that adds the exact fee amount on top, so if someone chooses to
check it, you net the full amount they intended rather than losing the cut
to Stripe. This is a standard, transparent pattern (the same one donation
platforms use), not a dark pattern, since it's off by default and clearly
labeled with the real dollar amount before they agree to it.

**3. Consider applying for PayPal Micropayments as a second option.**
PayPal's micropayments rate is roughly 5% + $0.05-0.09 (you must apply for
approval through PayPal, and the exact fixed fee varies slightly by
source, check your dashboard once approved). That's worse than Stripe
above roughly $10, but better than Stripe's standard rate below it, which
is exactly your $1-10 range. This isn't implemented in the app yet (it
would mean adding a second payment path alongside Stripe), but it's worth
applying for in parallel while you test with Stripe, since approval can
take a few business days.

**4. The uncomfortable but honest option: accept thin or negative margins
on the $1 tier as a cost of acquisition.** Plenty of businesses treat a
low-friction, low-price entry point as the thing that gets someone in the
door, with better-margin amounts ($5, $10) carrying the actual revenue.
If most people choose $3+ once given the choice (which the preset buttons
are designed to nudge, gently, toward), the blended economics across all
wishes will look better than the $1 case in isolation.

## The auspicious days feature

`lib/auspiciousDays.js` holds a simple list of dates, titles, and reasons.
Edit that one file to add, remove, or change dates, nothing else needs to
change. The list currently has real 2026 dates (actual full moons, the
winter solstice, New Year's Day) as placeholders, swap them for whatever
dates and traditions actually matter to your audience before a real
launch.

The homepage shows the next several upcoming dates. The confirmation
screen after someone makes a wish reminds them of the very next one, as a
soft nudge to come back.

## What's still on you before a real public launch

- **Legal review** of the disclaimer language and the ritual-for-money
  framing generally, state rules vary and a lawyer should look at your
  specific setup.
- **Monitoring.** Render and Neon both have basic dashboards; keep an eye
  on them, especially in the first days of real traffic.
- **A decision on PayPal Micropayments**, if you want to pursue the
  cheaper rate for small transactions (see above).

## Project layout

```
server.js               Express app and API routes
lib/store.js              Postgres data layer, atomic wish numbering
lib/db.js                   Connection pool
lib/wallConfig.js             Shared "wishes per wall" sizing logic
lib/auspiciousDays.js           Editable list of auspicious dates
public/index.html                Static shell
public/app.js                      Client logic (fetches the API, drives the UI)
public/styles.css                    All styling
.env.example                           Copy to .env locally, or set the same
                                          variables in Render's dashboard
```

## Running it locally

```bash
npm install
cp .env.example .env
# fill in DATABASE_URL with a Neon connection string (or any Postgres you have)
npm start
```

Visit `http://localhost:3000`.
