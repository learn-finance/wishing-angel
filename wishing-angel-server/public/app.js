(function () {
  const RIBBON_COLORS = [
    { key: 'gold', label: 'Gold', hex: '#c9a15a' },
    { key: 'purple', label: 'Purple', hex: '#8a6bc2' },
    { key: 'pink', label: 'Pink', hex: '#d98fa3' },
    { key: 'blue', label: 'Blue', hex: '#6f93c9' },
    { key: 'white', label: 'White', hex: '#e9e4d8' },
    { key: 'red', label: 'Red', hex: '#c25b5b' },
    { key: 'green', label: 'Green', hex: '#7ba07e' },
  ];
  const DEFAULT_RIBBON = 'gold';

  const AFFIRMATIONS = [
    "You are allowed to hope for good things.",
    "A wish spoken or a wish kept silent, both are still wishes that matter.",
    "This wall holds quiet hopes from people you'll never meet, all the same as you.",
    "Wishing isn't naive. It's just being honest about what you want.",
    "Whatever you're carrying, you don't have to hold all of it alone.",
    "Every ribbon here began with someone pausing, just for a moment, for themselves.",
  ];

  let config = { wishesPerWall: 500, paymentMode: 'test', stripePublishableKey: null };
  let stripeInstance = null;
  let cardElement = null;

  let state = {
    view: 'home',
    counter: null,
    counterError: false,
    draft: { text: '', silent: false, privacy: null, ribbon: DEFAULT_RIBBON, amountCents: 300, customAmount: false, coverFee: false },
    auspiciousDays: [],
    activeWishId: null,
    clientSecret: null,
    lastWish: null,
    wallData: null,
    wallLoading: false,
    wallPage: null,
    submitting: false,
    submitError: null,
    admin: { key: '', authed: false, wishes: [], loading: false, error: null },
  };

  let affirmIdx = 0;
  let affirmTimer = null;

  function render() {
    const app = document.getElementById('app');
    app.className = 'wrap' + (state.view === 'wall' ? ' wide' : '');
    app.innerHTML = topNav() + body();
    wireEvents();
  }

  function topNav() {
    return `
      <div class="top-nav">
        <div class="brand-mark" data-nav="home" style="cursor:pointer;">The Wishing Angel</div>
        <div class="top-link" data-nav="${state.view === 'wall' ? 'home' : 'wall'}">${state.view === 'wall' ? 'Home' : 'Wish Wall'}</div>
      </div>
    `;
  }

  function angelMotif() {
    return `
      <div class="glow-stage">
        <div class="motif">
          <svg viewBox="0 0 120 120" fill="none">
            <circle cx="60" cy="30" r="14" stroke="#c9a15a" stroke-width="1.2" opacity="0.85"/>
            <path d="M60 44 C 30 55, 14 78, 10 108" stroke="#c9a15a" stroke-width="1.2" fill="none" opacity="0.6"/>
            <path d="M60 44 C 90 55, 106 78, 110 108" stroke="#c9a15a" stroke-width="1.2" fill="none" opacity="0.6"/>
            <path d="M60 46 C 42 58, 34 72, 32 96" stroke="#8a6bc2" stroke-width="1" fill="none" opacity="0.55"/>
            <path d="M60 46 C 78 58, 86 72, 88 96" stroke="#8a6bc2" stroke-width="1" fill="none" opacity="0.55"/>
            <line x1="60" y1="46" x2="60" y2="112" stroke="#f2ede3" stroke-width="0.8" opacity="0.35"/>
          </svg>
        </div>
      </div>
    `;
  }

  function sparkleField() {
    const positions = [[8,10],[22,4],[38,14],[55,6],[70,12],[86,5],[15,20],[92,18],[48,2],[65,20]];
    return `<div class="sparkle-field">${positions.map((p, i) => `
      <div class="sparkle" style="left:${p[0]}%; top:${p[1]}px; width:${3+(i%3)}px; height:${3+(i%3)}px; animation-delay:${(i*0.4).toFixed(1)}s;"></div>
    `).join('')}</div>`;
  }

  function formatNumber(n) { return Number(n).toLocaleString('en-US'); }
  function formatCompact(n) {
    if (n < 10000) return formatNumber(n);
    return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  }
  function escapeHtml(s) {
    const d = document.createElement('div');
    d.innerText = s;
    return d.innerHTML;
  }

  function footerHtml() {
    return `
      <footer>
        <div class="disc">The Wishing Angel provides a symbolic wishing experience. We do not guarantee that wishes will come true.</div>
        <div class="links">
          <span data-nav="wall">Wish Wall</span>
          <span data-nav="admin">Angel Keeper</span>
        </div>
      </footer>
    `;
  }

  function body() {
    switch (state.view) {
      case 'home': return homeView();
      case 'wish-text': return stepTextView();
      case 'wish-privacy': return stepPrivacyView();
      case 'wish-ribbon': return stepRibbonView();
      case 'wish-payment': return stepPaymentView();
      case 'confirmation': return confirmationView();
      case 'wall': return wallView();
      case 'admin': return adminView();
      default: return homeView();
    }
  }

  function formatDayParts(dateStr) {
    // dateStr is YYYY-MM-DD; parse as UTC to avoid local-timezone off-by-one.
    const d = new Date(dateStr + 'T00:00:00Z');
    const day = d.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'UTC' });
    const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
    return { day, month };
  }

  function auspiciousListHtml() {
    if (!state.auspiciousDays || state.auspiciousDays.length === 0) {
      return `<div class="wish-list-empty">No dates listed right now.</div>`;
    }
    return `<div class="auspicious-list">` + state.auspiciousDays.slice(0, 6).map(dday => {
      const { day, month } = formatDayParts(dday.date);
      return `
        <div class="auspicious-item">
          <div class="datebox"><div class="d">${day}</div><div class="m">${month}</div></div>
          <div>
            <div class="title">${escapeHtml(dday.title)}</div>
            <div class="reason">${escapeHtml(dday.reason)}</div>
          </div>
        </div>
      `;
    }).join('') + `</div>`;
  }

  function homeView() {
    return `
      ${angelMotif()}
      <h1 class="headline">The Wishing Angel</h1>
      <p class="sub">A quiet place where every wish begins to take shape.</p>
      <p class="lede">Some wishes are spoken. Some are whispered.</p>
      <div class="btn-row" style="margin-top:36px;">
        <button class="btn btn-primary" data-nav="wish-text">Make a wish · $1</button>
        <button class="btn btn-ghost" data-nav="wall">See the wish wall</button>
      </div>
      <div class="counter-card">
        ${state.counter === null && !state.counterError ? `<div class="loading-line">Loading count…</div>` :
          state.counterError ? `<div class="counter-num">-</div><div class="counter-label">Wishes made, unavailable right now</div>` :
          `<div class="counter-num">${state.counter.toLocaleString()}</div><div class="counter-label">Wishes made</div>`}
      </div>

      <div class="auspicious-section">
        <h3>Auspicious days to wish</h3>
        <p class="sub" style="font-size:14px;">Some days are said to carry a little more weight.</p>
        ${auspiciousListHtml()}
      </div>

      ${footerHtml()}
    `;
  }

  function stepTextView() {
    const d = state.draft;
    return `
      <div class="step active">
        <div class="step-head">
          <div class="step-title">Make Your Wish</div>
          <div class="step-sub">You don't have to tell anyone. Just leave it with the Angel.</div>
        </div>
        <textarea id="wishText" placeholder="Write your wish here…" ${d.silent ? 'disabled' : ''}>${d.text}</textarea>
        <div class="silent-toggle ${d.silent ? 'checked' : ''}" id="silentToggle">
          <div class="box"></div>
          <span>Prefer to keep your wish in your heart? Leave it silently.</span>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="toPrivacy">Continue</button>
          <button class="btn btn-ghost" data-nav="home">Back</button>
        </div>
      </div>
    `;
  }

  function stepPrivacyView() {
    const d = state.draft;
    return `
      <div class="step active">
        <div class="step-head">
          <div class="step-title">Private or Public</div>
          <div class="step-sub">You control whether your wish is shared.</div>
        </div>
        <div class="choice-grid">
          <div class="choice-card private ${d.privacy === 'private' ? 'selected' : ''}" data-privacy="private">
            <span class="ico">🔒</span>
            <div class="name">Private</div>
            <div class="desc">Your wish will not be displayed publicly.</div>
          </div>
          <div class="choice-card public ${d.privacy === 'public' ? 'selected' : ''}" data-privacy="public">
            <span class="ico">💫</span>
            <div class="name">Public</div>
            <div class="desc">Your wish may appear on the wish wall.</div>
          </div>
        </div>
        <div class="choice-hint">By choosing Public, you allow The Wishing Angel to display your wish, including on the wish wall.</div>
        <div class="btn-row">
          <button class="btn btn-primary" id="toRibbon" ${!d.privacy ? 'disabled' : ''}>Continue</button>
          <button class="btn btn-ghost" data-nav="wish-text">Back</button>
        </div>
      </div>
    `;
  }

  function stepRibbonView() {
    const d = state.draft;
    return `
      <div class="step active">
        <div class="step-head">
          <div class="step-title">Choose Your Ribbon</div>
          <div class="step-sub">A small color to represent your wish.</div>
        </div>
        <div class="ribbon-grid">
          ${RIBBON_COLORS.map(r => `
            <div class="ribbon-opt ${d.ribbon === r.key ? 'selected' : ''}" data-ribbon="${r.key}">
              <div style="position:relative;">
                <div class="ring"></div>
                <div class="ribbon-swatch" style="background:${r.hex}; color:${r.hex};"></div>
              </div>
              <div class="rlabel">${r.label}${r.key === DEFAULT_RIBBON ? ' · default' : ''}</div>
            </div>
          `).join('')}
        </div>
        <div class="choice-hint">Gold is chosen for you if you'd rather not decide.</div>
        <div class="btn-row">
          <button class="btn btn-primary" id="toPayment">Continue</button>
          <button class="btn btn-ghost" data-nav="wish-privacy">Back</button>
        </div>
      </div>
    `;
  }

  const AMOUNT_PRESETS = [100, 300, 500, 1000]; // $1, $3, $5, $10

  function computeFeeCents(baseCents) {
    // Covers Stripe's standard US rate (2.9% + 30c) so the wish still nets
    // the full base amount after the fee is deducted.
    const total = Math.ceil((baseCents + 30) / (1 - 0.029));
    return total - baseCents;
  }

  function stepPaymentView() {
    const isStripe = config.paymentMode === 'stripe';
    const d = state.draft;
    const feeCents = computeFeeCents(d.amountCents);
    const totalCents = d.coverFee ? d.amountCents + feeCents : d.amountCents;
    const fmt = (c) => `$${(c / 100).toFixed(2)}`;

    return `
      <div class="step active">
        <div class="step-head">
          <div class="step-title">One Wish</div>
          <div class="step-sub">Leave it with the Angel.</div>
        </div>

        <div class="amount-grid">
          ${AMOUNT_PRESETS.map(a => `
            <div class="amount-opt ${!d.customAmount && d.amountCents === a ? 'selected' : ''}" data-amount="${a}">${fmt(a)}</div>
          `).join('')}
        </div>
        <div class="amount-custom ${d.customAmount ? 'selected' : ''}" id="customAmountBox">
          <span>$</span>
          <input type="number" min="1" step="0.01" id="customAmountInput" placeholder="Custom amount"
            value="${d.customAmount ? (d.amountCents / 100).toFixed(2) : ''}">
        </div>

        <div class="fee-toggle ${d.coverFee ? 'checked' : ''}" id="coverFeeToggle">
          <div class="box"></div>
          <span>Add ${fmt(feeCents)} to cover the card processing fee, so the Angel receives the full ${fmt(d.amountCents)}.</span>
        </div>

        <div class="amount-total">${fmt(totalCents)}</div>

        <div class="price-box" style="margin-top:14px;">
          ${isStripe
            ? `<div id="stripe-card-element"></div>`
            : `<div class="fake-card"><span>Card ending 4242</span><span>Test mode</span></div>`
          }
        </div>
        ${isStripe
          ? `<div class="paying-note">Payments are processed securely by Stripe. Your card details never touch this server.</div>`
          : `<div class="paying-note">This server is running in test mode. No Stripe key is configured, so no real card is charged.</div>`
        }
        ${state.submitError ? `<div class="err-line">${state.submitError}</div>` : ''}
        <div class="btn-row">
          <button class="btn btn-primary" id="payNow" ${state.submitting ? 'disabled' : ''}>${state.submitting ? 'Processing…' : `Make my wish · ${fmt(totalCents)}`}</button>
          <button class="btn btn-ghost" data-nav="wish-ribbon" ${state.submitting ? 'disabled' : ''}>Back</button>
        </div>
      </div>
    `;
  }

  function personalLine(w) {
    const silentLines = [
      "Some things don't need words to be held with care. Yours is safe here.",
      "You didn't have to say it out loud for it to matter. It's been received all the same.",
    ];
    const privateLines = [
      "What you wrote stays exactly where you left it, with the Angel and no one else.",
      "This one is yours alone now. It's been set down gently, and kept close.",
    ];
    const publicLines = [
      "Thank you for letting others sit with this one too. It's been added to the wall with the same care as any other.",
      "Your wish now keeps company with everyone else's, a small light among many.",
    ];
    const pool = w.silent ? silentLines : (w.privacy === 'private' ? privateLines : publicLines);
    const idx = (w.number || 0) % pool.length;
    return pool[idx];
  }

  function auspiciousReminderHtml() {
    if (!state.auspiciousDays || state.auspiciousDays.length === 0) return '';
    const next = state.auspiciousDays[0];
    const { day, month } = formatDayParts(next.date);
    return `
      <div class="auspicious-reminder">
        <div class="label">Next auspicious day</div>
        <div class="line">${next.title}, ${month} ${day}. ${escapeHtml(next.reason)}</div>
      </div>
    `;
  }

  function confirmationView() {
    const w = state.lastWish;
    if (!w) return homeView();
    const ribbon = RIBBON_COLORS.find(r => r.key === w.ribbon) || RIBBON_COLORS[0];
    return `
      <div class="confirm-wrap">
        <div class="step-sub" style="margin-top:44px;">Your wish has been received</div>
        <div class="wish-number">Wish ${formatNumber(w.number)}</div>
        <div class="tags">
          <span class="tag privacy-${w.privacy}">${w.privacy === 'private' ? '🔒 Private' : '💫 Public'}</span>
          <span class="tag" style="border-color:${ribbon.hex}80;">
            <span style="width:8px;height:8px;border-radius:50%;background:${ribbon.hex};display:inline-block;"></span>
            ${ribbon.label} ribbon
          </span>
        </div>
        <div class="confirm-line">${personalLine(w)}</div>
        <div class="confirm-line" style="margin-top:14px; font-size:14.5px;">It sits with the Angel now, held gently, wished on quietly, hoped for alongside you.</div>
        <div class="final-motto">Every great thing that ever happened began as someone's quiet wish.<br>Yours has just begun.</div>
        ${auspiciousReminderHtml()}
        <div class="btn-row">
          <button class="btn btn-primary" data-nav="home">Return home</button>
          ${w.privacy === 'public' ? `<button class="btn btn-ghost" data-nav="wall">View the wish wall</button>` : ''}
        </div>
      </div>
      ${footerHtml()}
    `;
  }

  function wallView() {
    const d = state.wallData;
    let ribbonsHtml, listHtml, pagerHtml = '';
    if (state.wallLoading || !d) {
      ribbonsHtml = `<div class="loading-line">Gathering wishes…</div>`;
      listHtml = '';
    } else if (d.total === 0) {
      ribbonsHtml = `<div class="wall-empty">The wall is just beginning.<br>Yours could be the first ribbon.</div>`;
      listHtml = `<div class="wish-list-empty">Nothing here yet.</div>`;
    } else {
      ribbonsHtml = `<div class="ribbon-wall">` + d.wishes.map((w, i) => {
        const ribbon = RIBBON_COLORS.find(r => r.key === w.ribbon) || RIBBON_COLORS[0];
        const isSealed = w.privacy === 'private' || w.silent || w.hidden;
        return `
          <div class="ribbon-item ${isSealed ? 'sealed' : ''}" style="--d:${i % 8};">
            <div class="pin"></div>
            <div class="strip" style="background:${ribbon.hex}; color:${ribbon.hex};"></div>
            <div class="tag"><div class="num">${isSealed ? '🔒' : '✦'} ${formatCompact(w.number)}</div></div>
          </div>
        `;
      }).join('') + `</div>`;

      const withText = d.wishes.filter(w => w.privacy === 'public' && !w.hidden && w.text && w.text.trim().length > 0);
      listHtml = withText.length === 0
        ? `<div class="wish-list-empty">No public wishes with words yet in this section of the wall.</div>`
        : withText.slice().reverse().map(w => {
            const ribbon = RIBBON_COLORS.find(r => r.key === w.ribbon) || RIBBON_COLORS[0];
            return `
              <div class="wish-list-item">
                <span class="dot" style="background:${ribbon.hex};"></span>
                <div class="body">
                  <div class="num">Wish ${formatNumber(w.number)}</div>
                  <div class="txt">${escapeHtml(w.text)}</div>
                </div>
              </div>
            `;
          }).join('');

      pagerHtml = `
        <div class="wall-pager">
          <button data-wallnav="prev" ${d.wallIndex <= 1 ? 'disabled' : ''}>‹ Prev</button>
          <div class="label">Wall ${d.wallIndex} of ${d.totalWalls}
            <span class="range">wishes ${formatNumber(d.start)}&ndash;${formatNumber(d.end)}</span>
          </div>
          <button data-wallnav="next" ${d.wallIndex >= d.totalWalls ? 'disabled' : ''}>Next ›</button>
        </div>
      `;
    }

    return `
      <div class="wall-hero">
        ${sparkleField()}
        <div class="eyebrow" style="text-align:center;">The Wishing Wall</div>
        <div class="wall-total">${d ? d.total.toLocaleString() : '…'}</div>
        <div class="wall-total-label">wishes held here</div>
        <div class="affirm-ticker"><span id="affirmText">${AFFIRMATIONS[affirmIdx]}</span></div>
      </div>
      <div class="wishing-bar"></div>
      <div class="wishing-bar-label">EACH RIBBON, A WISH</div>
      ${pagerHtml}
      <div class="wall-columns">
        <div>${ribbonsHtml}</div>
        <div class="wish-list-panel">
          <h3>Wishes shared with words</h3>
          <div class="wish-list-scroll">${listHtml}</div>
        </div>
      </div>
      <div class="wall-cta">
        <div class="line1">Add your ribbon</div>
        <div class="line2">${d && d.total > 0 ? `You'd be quietly joining ${d.total.toLocaleString()} others.` : `You could be the first wish on this wall.`}</div>
        <div class="btn-row" style="max-width:280px; margin-left:auto; margin-right:auto;">
          <button class="btn btn-primary" data-nav="wish-text">Make a wish · $1</button>
        </div>
      </div>
      ${footerHtml()}
    `;
  }

  function adminView() {
    if (!state.admin.authed) {
      return `
        <div class="step-head" style="margin-top:36px;">
          <div class="step-title">Angel Keeper</div>
          <div class="step-sub">Enter the admin key to continue.</div>
        </div>
        <div class="admin-gate">
          <input type="password" id="adminKeyInput" placeholder="Admin key" value="${state.admin.key}">
          ${state.admin.error ? `<div class="err-line">${state.admin.error}</div>` : ''}
          <div class="btn-row">
            <button class="btn btn-primary" id="adminSubmit">Enter</button>
            <button class="btn btn-ghost" data-nav="home">Home</button>
          </div>
        </div>
      `;
    }
    const a = state.admin;
    const total = a.wishes.length;
    const priv = a.wishes.filter(w => w.privacy === 'private').length;
    const pub = a.wishes.filter(w => w.privacy === 'public').length;
    return `
      <div class="step-head" style="margin-top:36px;">
        <div class="step-title">Angel Keeper</div>
        <div class="step-sub">A quiet view of what's been left.</div>
      </div>
      <div class="stat-row">
        <div class="stat"><b>${total}</b><span>TOTAL</span></div>
        <div class="stat"><b>${pub}</b><span>PUBLIC</span></div>
        <div class="stat"><b>${priv}</b><span>PRIVATE</span></div>
      </div>
      ${a.loading ? `<div class="loading-line">Loading…</div>` : (
        a.wishes.length === 0 ? `<div class="wall-empty">Nothing yet.</div>` :
        a.wishes.slice().reverse().map(w => `
          <div class="admin-row">
            <div>
              <div class="admin-meta">Wish ${formatNumber(w.number)} · ${w.privacy} · ${w.ribbon} ribbon</div>
              <div class="admin-text">${w.text ? escapeHtml(w.text) : '(silent or private wish)'}</div>
            </div>
            <div class="admin-actions">
              ${w.privacy === 'public' ? `<button class="mini-btn" data-hide="${w.id}">${w.hidden ? 'Unhide' : 'Hide'}</button>` : `<span class="admin-meta">🔒</span>`}
            </div>
          </div>
        `).join('')
      )}
      <div class="btn-row" style="margin-top:30px;">
        <button class="btn btn-ghost" data-nav="home">Home</button>
      </div>
    `;
  }

  // ---------- API calls ----------

  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      config = await res.json();
    } catch (e) { /* fall back to defaults already set */ }
  }

  async function getCounter() {
    try {
      const res = await fetch('/api/counter');
      const data = await res.json();
      state.counter = data.count;
      state.counterError = false;
    } catch (e) {
      state.counterError = true;
    }
  }

  async function loadAuspiciousDays() {
    try {
      const res = await fetch('/api/auspicious-days');
      const data = await res.json();
      state.auspiciousDays = data.days || [];
    } catch (e) {
      state.auspiciousDays = [];
    }
  }

  async function loadWall(page) {
    state.wallLoading = true;
    render();
    try {
      const url = page ? `/api/wall?wall=${page}` : '/api/wall';
      const res = await fetch(url);
      state.wallData = await res.json();
      state.wallPage = state.wallData.wallIndex;
    } catch (e) {
      state.wallData = { total: 0, wallIndex: 1, totalWalls: 1, start: 1, end: 0, wishes: [] };
    }
    state.wallLoading = false;
  }

  async function submitAdminKey() {
    state.admin.loading = true;
    state.admin.error = null;
    render();
    try {
      const res = await fetch('/api/admin/wishes', { headers: { 'x-admin-key': state.admin.key } });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        state.admin.error = err.error || 'Could not verify that key.';
        state.admin.authed = false;
      } else {
        const data = await res.json();
        state.admin.wishes = data.wishes;
        state.admin.authed = true;
      }
    } catch (e) {
      state.admin.error = 'Something went wrong reaching the server.';
    }
    state.admin.loading = false;
    render();
  }

  async function toggleHide(id) {
    try {
      await fetch(`/api/admin/wishes/${id}/hide`, { method: 'POST', headers: { 'x-admin-key': state.admin.key } });
      state.admin.wishes = state.admin.wishes.map(w => w.id === id ? { ...w, hidden: !w.hidden } : w);
      render();
    } catch (e) { /* noop */ }
  }

  function startAffirmTicker() {
    stopAffirmTicker();
    affirmTimer = setInterval(() => {
      const el = document.getElementById('affirmText');
      if (!el) return;
      el.parentElement.classList.add('fading');
      setTimeout(() => {
        affirmIdx = (affirmIdx + 1) % AFFIRMATIONS.length;
        el.textContent = AFFIRMATIONS[affirmIdx];
        el.parentElement.classList.remove('fading');
      }, 500);
    }, 4200);
  }
  function stopAffirmTicker() { if (affirmTimer) { clearInterval(affirmTimer); affirmTimer = null; } }

  // ---------- payment flow ----------

  async function setupStripeElement() {
    if (!window.Stripe || !config.stripePublishableKey) return;
    stripeInstance = window.Stripe(config.stripePublishableKey);
    const elements = stripeInstance.elements();
    cardElement = elements.create('card', {
      style: {
        base: {
          color: '#f2ede3',
          fontFamily: 'Manrope, sans-serif',
          fontSize: '15px',
          '::placeholder': { color: 'rgba(242,237,227,0.35)' },
        },
        invalid: { color: '#d98a8a' },
      },
    });
    const mount = document.getElementById('stripe-card-element');
    if (mount) cardElement.mount('#stripe-card-element');
  }

  async function handlePay() {
    state.submitting = true;
    state.submitError = null;
    // Update the button directly instead of calling render(), which would
    // wipe and recreate the mounted Stripe card element right before we
    // need to read what the customer typed into it.
    const payBtn = document.getElementById('payNow');
    if (payBtn) { payBtn.disabled = true; payBtn.textContent = 'Processing…'; }
    const backBtn = document.querySelector('.step.active [data-nav="wish-ribbon"]');
    if (backBtn) backBtn.disabled = true;

    try {
      const feeCents = computeFeeCents(state.draft.amountCents);
      const finalAmountCents = state.draft.coverFee ? state.draft.amountCents + feeCents : state.draft.amountCents;
      const createRes = await fetch('/api/wishes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: state.draft.text,
          silent: state.draft.silent,
          privacy: state.draft.privacy,
          ribbon: state.draft.ribbon,
          amountCents: finalAmountCents,
        }),
      });
      const created = await createRes.json();
      if (!createRes.ok) throw new Error(created.error || 'Could not start the wish.');
      state.activeWishId = created.id;

      if (created.mode === 'stripe') {
        const result = await stripeInstance.confirmCardPayment(created.clientSecret, {
          payment_method: { card: cardElement },
        });
        if (result.error) throw new Error(result.error.message);
      }

      const confirmRes = await fetch(`/api/wishes/${created.id}/confirm`, { method: 'POST' });
      const confirmed = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmed.error || 'Could not confirm the wish.');

      state.lastWish = { ...confirmed, text: state.draft.text };
      state.draft = { text: '', silent: false, privacy: null, ribbon: DEFAULT_RIBBON, amountCents: 300, customAmount: false, coverFee: false };
      state.view = 'confirmation';
    } catch (e) {
      state.submitError = e.message || 'Something interrupted the wish. Please try again.';
    }
    state.submitting = false;
    render();
    if (state.view === 'wish-payment' && config.paymentMode === 'stripe') setupStripeElement();
  }

  // ---------- events ----------

  function wireEvents() {
    document.querySelectorAll('[data-nav]').forEach(el => {
      el.addEventListener('click', async () => {
        const target = el.getAttribute('data-nav');
        state.view = target;
        state.submitError = null;
        stopAffirmTicker();
        if (target === 'home') { render(); await getCounter(); render(); }
        else if (target === 'wall') { await loadWall(); render(); startAffirmTicker(); }
        else if (target === 'wish-payment') { render(); if (config.paymentMode === 'stripe') setupStripeElement(); }
        else { render(); }
      });
    });

    const wishTextEl = document.getElementById('wishText');
    if (wishTextEl) wishTextEl.addEventListener('input', e => { state.draft.text = e.target.value; });

    const silentToggle = document.getElementById('silentToggle');
    if (silentToggle) silentToggle.addEventListener('click', () => {
      state.draft.silent = !state.draft.silent;
      if (state.draft.silent) state.draft.text = '';
      render();
    });

    const toPrivacy = document.getElementById('toPrivacy');
    if (toPrivacy) toPrivacy.addEventListener('click', () => { state.view = 'wish-privacy'; render(); });

    document.querySelectorAll('[data-privacy]').forEach(el => {
      el.addEventListener('click', () => { state.draft.privacy = el.getAttribute('data-privacy'); render(); });
    });
    const toRibbon = document.getElementById('toRibbon');
    if (toRibbon) toRibbon.addEventListener('click', () => { if (state.draft.privacy) { state.view = 'wish-ribbon'; render(); } });

    document.querySelectorAll('[data-ribbon]').forEach(el => {
      el.addEventListener('click', () => { state.draft.ribbon = el.getAttribute('data-ribbon'); render(); });
    });
    const toPayment = document.getElementById('toPayment');
    if (toPayment) toPayment.addEventListener('click', async () => {
      state.view = 'wish-payment';
      render();
      if (config.paymentMode === 'stripe') await setupStripeElement();
    });

    const payNow = document.getElementById('payNow');
    if (payNow) payNow.addEventListener('click', handlePay);

    document.querySelectorAll('[data-wallnav]').forEach(el => {
      el.addEventListener('click', async () => {
        const dir = el.getAttribute('data-wallnav');
        const d = state.wallData;
        if (!d) return;
        const next = dir === 'prev' ? Math.max(1, d.wallIndex - 1) : Math.min(d.totalWalls, d.wallIndex + 1);
        await loadWall(next);
        render();
      });
    });

    const adminKeyInput = document.getElementById('adminKeyInput');
    if (adminKeyInput) adminKeyInput.addEventListener('input', e => { state.admin.key = e.target.value; });
    const adminSubmit = document.getElementById('adminSubmit');
    if (adminSubmit) adminSubmit.addEventListener('click', submitAdminKey);

    document.querySelectorAll('[data-hide]').forEach(el => {
      el.addEventListener('click', () => toggleHide(el.getAttribute('data-hide')));
    });

    document.querySelectorAll('[data-amount]').forEach(el => {
      el.addEventListener('click', () => {
        state.draft.amountCents = parseInt(el.getAttribute('data-amount'), 10);
        state.draft.customAmount = false;
        render();
      });
    });

    const customBox = document.getElementById('customAmountBox');
    if (customBox) customBox.addEventListener('click', () => {
      state.draft.customAmount = true;
      render();
      const input = document.getElementById('customAmountInput');
      if (input) input.focus();
    });
    const customInput = document.getElementById('customAmountInput');
    if (customInput) customInput.addEventListener('input', e => {
      const dollars = parseFloat(e.target.value);
      const min = (config.minAmountCents || 100) / 100;
      state.draft.amountCents = Number.isFinite(dollars) ? Math.round(Math.max(min, dollars) * 100) : (config.minAmountCents || 100);
      state.draft.customAmount = true;
    });

    const coverFeeToggle = document.getElementById('coverFeeToggle');
    if (coverFeeToggle) coverFeeToggle.addEventListener('click', () => {
      state.draft.coverFee = !state.draft.coverFee;
      render();
    });
  }

  (async function init() {
    render();
    await loadConfig();
    await getCounter();
    await loadAuspiciousDays();
    render();
  })();
})();
