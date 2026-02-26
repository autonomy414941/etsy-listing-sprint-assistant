import test from "node:test";
import assert from "node:assert/strict";
import { buildListingPack, parseKeywordCsv, sanitizeListingInput } from "./listing.js";

test("parseKeywordCsv splits by comma and newline", () => {
  const keywords = parseKeywordCsv("wedding gift, bridesmaid gift\nhandmade box");
  assert.deepEqual(keywords.slice(0, 3), ["wedding gift", "bridesmaid gift", "handmade box"]);
});

test("buildListingPack creates Etsy-safe title and 13 tags max", () => {
  const input = sanitizeListingInput({
    shopName: "Copper Pine Studio",
    productType: "ring dish",
    targetAudience: "bridal party",
    primaryKeyword: "personalized ring dish",
    supportingKeywords: ["engagement gift", "bridal shower gift", "ceramic tray"],
    materials: ["ceramic", "glaze", "gold paint"],
    tone: "warm",
    priceBand: "$20-$35",
    processingTimeDays: 3,
    personalization: true,
    includeUkSpelling: false
  });

  const pack = buildListingPack(input);

  assert.ok(pack.title.length <= 140);
  assert.ok(pack.tags.length <= 13);
  assert.ok(pack.tags.every((tag) => tag.length <= 20));
  assert.ok(pack.score >= 0 && pack.score <= 100);
});

test("sanitizeListingInput rejects missing supporting keywords", () => {
  assert.throws(
    () =>
      sanitizeListingInput({
        shopName: "Northwind",
        productType: "print",
        targetAudience: "pet owners",
        primaryKeyword: "dog memorial print",
        supportingKeywords: [],
        materials: [],
        tone: "minimal",
        priceBand: "$10-$20",
        processingTimeDays: 4,
        personalization: false,
        includeUkSpelling: false
      }),
    /invalid_supportingKeywords/
  );
});
