import fs from "fs";
import express from "express";
import fetch from "node-fetch";
import "dotenv/config";

const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PORT = 8888 } = process.env;
const base = "https://api-m.sandbox.paypal.com";
const app = express();

app.set("view engine", "ejs");
app.set("views", "./server/views");

// host static files
app.use(express.static("client"));

// parse post params sent in body in json format
app.use(express.json());

/**
 * Generate an OAuth 2.0 access token for authenticating with PayPal REST APIs.
 * @see https://developer.paypal.com/api/rest/authentication/
 */
const authenticate = async (bodyParams) => {
  const params = {
    grant_type: "client_credentials",
    response_type: "id_token",
    ...bodyParams,
  };

  // pass the url encoded value as the body of the post call
  const urlEncodedParams = new URLSearchParams(params).toString();
  try {
    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
      throw new Error("MISSING_API_CREDENTIALS");
    }
    const auth = Buffer.from(
      PAYPAL_CLIENT_ID + ":" + PAYPAL_CLIENT_SECRET,
    ).toString("base64");

    const response = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      body: urlEncodedParams,
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });
    return handleResponse(response);
  } catch (error) {
    console.error("Failed to generate Access Token:", error);
  }
};

const generateAccessToken = async () => {
  const { jsonResponse } = await authenticate();
  return jsonResponse.access_token;
};

/**
 * Create an order to start the transaction.
 * @see https://developer.paypal.com/docs/api/orders/v2/#orders_create
 */
const createOrder = async (cart) => {
  // use the cart information passed from the front-end to calculate the purchase unit details
  console.log(
    "shopping cart information passed from the frontend createOrder() callback:",
    cart,
  );

  const accessToken = await generateAccessToken();
  const url = `${base}/v2/checkout/orders`;
  const payload = {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: {
          currency_code: "USD",
          value: "110.00",
        },
      },
    ],
    payment_source: {
      paypal: {
        attributes: {
          vault: {
            store_in_vault: "ON_SUCCESS",
            usage_type: "MERCHANT",
            customer_type: "CONSUMER",
          },
        },
        experience_context: {
          return_url: "http://example.com",
          cancel_url: "http://example.com",
          shipping_preference: "NO_SHIPPING",
        },
      },
    },
  };

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      // Uncomment one of these to force an error for negative testing (in sandbox mode only). Documentation:
      // https://developer.paypal.com/tools/sandbox/negative-testing/request-headers/
      // "PayPal-Mock-Response": '{"mock_application_codes": "MISSING_REQUIRED_PARAMETER"}'
      // "PayPal-Mock-Response": '{"mock_application_codes": "PERMISSION_DENIED"}'
      // "PayPal-Mock-Response": '{"mock_application_codes": "INTERNAL_SERVER_ERROR"}'
    },
    method: "POST",
    body: JSON.stringify(payload),
  });

  return handleResponse(response);
};

/**
 * Capture payment for the created order to complete the transaction.
 * @see https://developer.paypal.com/docs/api/orders/v2/#orders_capture
 */
const captureOrder = async (orderID) => {
  const accessToken = await generateAccessToken();
  const url = `${base}/v2/checkout/orders/${orderID}/capture`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      // Uncomment one of these to force an error for negative testing (in sandbox mode only). Documentation:
      // https://developer.paypal.com/tools/sandbox/negative-testing/request-headers/
      // "PayPal-Mock-Response": '{"mock_application_codes": "INSTRUMENT_DECLINED"}'
      // "PayPal-Mock-Response": '{"mock_application_codes": "TRANSACTION_REFUSED"}'
      // "PayPal-Mock-Response": '{"mock_application_codes": "INTERNAL_SERVER_ERROR"}'
    },
  });

  return handleResponse(response);
};

async function handleResponse(response) {
  try {
    const jsonResponse = await response.json();
    return {
      jsonResponse,
      httpStatusCode: response.status,
    };
  } catch (err) {
    const errorMessage = await response.text();
    throw new Error(errorMessage);
  }
}

app.post("/api/orders", async (req, res) => {
  try {
    // use the cart information passed from the front-end to calculate the order amount detals
    const { cart } = req.body;
    const { jsonResponse, httpStatusCode } = await createOrder(cart);
    res.status(httpStatusCode).json(jsonResponse);
  } catch (error) {
    console.error("Failed to create order:", error);
    res.status(500).json({ error: "Failed to create order." });
  }
});

app.post("/api/orders/:orderID/capture", async (req, res) => {
  try {
    const { orderID } = req.params;
    const { jsonResponse, httpStatusCode } = await captureOrder(orderID);
    console.log("capture response", jsonResponse);
    res.status(httpStatusCode).json(jsonResponse);
  } catch (error) {
    console.error("Failed to create order:", error);
    res.status(500).json({ error: "Failed to capture order." });
  }
});

// render checkout page with client id & user id token
app.get("/", async (req, res) => {
  try {
    const { jsonResponse } = await authenticate({
      target_customer_id: req.query.customerID,
    });
    res.render("checkout", {
      clientId: PAYPAL_CLIENT_ID,
      userIdToken: jsonResponse.id_token,
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

const LOG_PATH = "./data/log.json";

const RULES = {
  maxPerItemCents: 10,
  dailyBudgetCents: 200,
  approvedSites: ["fair", "greedy"],
};

function readLog() {
  try {
    return JSON.parse(fs.readFileSync(LOG_PATH, "utf8"));
  } catch {
    return [];
  }
}

function appendLog(entry) {
  const log = readLog();
  log.push(entry);
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

function spentTodayCents() {
  const today = new Date().toISOString().slice(0, 10);
  return readLog()
    .filter((e) => e.decision === "paid" && e.reason === "Within all rules" && e.time.startsWith(today))
    .reduce((sum, e) => sum + e.priceCents, 0);
}

const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;

function checkRules({ site, priceCents }) {
  if (!RULES.approvedSites.includes(site)) {
    return { allowed: false, reason: `Site "${site}" is not on the approved list` };
  }
  if (priceCents > RULES.maxPerItemCents) {
    return {
      allowed: false,
      reason: `Price ${dollars(priceCents)} exceeds per-item limit of ${dollars(RULES.maxPerItemCents)}`,
    };
  }
  const spent = spentTodayCents();
  if (spent + priceCents > RULES.dailyBudgetCents) {
    return {
      allowed: false,
      reason: `Would exceed daily budget: ${dollars(spent)} of ${dollars(RULES.dailyBudgetCents)} already spent`,
    };
  }
  return { allowed: true };
}

async function chargeVault(amount) {
  const accessToken = await generateAccessToken();
  const response = await fetch(`${base}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "PayPal-Request-Id": `charge-${Date.now()}`,
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "USD", value: amount } }],
      payment_source: { paypal: { vault_id: process.env.PAYPAL_VAULT_ID } },
    }),
  });
  const data = await response.json();
  const captureId = data?.purchase_units?.[0]?.payments?.captures?.[0]?.id;
  return { ok: data.status === "COMPLETED" && !!captureId, status: data.status, captureId };
}

const PENDING_PATH = "./data/pending.json";

function readPending() {
  try {
    return JSON.parse(fs.readFileSync(PENDING_PATH, "utf8"));
  } catch {
    return [];
  }
}

function writePending(list) {
  fs.writeFileSync(PENDING_PATH, JSON.stringify(list, null, 2));
}

app.post("/api/pay", async (req, res) => {
  const { site, price, description } = req.body ?? {};
  const priceCents = Math.round(Number(price) * 100);
  if (!site || !Number.isFinite(priceCents) || priceCents <= 0) {
    return res.status(400).json({ error: "Need a site and a positive price" });
  }

  const entry = {
    time: new Date().toISOString(),
    site,
    description,
    price: (priceCents / 100).toFixed(2),
    priceCents,
  };

  const check = checkRules({ site, priceCents });
    if (!check.allowed) {
    const request = { id: `req-${Date.now()}`, ...entry, reason: check.reason, status: "pending" };
    const pending = readPending();
    pending.push(request);
    writePending(pending);
    appendLog({ ...entry, decision: "needs approval", reason: check.reason, requestId: request.id });
    console.log(`PENDING ${site} ${entry.price}: ${check.reason} (${request.id})`);
    return res.status(202).json({ decision: "pending", requestId: request.id, reason: check.reason });
  }

  try {
    const result = await chargeVault(entry.price);
    if (!result.ok) {
      appendLog({ ...entry, decision: "failed", reason: `PayPal status ${result.status}` });
      return res.status(502).json({ decision: "failed", reason: `PayPal status ${result.status}` });
    }
    appendLog({ ...entry, decision: "paid", reason: "Within all rules", captureId: result.captureId });
    console.log(`PAID ${site} ${entry.price}: ${result.captureId}`);
    res.json({ decision: "paid", captureId: result.captureId });
  } catch (err) {
    console.error("Pay failed:", err);
    appendLog({ ...entry, decision: "failed", reason: err.message });
    res.status(500).json({ decision: "failed", reason: err.message });
  }
});

app.get("/api/requests", (req, res) => {
  res.json(readPending());
});

app.get("/api/requests/:id", (req, res) => {
  const request = readPending().find((r) => r.id === req.params.id);
  if (!request) return res.status(404).json({ error: "No such request" });
  res.json(request);
});

app.post("/api/requests/:id/:action", async (req, res) => {
  const { id, action } = req.params;
  if (!["approve", "deny"].includes(action)) {
    return res.status(400).json({ error: "Action must be approve or deny" });
  }
  const pending = readPending();
  const request = pending.find((r) => r.id === id);
  if (!request) return res.status(404).json({ error: "No such request" });
  if (request.status !== "pending") {
    return res.status(409).json({ error: `Already ${request.status}` });
  }

  const base = {
    time: new Date().toISOString(),
    site: request.site,
    description: request.description,
    price: request.price,
    priceCents: request.priceCents,
    requestId: id,
  };

  if (action === "deny") {
    request.status = "denied";
    writePending(pending);
    appendLog({ ...base, decision: "denied", reason: "Owner denied" });
    console.log(`DENIED ${request.site} ${request.price} (${id})`);
    return res.json(request);
  }

  request.status = "charging";
  writePending(pending);
  try {
    const result = await chargeVault(request.price);
    if (!result.ok) {
      request.status = "failed";
      writePending(pending);
      appendLog({ ...base, decision: "failed", reason: `PayPal status ${result.status}` });
      return res.status(502).json(request);
    }
    request.status = "approved";
    request.captureId = result.captureId;
    writePending(pending);
    appendLog({ ...base, decision: "paid", reason: "Approved by owner", captureId: result.captureId });
    console.log(`APPROVED ${request.site} ${request.price}: ${result.captureId}`);
    res.json(request);
  } catch (err) {
    request.status = "failed";
    writePending(pending);
    appendLog({ ...base, decision: "failed", reason: err.message });
    res.status(500).json(request);
  }
});

app.listen(PORT, () => {
  console.log(`Node server listening at http://localhost:${PORT}/`);
});
