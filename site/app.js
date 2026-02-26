const listingForm = document.querySelector("#listing-form");
const proofForm = document.querySelector("#proof-form");
const listingStatus = document.querySelector("#listing-status");
const paymentStatus = document.querySelector("#payment-status");
const generateBtn = document.querySelector("#generate-btn");
const checkoutBtn = document.querySelector("#checkout-btn");
const proofBtn = document.querySelector("#proof-btn");
const exportBtn = document.querySelector("#export-btn");
const packResult = document.querySelector("#pack-result");
const paymentSection = document.querySelector("#payment-section");
const exportSection = document.querySelector("#export-section");
const quickPresetButtons = Array.from(document.querySelectorAll(".quick-preset-btn"));

const packSummary = document.querySelector("#pack-summary");
const previewGateNote = document.querySelector("#preview-gate-note");
const titleEl = document.querySelector("#result-title");
const tagsEl = document.querySelector("#result-tags");
const highlightsEl = document.querySelector("#result-highlights");
const descriptionEl = document.querySelector("#result-description");
const photosEl = document.querySelector("#result-photos");
const exportContent = document.querySelector("#export-content");

const query = new URLSearchParams(window.location.search);
const source = query.get("source") || "web";
const selfTest = ["1", "true", "yes"].includes((query.get("selfTest") || "").toLowerCase());
const AUTO_PREVIEW_STORAGE_KEY = "etsy-listing-sprint-assistant.auto_preview_v1";
const AUTO_PREVIEW_SAMPLE = {
  shopName: "Demo Craft Studio",
  productType: "Minimalist ceramic ring dish",
  targetAudience: "bridal party gift buyers",
  primaryKeyword: "personalized ring dish",
  supportingKeywordsCsv: "bridesmaid gift, engagement gift, jewelry tray",
  materialsCsv: "ceramic, glaze, gold paint",
  tone: "warm",
  priceBand: "$22-$38",
  processingTimeDays: 4,
  personalization: true,
  includeUkSpelling: false
};
const QUICK_PRESETS = {
  bridal: {
    shopName: "Luna Keepsakes",
    productType: "Personalized ring dish",
    targetAudience: "bridal party gifts",
    primaryKeyword: "bridesmaid ring dish",
    supportingKeywordsCsv: "engagement gift, wedding keepsake, ceramic jewelry tray",
    materialsCsv: "ceramic, glaze, gold paint",
    tone: "warm",
    priceBand: "$18-$34",
    processingTimeDays: 3,
    personalization: true,
    includeUkSpelling: false
  },
  pet: {
    shopName: "North Pine Prints",
    productType: "Dog memorial print",
    targetAudience: "pet loss gifts",
    primaryKeyword: "pet memorial print",
    supportingKeywordsCsv: "dog loss gift, remembrance art, sympathy gift",
    materialsCsv: "matte paper, archival ink",
    tone: "minimal",
    priceBand: "$24-$42",
    processingTimeDays: 2,
    personalization: true,
    includeUkSpelling: false
  },
  digital: {
    shopName: "Bloom Daily Studio",
    productType: "Undated digital planner",
    targetAudience: "busy professionals",
    primaryKeyword: "digital planner template",
    supportingKeywordsCsv: "notion planner, productivity download, printable planner",
    materialsCsv: "",
    tone: "playful",
    priceBand: "$9-$19",
    processingTimeDays: 1,
    personalization: false,
    includeUkSpelling: false
  },
  home: {
    shopName: "Oakline Home",
    productType: "Linen cushion cover",
    targetAudience: "modern home decor buyers",
    primaryKeyword: "neutral cushion cover",
    supportingKeywordsCsv: "farmhouse decor, throw pillow case, living room decor",
    materialsCsv: "linen, cotton blend",
    tone: "luxury",
    priceBand: "$28-$49",
    processingTimeDays: 4,
    personalization: false,
    includeUkSpelling: false
  }
};

let currentSessionId = null;
let checkoutUrl = null;
let unlocked = false;

function setStatus(target, message, tone = "neutral") {
  target.textContent = message;
  target.dataset.tone = tone;
}

function setQuickPresetsDisabled(disabled) {
  for (const button of quickPresetButtons) {
    button.disabled = disabled;
  }
}

function setFormValue(name, value) {
  const field = listingForm.querySelector(`[name="${name}"]`);
  if (!field) {
    return;
  }

  if (field instanceof HTMLInputElement) {
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
      return;
    }
    field.value = value == null ? "" : String(value);
    return;
  }

  if (field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
    field.value = value == null ? "" : String(value);
  }
}

function applyQuickPreset(preset) {
  for (const [key, value] of Object.entries(preset)) {
    setFormValue(key, value);
  }
}

function collectGeneratePayload() {
  const formData = new FormData(listingForm);
  return {
    shopName: String(formData.get("shopName") || "").trim(),
    productType: String(formData.get("productType") || "").trim(),
    targetAudience: String(formData.get("targetAudience") || "").trim(),
    primaryKeyword: String(formData.get("primaryKeyword") || "").trim(),
    supportingKeywordsCsv: String(formData.get("supportingKeywordsCsv") || "").trim(),
    materialsCsv: String(formData.get("materialsCsv") || "").trim(),
    tone: String(formData.get("tone") || "warm"),
    priceBand: String(formData.get("priceBand") || "$20-$45").trim(),
    processingTimeDays: Number(formData.get("processingTimeDays") || 3),
    personalization: formData.get("personalization") === "on",
    includeUkSpelling: formData.get("includeUkSpelling") === "on",
    source,
    selfTest
  };
}

function hasCompletedAutoPreview() {
  try {
    return Boolean(window.localStorage.getItem(AUTO_PREVIEW_STORAGE_KEY));
  } catch {
    return false;
  }
}

function markAutoPreviewCompleted() {
  try {
    window.localStorage.setItem(AUTO_PREVIEW_STORAGE_KEY, new Date().toISOString());
  } catch {
    // Ignore browsers where localStorage is blocked.
  }
}

function shouldRunAutoPreview() {
  if (selfTest) {
    return false;
  }

  const previewFlag = (query.get("preview") || "").trim().toLowerCase();
  if (previewFlag === "off" || previewFlag === "0") {
    return false;
  }

  return !hasCompletedAutoPreview();
}

function renderList(target, rows, asChips = false) {
  target.innerHTML = "";
  for (const row of rows) {
    const item = document.createElement("li");
    item.textContent = row;
    if (asChips) {
      item.className = "chip";
    }
    target.appendChild(item);
  }
}

function toPositiveCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function renderPreviewGate(preview) {
  if (!previewGateNote) {
    return;
  }

  if (!preview || preview.limited !== true) {
    previewGateNote.textContent = "";
    previewGateNote.classList.add("hidden");
    return;
  }

  const hidden = preview.hiddenCounts && typeof preview.hiddenCounts === "object" ? preview.hiddenCounts : {};
  const hiddenParts = [];
  const hiddenTags = toPositiveCount(hidden.tags);
  const hiddenHighlights = toPositiveCount(hidden.highlights);
  const hiddenFaq = toPositiveCount(hidden.faq);
  const hiddenPhotos = toPositiveCount(hidden.photoShotList);
  const hiddenChecklist = toPositiveCount(hidden.launchChecklist);

  if (hiddenTags > 0) {
    hiddenParts.push(`${hiddenTags} tags`);
  }
  if (hiddenHighlights > 0) {
    hiddenParts.push(`${hiddenHighlights} highlights`);
  }
  if (hiddenFaq > 0) {
    hiddenParts.push(`${hiddenFaq} FAQ answers`);
  }
  if (hiddenPhotos > 0) {
    hiddenParts.push(`${hiddenPhotos} photo steps`);
  }
  if (hiddenChecklist > 0) {
    hiddenParts.push(`${hiddenChecklist} checklist items`);
  }

  const summary = hiddenParts.length
    ? `Limited preview shown (${hiddenParts.join(", ")} locked).`
    : "Limited preview shown.";
  const lockMessage =
    typeof preview.lockMessage === "string" && preview.lockMessage.trim().length > 0
      ? preview.lockMessage.trim()
      : "Checkout unlocks the full listing pack.";

  previewGateNote.textContent = `${summary} ${lockMessage}`;
  previewGateNote.classList.remove("hidden");
}

function renderPack(pack, preview) {
  const tagCount = Array.isArray(pack.tags) ? pack.tags.length : 0;
  packSummary.textContent = `Score ${pack.score}/100 · ${tagCount} visible tags · Generated ${new Date(pack.generatedAt).toLocaleString()}`;
  titleEl.textContent = pack.title;
  descriptionEl.textContent = pack.description;
  renderList(tagsEl, pack.tags, true);
  renderList(highlightsEl, pack.highlights);
  renderList(photosEl, pack.photoShotList);
  renderPreviewGate(preview);
}

function lockExport() {
  unlocked = false;
  exportBtn.disabled = true;
  exportSection.classList.add("hidden");
  exportContent.textContent = "";
}

async function jsonRequest(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = data && typeof data.error === "string" ? data.error : `http_${response.status}`;
    throw new Error(code);
  }

  return data;
}

async function generatePack(payload, { autoPreview = false } = {}) {
  const data = await jsonRequest("/api/listings/generate", payload);

  currentSessionId = data.sessionId;
  checkoutUrl = data?.paywall?.paymentUrl || null;
  lockExport();

  renderPack(data.pack, data.preview);
  packResult.classList.remove("hidden");

  if (autoPreview) {
    paymentSection.classList.add("hidden");
    setStatus(
      listingStatus,
      "Instant sample preview is ready (limited). Replace inputs and click Generate Pack for your listing.",
      "ok"
    );
    setStatus(paymentStatus, "Checkout appears after you generate your own listing pack.", "neutral");
    return;
  }

  paymentSection.classList.remove("hidden");
  setStatus(listingStatus, "Preview ready. Complete checkout to unlock full pack + export.", "ok");
  setStatus(paymentStatus, "Checkout is ready to unlock the full listing pack.", "neutral");
}

async function runAutoPreview() {
  generateBtn.disabled = true;
  setQuickPresetsDisabled(true);
  setStatus(listingStatus, "Generating instant sample preview...", "neutral");
  try {
    await generatePack(
      {
        ...AUTO_PREVIEW_SAMPLE,
        source,
        selfTest,
        briefIntent: "auto_preview"
      },
      { autoPreview: true }
    );
    markAutoPreviewCompleted();
  } catch (error) {
    setStatus(listingStatus, `Could not generate instant sample preview: ${error.message}`, "error");
  } finally {
    generateBtn.disabled = false;
    setQuickPresetsDisabled(false);
  }
}

listingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  generateBtn.disabled = true;
  setQuickPresetsDisabled(true);
  setStatus(listingStatus, "Generating listing pack...", "neutral");

  try {
    const payload = {
      ...collectGeneratePayload(),
      briefIntent: "manual_submit"
    };
    await generatePack(payload);
  } catch (error) {
    setStatus(listingStatus, `Could not generate pack: ${error.message}`, "error");
  } finally {
    generateBtn.disabled = false;
    setQuickPresetsDisabled(false);
  }
});

for (const button of quickPresetButtons) {
  button.addEventListener("click", async () => {
    const presetKey = String(button.dataset.preset || "");
    const preset = QUICK_PRESETS[presetKey];
    if (!preset) {
      return;
    }

    applyQuickPreset(preset);
    generateBtn.disabled = true;
    setQuickPresetsDisabled(true);
    setStatus(listingStatus, "Generating preset listing pack...", "neutral");

    try {
      await generatePack({
        ...collectGeneratePayload(),
        briefIntent: "sample_cta"
      });
    } catch (error) {
      setStatus(listingStatus, `Could not generate preset pack: ${error.message}`, "error");
    } finally {
      generateBtn.disabled = false;
      setQuickPresetsDisabled(false);
    }
  });
}

checkoutBtn.addEventListener("click", async () => {
  if (!currentSessionId) {
    setStatus(paymentStatus, "Generate a pack first.", "error");
    return;
  }

  checkoutBtn.disabled = true;
  setStatus(paymentStatus, "Preparing checkout...", "neutral");

  try {
    const data = await jsonRequest("/api/billing/checkout", {
      sessionId: currentSessionId,
      source,
      selfTest
    });

    const url = data.paymentUrl || checkoutUrl;
    if (!url) {
      throw new Error("missing_payment_url");
    }

    window.open(url, "_blank", "noopener,noreferrer");
    setStatus(paymentStatus, "Checkout opened in a new tab. Submit proof after payment.", "ok");
  } catch (error) {
    setStatus(paymentStatus, `Checkout failed: ${error.message}`, "error");
  } finally {
    checkoutBtn.disabled = false;
  }
});

proofForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentSessionId) {
    setStatus(paymentStatus, "Generate a pack first.", "error");
    return;
  }

  proofBtn.disabled = true;
  setStatus(paymentStatus, "Submitting payment proof...", "neutral");

  try {
    const formData = new FormData(proofForm);
    await jsonRequest("/api/billing/proof", {
      sessionId: currentSessionId,
      payerEmail: String(formData.get("payerEmail") || "").trim(),
      transactionId: String(formData.get("transactionId") || "").trim(),
      evidenceUrl: String(formData.get("evidenceUrl") || "").trim(),
      note: String(formData.get("note") || "").trim(),
      source,
      selfTest
    });

    unlocked = true;
    exportBtn.disabled = false;
    setStatus(paymentStatus, "Payment proof accepted. Export is now unlocked.", "ok");
  } catch (error) {
    setStatus(paymentStatus, `Payment proof failed: ${error.message}`, "error");
  } finally {
    proofBtn.disabled = false;
  }
});

exportBtn.addEventListener("click", async () => {
  if (!currentSessionId || !unlocked) {
    setStatus(paymentStatus, "Complete payment proof first.", "error");
    return;
  }

  exportBtn.disabled = true;
  setStatus(paymentStatus, "Building export...", "neutral");

  try {
    const data = await jsonRequest("/api/listings/export", {
      sessionId: currentSessionId,
      format: "text",
      source,
      selfTest
    });

    exportContent.textContent = data.content || "";
    exportSection.classList.remove("hidden");
    setStatus(paymentStatus, "Export generated.", "ok");
  } catch (error) {
    setStatus(paymentStatus, `Export failed: ${error.message}`, "error");
  } finally {
    exportBtn.disabled = false;
  }
});

if (shouldRunAutoPreview()) {
  void runAutoPreview();
}
