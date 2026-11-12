# AI Spending Guard

**Give your AI agent a budget, not your wallet. Websites get paid; people still read free.**

AI crawlers can now pay websites per article over **HTTP 402 Payment Required**. Two things are missing:
nothing stops an agent from **overspending or paying for junk**, and nothing stops a website from being
"paid" with **fake or reused proof**. AI Spending Guard covers both sides of that payment, using
**PayPal** to move the money and **Google Gemini** for judgment.

> Sandbox prototype · play money only · built for the PayPal AI Hackathon 2026

**Who it's for:** people and teams who let AI agents buy data or articles but don't want to hand them a
blank cheque, and publishers who want AI agents to pay instead of scraping, without charging human readers.

---

## Try it live

| What | Link |
|---|---|
| **Dashboard** | https://ai-spend-guard.onrender.com |
| **Demo news site** | https://ai-spend-guard-paywall.onrender.com/fair/article |

**Three-minute tour:**

1. Open the dashboard and click **Connect PayPal (sandbox)**. Log in with a PayPal sandbox **Personal**
   account (yours, or the demo buyer in the Devpost testing instructions) and approve. You land on
   **your own** dashboard: your own limits, approvals and history.
2. Click **Run agent**. Your agent visits three paywalled news sites:
   - **Fair News** ($0.05, useful) → paid automatically from your PayPal, and the money is sent to
     **Fair News's own PayPal account**.
   - **Gossip Daily** ($0.05, off-topic) → vetoed by the AI.
   - **Greedy News** ($50.00) → paused under **Waiting for your approval**. Approve or deny it.
3. Raise **Your spending limits** (for example $60 per item, $100 per day) and run again. Greedy News now
   passes the rules, and the AI still vetoes it as a rip-off. Two independent checks.
4. Open a news site **in your browser**: pass the Cloudflare check and read free. Then try the same URL
   **as an agent**:

   ```
   curl -i -H "X-Agent: demo" https://ai-spend-guard-paywall.onrender.com/fair/article
   ```

   You get `HTTP/1.1 402 Payment Required` with a price instead.

Each visitor can run their agent up to 10 times per hour.

---

## How it works

```mermaid
flowchart TD
    V[Visitor requests an article] --> W{Paywall: who is asking?}

    W -->|Browser, no agent header| T[Cloudflare Turnstile human check]
    T -->|Passed| FREE[Free article for people]
    T -->|Bot cannot solve it| STOP[No article]

    W -->|Declares X-Agent header| O[HTTP 402 + price offer]
    O --> R{Guard rules<br/>approved site?<br/>per-item limit?<br/>daily budget?}

    R -->|Blocked| H[Owner approval on dashboard]
    H -->|Deny| NO[Nothing paid]
    H -->|Approve| PAY[Charge the owner's saved PayPal]

    R -->|Allowed| AI{AI advisor:<br/>does this help the task?}
    AI -->|No| SKIP[Skipped, nothing paid]
    AI -->|AI unavailable| H
    AI -->|Yes| PAY

    PAY --> OUT[Payout to the site's own PayPal account]
    OUT --> PROOF[Agent retries with PayPal capture ID]
    PROOF --> CHECK{Paywall verifies the payment<br/>completed? right amount?<br/>never used before?}
    CHECK -->|Valid| ART[Article delivered]
    CHECK -->|Invalid| REJ[Rejected]
```

### Connecting PayPal (each visitor, once)

```mermaid
sequenceDiagram
    participant U as Visitor
    participant G as Guard
    participant PP as PayPal

    U->>G: Click "Connect PayPal"
    G->>PP: Create setup token (Vault v3)
    PP-->>G: approve link
    G-->>U: Redirect to PayPal
    U->>PP: Log in and approve "save for future payments"
    PP-->>U: Redirect back to the guard
    G->>PP: Exchange setup token for a payment token
    PP-->>G: vault ID + PayPal email
    G-->>U: Your own dashboard
```

No purchase is needed to connect. After that, the guard can charge the visitor's saved PayPal with no popup
or login per payment, but only when the rules, the AI and (if needed) the visitor allow it.

### Side 1: the website, "declare and pay, or prove you're human"

| Visitor | Sends | Gets |
|---|---|---|
| A person in a browser | nothing special | A Cloudflare Turnstile check → **free article** |
| An honest AI agent | `X-Agent: <name>` header | **HTTP 402** with a price → pays → article |
| A bot pretending to be human | nothing special | The human check, which it can't pass |

When an agent comes back with payment proof, the paywall checks with PayPal that the payment is
`COMPLETED`, for the **right amount** and currency, and **never used before**. Used proofs are saved to disk,
so a payment can't be replayed after the paywall restarts.

### Side 2: the agent owner, "pay for small, sensible things; ask me about the rest"

Every purchase goes through three layers, in this order:

1. **Rules (always first):** approved sites only, a per-item limit, and a daily budget. Each owner sets their
   own limits on the dashboard. If the rules block a purchase, it waits for the owner.
2. **AI advisor (Gemini):** asked only if the rules allow the purchase: *does this help the agent's task?*
   - The AI can only **veto**. It can never approve anything the rules didn't allow.
   - If the AI call fails, the request goes to the owner. It is never paid automatically.
3. **Owner:** approves or denies paused requests on the dashboard.

### Where the money goes

```mermaid
flowchart LR
    B[Owner's saved PayPal] -->|1. charge with vault_id| G[Guard's PayPal account<br/>merchant of record]
    G -->|2. Payout| F[Fair News's own PayPal account]
```

---

## Architecture

| Part | File | Holds secrets? | Job |
|---|---|---|---|
| **Guard** | `server/server.js` | Yes: PayPal app, Gemini | Connect PayPal, sessions, per-user rules, AI check, payments, payouts, approvals, logs |
| **Paywall** | `server/paywall.js` | PayPal (to verify only) | 402 offers, human check, payment verification, replay protection |
| **Agent** | `agent.js` | **No** | Visits sites, asks the guard to pay |
| **Dashboard** | `client/dashboard.html`, `client/login.html` | No | Connect PayPal, run agent, set limits, approve/deny, view log |

**Every visitor is separate.** A signed, HttpOnly cookie identifies the visitor; their saved PayPal, limits,
log and approvals live in their own folder under `data/users/`. One visitor can't see or spend another's.

**The agent never holds payment credentials.** The guard starts it with only its task, two URLs, and a
one-time token tied to the visitor who clicked **Run agent**. The token lets it ask the guard to pay for that
visitor and check an approval's status, nothing else: it can't change limits, approve its own requests, or
reach PayPal.

---

## PayPal, AI, and other tools

| Technology | Used for |
|---|---|
| **PayPal Vault v3** (setup tokens → payment tokens) | Each visitor saves their PayPal once, without a purchase |
| **PayPal Orders v2 with `vault_id`** | Charges with no buyer present, within the visitor's rules |
| **PayPal Payouts** | Sends each article payment to the site's own PayPal account |
| **PayPal Captures API** | Paywall verifies each payment proof |
| **PayPal OAuth 2.0** (client credentials) | Server-side authentication |
| **Google Gemini** (`gemini-3.5-flash`) | Veto-only advisor: does this purchase help the agent's task? |
| **Cloudflare Turnstile** (test keys) | Human verification on the paywall |
| **Render** | Hosting for the guard and the paywall |

---

## Run it yourself

### Prerequisites

- **Node.js** 18 or newer
- A **PayPal Developer** account with a sandbox **Merchant** app
  - Enable **Save payment methods** and **Payouts** on the app **before** you use its credentials for the
    first time. PayPal reuses an access token for hours, so features enabled later may not apply until it
    expires; if in doubt, create a fresh app.
  - Sandbox accounts: a **Business** account for the app, at least one **Personal** account to connect as a
    user, and optionally a second **Business** account for Fair News
- A **Gemini API key** from Google AI Studio

### 1. Install

```
git clone https://github.com/Swarna2503/ai-spend-guard.git
cd ai-spend-guard
npm install
```

### 2. Configure

```
cp .env.example .env
```

| Variable | Required | Purpose |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Yes | Your sandbox app |
| `SESSION_SECRET` | Yes | Any long random text; keeps visitors signed in across restarts |
| `GEMINI_API_KEY` | Yes | AI advisor |
| `FAIR_PAYEE` | No | Fair News's sandbox PayPal email; when set, Fair News payments are paid out to it |
| `PAYWALL_URL`, `GUARD_URL` | No | Defaults: `http://localhost:9000`, `http://localhost:8888` |
| `TURNSTILE_SITEKEY`, `TURNSTILE_SECRET_KEY` | No | Real Cloudflare keys for production (defaults are test keys) |

### 3. Start everything with one command

```
npm run demo
```

```
[paywall] Paywall running on http://localhost:9000
[guard]   Node server listening at http://localhost:8888/
```

### 4. Use it

1. Open **http://localhost:8888** and click **Connect PayPal (sandbox)**.
2. Log in with a sandbox **Personal** account (not the Business account: it's the merchant and can't pay
   itself; if PayPal keeps logging into it, use a fresh private window).
3. Click **Run agent**:

| Site | Price | Outcome (default limits) | Decided by |
|---|---|---|---|
| Fair News | $0.05 | **Paid** automatically, sent to Fair News | Rules + AI |
| Gossip Daily | $0.05 | **Skipped** (off-topic) | AI |
| Greedy News | $50.00 | **Paused** for approval | Rules → you |

To try a second user, open the app in a **different browser** and connect a different sandbox Personal account.

---

## Security decisions

- **Per-visitor isolation.** Each visitor's saved PayPal, limits, log and approvals are separate, identified
  by a signed, HttpOnly cookie.
- **The agent gets no secrets.** It's started with a minimal environment and a one-time token tied to one
  visitor's run.
- **The AI can only veto.** A website's description could try to manipulate the AI (prompt injection);
  even a fooled AI cannot spend beyond the rules.
- **Fail safe.** If the AI is unavailable, requests go to the owner, never straight to payment.
- **Payment proofs are verified with PayPal**, and each proof works only once, even across restarts.
- **No double charges.** Approving marks a request as `charging` before calling PayPal.
- **Disconnect means disconnect.** **Disconnect PayPal** deletes the saved payment method at PayPal and
  the visitor's data.
- **Untrusted text is never rendered as HTML.** Site descriptions are escaped or shown with `textContent`.
- **Money math in cents** to avoid floating-point errors.

---

## What I built vs. what I reused

- **Started from:** PayPal's [`docs-examples/save-payment-method`](https://github.com/paypal-examples/docs-examples)
  (Apache 2.0), which showed vaulting during a purchase and the OAuth helper pattern.
- **Built:** connecting PayPal without a purchase (Vault setup tokens), multi-user sessions and per-user data,
  server-side charging of saved PayPal methods, payouts to sites, the rules engine and editable limits, the
  Gemini advisor, owner approvals, the paywall with HTTP 402 offers, PayPal payment verification and replay
  protection, human verification with Turnstile, the agent, the dashboard, and hosting.

## Inspiration

**CrawlerPal** (PayPal Dev Days 2025 winner) showed that bots can pay websites via HTTP 402 using a saved
PayPal method. Its gap: the bot pays whatever it's asked. This project adds the missing spending controls
on the agent side, and human access plus payment verification on the website side.

---

## Honest limits (and what I tested)

- **Prototype, sandbox only.** No real money moves.
- **The guard is the merchant of record.** It charges the owner, then pays the site via Payouts. I tested
  charging a saved PayPal with Fair News as the payee directly: PayPal returned `BILLING_AGREEMENT_NOT_FOUND`,
  because a saved method can only be charged by the merchant it was saved with. Paying sites directly would
  need PayPal's partner platform.
- **The platform verifies, the merchant receives.** Fair News receives each payment in its own account, but
  in sandbox it couldn't look payments up with its own credentials (`NOT_AUTHORIZED` for transaction search;
  payout items can only be read by the sender). So the paywall verifies the owner's payment using the
  guard's PayPal records.
- **Fees:** a $0.05 payment cost $0.05 in fees, and a $0.05 payout cost $0.25. A real version would batch
  payouts per site.
- Only **Fair News** is connected to its own PayPal account; the other demo sites aren't.
- **Sessions, not accounts.** A visitor is identified by a browser cookie. Signing out, or using another
  browser, starts a new session that connects PayPal again.
- On the hosted demo, data lives on the server's disk; without a persistent disk, a redeploy clears it and
  visitors reconnect.
- Human verification uses Cloudflare Turnstile **test keys** ("for testing only" banner). Advanced bots can
  sometimes pass human checks; this raises the cost of lying, it doesn't make it impossible.
- The daily budget resets at midnight **UTC** and counts only autonomous spending.

---

## Demo video

YOUTUBE_LINK_HERE

## License

Apache 2.0. See [`LICENSE`](LICENSE).
