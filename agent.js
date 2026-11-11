import fetch from "node-fetch";

const PAYWALL = "http://localhost:9000";
const GUARD = "http://localhost:8888";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TASK = "Research how AI agents pay for online content";

async function waitForDecision(requestId) {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${GUARD}/api/requests/${requestId}`);
    const request = await res.json();
    if (request.status !== "pending" && request.status !== "charging") {
      return request;
    }
    await sleep(2000);
  }
  return { status: "timed out" };
}

async function getArticle(site) {
  const url = `${PAYWALL}/${site}/article`;
  console.log(`\n=== Agent wants: ${url}`);

  let res = await fetch(url);
  if (res.status !== 402) {
    console.log("No payment needed:", await res.json());
    return;
  }

  const { offer } = await res.json();
  console.log(`402 Payment Required: ${offer.seller} wants $${offer.price} for "${offer.description}"`);

  const payRes = await fetch(`${GUARD}/api/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      site: offer.site,
      price: offer.price,
      description: offer.description,
    }),
  });
  const pay = await payRes.json();

  let captureId;
  if (pay.decision === "paid") {
    captureId = pay.captureId;
    console.log(`Guard paid automatically. Capture ID: ${captureId}`);
  }
  } else if (pay.decision === "skipped") {
    console.log(`AI advisor skipped it: ${pay.reason}`);
    return;
   else if (pay.decision === "pending") {
    console.log(`Guard paused this: ${pay.reason}`);
    console.log(`Waiting for owner at ${GUARD}/approvals.html ...`);
    const final = await waitForDecision(pay.requestId);
    if (final.status !== "approved") {
      console.log(`Owner decision: ${final.status}. Skipping this article.`);
      return;
    }
    captureId = final.captureId;
    console.log(`Owner approved. Capture ID: ${captureId}`);
  } else {
    console.log(`Guard refused: ${pay.reason || pay.error}`);
    return;
  }

  res = await fetch(url, { headers: { "X-Payment-Proof": captureId } });
  const body = await res.json();
  console.log(`Paywall answered ${res.status}:`, body);
}

for (const site of ["fair", "greedy"]) {
  await getArticle(site);
}