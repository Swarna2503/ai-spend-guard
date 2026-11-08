import express from "express";
import fetch from "node-fetch";
import "dotenv/config";

const app = express();
const PORT = 9000;
const base = "https://api-m.sandbox.paypal.com";

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
    return {
      ok: false,
      reason: `Paid ${capture.amount.value}, price is ${expectedPrice}`,
    };
  }
  usedProofs.add(captureId);
  return { ok: true };
}

app.get("/:site/article", async (req, res) => {
  const site = sites[req.params.site];
  if (!site) {
    return res.status(404).json({ error: "Unknown site" });
  }

  const offer = {
    site: req.params.site,
    price: site.price,
    currency: "USD",
    description: site.description,
    seller: site.seller,
  };

  const proof = req.get("X-Payment-Proof");
  if (!proof) {
    return res.status(402).json({ error: "Payment Required", offer });
  }

  try {
    const result = await verifyProof(proof, site.price);
    if (!result.ok) {
      console.log(`Rejected proof ${proof}: ${result.reason}`);
      return res
        .status(402)
        .json({ error: "Invalid payment proof", reason: result.reason, offer });
    }
    console.log(`Accepted proof ${proof} for ${req.params.site}`);
    res.json({
      content: `Full article from ${site.seller}. Thanks for paying!`,
      paidWith: proof,
    });
  } catch (err) {
    console.error("Verification error:", err);
    res.status(500).json({ error: "Could not verify payment" });
  }
});

app.listen(PORT, () => {
  console.log(`Paywall running on http://localhost:${PORT}`);
});