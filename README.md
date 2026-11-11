# AI Spending Guard

AI crawlers can now pay websites per article over HTTP 402. Nothing stops them overspending,
and nothing stops sites being paid with fake or reused proof. This project guards both sides
of that payment.

## How it works

1. The agent requests an article from a paywalled site.
2. The site replies **HTTP 402 Payment Required** with an offer (price, description, seller).
3. The agent asks the **guard**. The agent never holds payment credentials.
4. The guard checks **rules first**: approved sites only, per-item cap ($0.10), daily budget ($2.00).
   - Rules block → the request goes to the **owner** for approval.
5. If the rules allow it, an **AI advisor** (Google Gemini) checks whether the purchase helps
   the agent's task.
   - The AI can only **veto**. It can never approve anything beyond the rules.
   - If the AI call fails, the request goes to the owner. It is never auto-paid.
6. Allowed → the guard charges the owner's **vaulted PayPal** payment method (no popup) and
   returns the capture ID.
7. The agent retries with the capture ID. The paywall verifies it with PayPal: status,
   amount, currency, and that it hasn't been used before (replay protection).
8. Every decision is logged with its reason.

## Architecture

| Part | File | Port | Holds secrets? |
|---|---|---|---|
| Guard (rules, AI check, payments, approvals, log) | `server/server.js` | 8888 | Yes |
| Paywall sites (fair 5¢, gossip 5¢, greedy $50) | `server/paywall.js` | 9000 | Verifies only |
| Agent | `agent.js` | — | No |

The agent only knows two URLs. It cannot move money except by asking the guard.

## PayPal and AI usage

| Technology | Used for |
|---|---|
| PayPal Orders v2 + Vault (save during purchase) | Owner approves once; the PayPal method is saved |
| PayPal Orders v2 with `vault_id` | Merchant-initiated charges with no buyer present |
| PayPal Captures API | Paywall verifies each payment proof |
| PayPal OAuth 2.0 client credentials | Server-side authentication |
| Google Gemini (`gemini-3.5-flash`) | Veto-only check: does this purchase help the agent's task? |

## Run it

Requirements: Node.js, a PayPal sandbox app, a Gemini API key from Google AI Studio.

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your PayPal sandbox credentials and Gemini key.
3. **One-time owner setup (get a vault ID):** run `npm start`, open http://localhost:8888,
   pay with a sandbox personal account, and copy `payment_source.paypal.attributes.vault.id`
   from the browser console into `PAYPAL_VAULT_ID` in `.env`. Restart the server.
4. Open three terminals in the project folder:
   - `npm start` (guard)
   - `node server/paywall.js` (paywall)
   - `node agent.js` (agent)
5. Open http://localhost:8888/approvals.html and http://localhost:8888/log.html.

Expected run: **fair** is paid automatically, **gossip** is skipped by the AI as irrelevant,
**greedy** is paused for owner approval.

## What I built vs. what I reused

- **Reused:** PayPal's `docs-examples/save-payment-method` (Apache 2.0): checkout page,
  OAuth helper, vaulting during purchase.
- **Built:** server-side charging of the vaulted method, the rules engine, the AI advisor,
  the owner approval flow, the paywall with PayPal capture verification and replay
  protection, the agent, and the log and approval pages.

## Inspiration

CrawlerPal (PayPal Dev Days 2025 winner) showed that bots can pay websites via HTTP 402
using a vaulted PayPal method. Its gap: the bot pays whatever it's asked. This project adds
the missing spending controls, and verification on the website's side.

## Honest limits

- Prototype, **sandbox only**.
- **Fees:** in sandbox, a $0.05 payment cost $0.05 in PayPal fees (net $0.00). Real
  micropayments would need batching or special pricing.
- **Single user:** one vault ID in `.env`. A real version stores one per user.
- The paywall and guard share one merchant account. In reality, the site would be the payee.
- The demo paywall returns 402 to every unpaid request. Human verification is planned next.
- Used-proof tracking is in memory and resets when the paywall restarts.
- The daily budget resets at midnight **UTC**, and counts only autonomous spending
  (owner-approved payments are separate).
- The approval page has no login (local demo only).
- A website's description could try to mislead the AI (prompt injection). That's why the AI
  can only veto: even a fooled AI cannot spend beyond the rules.

## Demo video

YOUTUBE_LINK_HERE

## License

Apache 2.0. See `LICENSE`.
