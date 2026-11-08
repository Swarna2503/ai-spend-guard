import fetch from "node-fetch";

const PAYWALL = "http://localhost:9000";
const GUARD = "http://localhost:8888";

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

  if (pay.decision !== "paid") {
    console.log(`Guard said NO: ${pay.reason}`);
    return;
  }
  console.log(`Guard paid. Capture ID: ${pay.captureId}`);

  res = await fetch(url, { headers: { "X-Payment-Proof": pay.captureId } });
  const body = await res.json();
  console.log(`Paywall answered ${res.status}:`, body);
}

for (const site of ["fair", "greedy"]) {
  await getArticle(site);
}