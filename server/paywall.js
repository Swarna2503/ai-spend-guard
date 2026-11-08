import express from "express";

const app = express();
const PORT = 9000;

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

app.get("/:site/article", (req, res) => {
  const site = sites[req.params.site];
  if (!site) {
    return res.status(404).json({ error: "Unknown site" });
  }

  const proof = req.get("X-Payment-Proof");
  if (!proof) {
    return res.status(402).json({
      error: "Payment Required",
      offer: {
        site: req.params.site,
        price: site.price,
        currency: "USD",
        description: site.description,
        seller: site.seller,
      },
    });
  }

  res.json({
    content: `Full article from ${site.seller}. Thanks for paying!`,
    paidWith: proof,
  });
});

app.listen(PORT, () => {
  console.log(`Paywall running on http://localhost:${PORT}`);
});