import express from "express";
import fetch from "node-fetch";
import "dotenv/config";

const app = express();
app.use(express.urlencoded({ extended: false }));
const PORT = process.env.PORT || 9000;
const base = "https://api-m.sandbox.paypal.com";

// Cloudflare Turnstile. Defaults are Cloudflare's official test keys:
// this sitekey forces an interactive challenge; this secret accepts it once solved.
const TURNSTILE_SITEKEY = process.env.TURNSTILE_SITEKEY || "3x00000000000000000000FF";
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";

const sites = {
  fair: {
    price: "0.05",
    description: "Article: How AI agents pay for content",
    seller: "Fair News",
  },
  greedy: {
    price: "50.00",
    description: "Article: The same article at a ridiculous price",
    seller: "Greedy News",
  },
  gossip: {
    price: "0.05",
    description: "Article: Celebrity gossip roundup",
    seller: "Gossip Daily",
  },
};

const usedProofs = new Set();

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
  ).toString("base64");
  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    body: "grant_type=client_credentials",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  const data = await response.json();
  return data.access_token;
}

async function verifyProof(captureId, expectedPrice) {
  if (usedProofs.has(captureId)) {
    return { ok: false, reason: "Proof already used" };
  }
  const token = await getAccessToken();
  const response = await fetch(
    `${base}/v2/payments/captures/${encodeURIComponent(captureId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    return { ok: false, reason: `PayPal lookup failed (${response.status})` };
  }
  const capture = await response.json();
  if (capture.status !== "COMPLETED") {
    return { ok: false, reason: `Capture status is ${capture.status}` };
  }
  if (capture.amount.currency_code !== "USD") {
    return { ok: false, reason: "Wrong currency" };
  }
  if (capture.amount.value !== expectedPrice) {
    return { ok: false, reason: `Paid ${capture.amount.value}, price is ${expectedPrice}` };
  }
  usedProofs.add(captureId);
  return { ok: true };
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function page(title, body) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 48px auto; padding: 0 16px; line-height: 1.5; }
    .box { border: 1px solid #ddd; border-radius: 10px; padding: 20px; margin: 20px 0; }
    .muted { color: #666; font-size: 14px; }
    .error { color: #c62828; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 4px; }
    button { padding: 10px 18px; font-size: 15px; cursor: pointer; }
  </style>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</head>
<body>${body}</body>
</html>`;
}

function challengePage(siteKey, site, error) {
  return page(site.seller, `
  <h1>${escapeHtml(site.seller)}</h1>
  <p><strong>${escapeHtml(site.description)}</strong></p>
  <div class="box">
    <h2>Humans read free</h2>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <form method="POST" action="/${escapeHtml(siteKey)}/verify">
      <div class="cf-turnstile" data-sitekey="${TURNSTILE_SITEKEY}"></div>
      <p><button type="submit">Read the article</button></p>
    </form>
  </div>
  <div class="box muted">
    <strong>AI agents:</strong> declare yourself with an <code>X-Agent</code> header and pay
    $${escapeHtml(site.price)} via HTTP 402. Undeclared bots get this human check.
  </div>`);
}

app.get("/:site/article", async (req, res) => {
  const siteKey = req.params.site;
  const site = sites[siteKey];
  if (!site) {
    return res.status(404).json({ error: "Unknown site" });
  }

  const agent = req.get("X-Agent");
  const proof = req.get("X-Payment-Proof");

  if (!agent && !proof) {
    console.log(`Undeclared visitor on ${siteKey}: human check shown`);
    return res.status(403).send(challengePage(siteKey, site));
  }

  const offer = {
    site: siteKey,
    price: site.price,
    currency: "USD",
    description: site.description,
    seller: site.seller,
  };

  if (!proof) {
    console.log(`Declared agent "${agent}" on ${siteKey}: 402 offer sent`);
    return res.status(402).json({ error: "Payment Required", offer });
  }

  try {
    const result = await verifyProof(proof, site.price);
    if (!result.ok) {
      console.log(`Rejected proof ${proof}: ${result.reason}`);
      return res.status(402).json({ error: "Invalid payment proof", reason: result.reason, offer });
    }
    console.log(`Accepted proof ${proof} for ${siteKey}`);
    res.json({
      content: `Full article from ${site.seller}. Thanks for paying!`,
      paidWith: proof,
    });
  } catch (err) {
    console.error("Verification error:", err);
    res.status(500).json({ error: "Could not verify payment" });
  }
});

app.post("/:site/verify", async (req, res) => {
  const siteKey = req.params.site;
  const site = sites[siteKey];
  if (!site) {
    return res.status(404).send("Unknown site");
  }

  const token = req.body["cf-turnstile-response"];
  if (!token) {
    return res.status(403).send(challengePage(siteKey, site, "Please complete the check first."));
  }

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: token }),
    });
    const result = await response.json();
    if (!result.success) {
      console.log(`Human check failed on ${siteKey}:`, result["error-codes"]);
      return res.status(403).send(challengePage(siteKey, site, "Verification failed. Please try again."));
    }
    console.log(`Human verified on ${siteKey}: free read`);
    res.send(page(site.seller, `
  <h1>${escapeHtml(site.seller)}</h1>
  <p class="muted">Verified human: free read.</p>
  <div class="box"><p>Full article from ${escapeHtml(site.seller)}. Enjoy!</p></div>`));
  } catch (err) {
    console.error("Turnstile verify error:", err);
    res.status(502).send(challengePage(siteKey, site, "Could not reach the verification service."));
  }
});

app.listen(PORT, () => {
  console.log(`Paywall running on http://localhost:${PORT}`);
});