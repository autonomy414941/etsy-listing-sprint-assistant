export type ListingTone = "playful" | "minimal" | "luxury" | "warm";

export type ListingInput = {
  shopName: string;
  productType: string;
  targetAudience: string;
  primaryKeyword: string;
  supportingKeywords: string[];
  materials: string[];
  tone: ListingTone;
  priceBand: string;
  processingTimeDays: number;
  personalization: boolean;
  includeUkSpelling: boolean;
};

export type ListingPack = {
  generatedAt: string;
  score: number;
  title: string;
  tags: string[];
  highlights: string[];
  description: string;
  faq: Array<{ question: string; answer: string }>;
  photoShotList: string[];
  launchChecklist: string[];
};

const MAX_KEYWORDS = 16;
const MAX_MATERIALS = 12;
const MAX_TAGS = 13;
const MAX_TITLE_LENGTH = 140;

function normalizePhrase(value: string, key: string, maxLength = 80): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > maxLength) {
    throw new Error(`invalid_${key}`);
  }
  return trimmed;
}

function normalizeKeyword(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9&\-\s]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBoolean(value: boolean): boolean {
  return value === true;
}

function normalizeDays(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 45) {
    throw new Error("invalid_processingTimeDays");
  }
  return value;
}

function normalizeTone(value: string): ListingTone {
  const tone = value.trim().toLowerCase();
  if (tone === "playful" || tone === "minimal" || tone === "luxury" || tone === "warm") {
    return tone;
  }
  throw new Error("invalid_tone");
}

function dedupePhrases(values: string[], maxCount: number, key: string): string[] {
  if (!Array.isArray(values)) {
    throw new Error(`invalid_${key}`);
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      throw new Error(`invalid_${key}`);
    }
    const normalized = normalizeKeyword(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxCount) {
      break;
    }
  }

  return result;
}

function compactTitle(parts: string[]): string {
  const filtered = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  let title = "";
  for (const part of filtered) {
    const candidate = title ? `${title} | ${part}` : part;
    if (candidate.length > MAX_TITLE_LENGTH) {
      break;
    }
    title = candidate;
  }

  return title || filtered[0] || "Etsy listing";
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function pushTag(tags: string[], candidate: string): void {
  const normalized = normalizeKeyword(candidate);
  if (!normalized) {
    return;
  }
  if (normalized.length > 20) {
    return;
  }
  if (tags.includes(normalized)) {
    return;
  }
  if (tags.length >= MAX_TAGS) {
    return;
  }
  tags.push(normalized);
}

function buildTags(input: ListingInput): string[] {
  const tags: string[] = [];

  const basePool = [
    input.primaryKeyword,
    ...input.supportingKeywords,
    `${input.productType} gift`,
    `${input.targetAudience} gift`,
    input.productType,
    input.targetAudience,
    input.personalization ? "personalized gift" : "ready to ship",
    "etsy seller"
  ];

  for (const phrase of basePool) {
    pushTag(tags, phrase);
  }

  const words = input.primaryKeyword.split(" ").filter((word) => word.length >= 3);
  for (const word of words) {
    pushTag(tags, word);
    pushTag(tags, `${word} decor`);
    pushTag(tags, `${word} idea`);
  }

  const fallback = [
    "small business",
    "handmade",
    "gift for her",
    "gift for him",
    "home decor",
    "custom order"
  ];

  for (const phrase of fallback) {
    pushTag(tags, phrase);
  }

  return tags.slice(0, MAX_TAGS);
}

function toneLine(tone: ListingTone): string {
  if (tone === "playful") {
    return "written with energetic, friendly language and quick-read rhythm";
  }
  if (tone === "minimal") {
    return "kept clean, concise, and practical for fast scanning";
  }
  if (tone === "luxury") {
    return "framed with premium cues and elevated craftsmanship language";
  }
  return "balanced for warmth, clarity, and trust";
}

function britishSpelling(value: string, enabled: boolean): string {
  if (!enabled) {
    return value;
  }
  return value
    .replace(/color/gi, "colour")
    .replace(/favorite/gi, "favourite")
    .replace(/customization/gi, "customisation")
    .replace(/personalization/gi, "personalisation")
    .replace(/organize/gi, "organise");
}

function roundScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function sanitizeListingInput(input: ListingInput): ListingInput {
  const shopName = normalizePhrase(input.shopName, "shopName", 80);
  const productType = normalizePhrase(input.productType, "productType", 80).toLowerCase();
  const targetAudience = normalizePhrase(input.targetAudience, "targetAudience", 80).toLowerCase();
  const primaryKeyword = normalizeKeyword(normalizePhrase(input.primaryKeyword, "primaryKeyword", 80));
  if (!primaryKeyword) {
    throw new Error("invalid_primaryKeyword");
  }

  const supportingKeywords = dedupePhrases(input.supportingKeywords, MAX_KEYWORDS, "supportingKeywords");
  if (!supportingKeywords.length) {
    throw new Error("invalid_supportingKeywords");
  }

  const materials = dedupePhrases(input.materials, MAX_MATERIALS, "materials");
  const tone = normalizeTone(input.tone);
  const priceBand = normalizePhrase(input.priceBand, "priceBand", 80);
  const processingTimeDays = normalizeDays(input.processingTimeDays);
  const personalization = normalizeBoolean(input.personalization);
  const includeUkSpelling = normalizeBoolean(input.includeUkSpelling);

  return {
    shopName,
    productType,
    targetAudience,
    primaryKeyword,
    supportingKeywords,
    materials,
    tone,
    priceBand,
    processingTimeDays,
    personalization,
    includeUkSpelling
  };
}

export function parseKeywordCsv(csvText: string): string[] {
  if (typeof csvText !== "string") {
    throw new Error("invalid_keywordsCsv");
  }

  const values = csvText
    .split(/[\n,]/g)
    .map((value) => normalizeKeyword(value))
    .filter((value) => value.length > 0);

  if (!values.length) {
    throw new Error("invalid_keywordsCsv");
  }

  return dedupePhrases(values, MAX_KEYWORDS, "supportingKeywords");
}

export function parseMaterialsCsv(csvText: string): string[] {
  if (typeof csvText !== "string") {
    throw new Error("invalid_materialsCsv");
  }

  const values = csvText
    .split(/[\n,]/g)
    .map((value) => normalizeKeyword(value))
    .filter((value) => value.length > 0);

  return dedupePhrases(values, MAX_MATERIALS, "materials");
}

export function buildListingPack(input: ListingInput): ListingPack {
  const title = compactTitle([
    toTitleCase(input.primaryKeyword),
    toTitleCase(input.productType),
    input.personalization ? "Personalized" : "Ready to Ship",
    `Gift for ${toTitleCase(input.targetAudience)}`,
    toTitleCase(input.supportingKeywords[0] || "Etsy Bestseller")
  ]);

  const tags = buildTags(input);
  const toneDescriptor = toneLine(input.tone);
  const materialsLine = input.materials.length
    ? `Materials include ${input.materials.slice(0, 5).join(", ")}.`
    : "Materials are selected for durability and consistent finish.";

  const baseDescription = [
    `${toTitleCase(input.primaryKeyword)} from ${input.shopName} is built for ${input.targetAudience} buyers searching Etsy for a fast yes/no purchase decision.`,
    `The copy is ${toneDescriptor}, with a ${input.priceBand} price anchor and ${input.processingTimeDays}-day processing promise.`,
    materialsLine,
    input.personalization
      ? "Personalization is highlighted in the first fold so buyers know exactly what can be customized before checkout."
      : "The listing emphasizes ready-to-ship speed to reduce hesitation and increase conversion from search traffic.",
    "Use the photo order and FAQ below as-is to keep listing production under 15 minutes."
  ].join(" ");

  const description = britishSpelling(baseDescription, input.includeUkSpelling);

  const highlights = [
    `${toTitleCase(input.primaryKeyword)} headline tuned for Etsy search intent`,
    `${tags.length} tags included with <=20 character constraint respected`,
    `Tone set to ${input.tone} for consistent brand voice`,
    `${input.processingTimeDays}-day processing expectation placed above the fold`,
    input.personalization ? "Personalization CTA included in title and FAQ" : "Fast dispatch angle included in title and FAQ"
  ].map((line) => britishSpelling(line, input.includeUkSpelling));

  const faq = [
    {
      question: "How quickly can this order ship?",
      answer: britishSpelling(
        `Standard processing is ${input.processingTimeDays} day${input.processingTimeDays === 1 ? "" : "s"}. Rush requests can be discussed in messages before purchase.`,
        input.includeUkSpelling
      )
    },
    {
      question: input.personalization ? "What personalization can I request?" : "Can I request a custom variation?",
      answer: britishSpelling(
        input.personalization
          ? "Include names, dates, or short text in the personalization field. A preview can be requested before production."
          : "Yes. Message the shop before checkout with size, color, or packaging requests and we will confirm availability.",
        input.includeUkSpelling
      )
    },
    {
      question: "What should I include in my first product photo?",
      answer: britishSpelling(
        `Lead with a clean hero shot of the ${input.productType}, then show scale, materials, and one lifestyle image for ${input.targetAudience}.`,
        input.includeUkSpelling
      )
    }
  ];

  const photoShotList = [
    `${toTitleCase(input.productType)} on plain background (hero image)`,
    "Close-up detail of texture and finish",
    input.personalization ? "Personalized sample with realistic name/date" : "Ready-to-ship packaging and dispatch view",
    "Scale reference in hand or beside common object",
    `${toTitleCase(input.targetAudience)} lifestyle context shot`,
    input.materials.length ? `Materials flat lay: ${input.materials.slice(0, 4).join(", ")}` : "Materials and components flat lay",
    "Color or variation comparison grid",
    "Gift-ready final presentation"
  ].map((line) => britishSpelling(line, input.includeUkSpelling));

  const launchChecklist = [
    "Upload all 8 photos before publishing",
    "Keep first 40 title characters keyword-dense",
    "Place shipping timeline in description paragraph 1",
    "Pin one buyer FAQ in shop announcement",
    "Track clicks and favorites after 24 hours"
  ].map((line) => britishSpelling(line, input.includeUkSpelling));

  let score = 55;
  score += Math.min(20, tags.length);
  score += Math.min(8, input.supportingKeywords.length);
  score += input.personalization ? 7 : 4;
  score += input.materials.length >= 3 ? 6 : 2;
  score += input.processingTimeDays <= 3 ? 4 : 1;

  return {
    generatedAt: new Date().toISOString(),
    score: roundScore(score),
    title: britishSpelling(title, input.includeUkSpelling),
    tags,
    highlights,
    description,
    faq,
    photoShotList,
    launchChecklist
  };
}
