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

const packSummary = document.querySelector("#pack-summary");
const titleEl = document.querySelector("#result-title");
const tagsEl = document.querySelector("#result-tags");
const highlightsEl = document.querySelector("#result-highlights");
const descriptionEl = document.querySelector("#result-description");
const photosEl = document.querySelector("#result-photos");
const exportContent = document.querySelector("#export-content");

const query = new URLSearchParams(window.location.search);
const source = query.get("source") || "web";
const selfTest = ["1", "true", "yes"].includes((query.get("selfTest") || "").toLowerCase());

let currentSessionId = null;
let checkoutUrl = null;
let unlocked = false;

function setStatus(target, message, tone = "neutral") {
  target.textContent = message;
  target.dataset.tone = tone;
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

function renderPack(pack) {
  packSummary.textContent = `Score ${pack.score}/100 · ${pack.tags.length} tags · Generated ${new Date(pack.generatedAt).toLocaleString()}`;
  titleEl.textContent = pack.title;
  descriptionEl.textContent = pack.description;
  renderList(tagsEl, pack.tags, true);
  renderList(highlightsEl, pack.highlights);
  renderList(photosEl, pack.photoShotList);
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

listingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  generateBtn.disabled = true;
  setStatus(listingStatus, "Generating listing pack...", "neutral");

  try {
    const payload = collectGeneratePayload();
    const data = await jsonRequest("/api/listings/generate", payload);

    currentSessionId = data.sessionId;
    checkoutUrl = data?.paywall?.paymentUrl || null;
    unlocked = false;
    exportBtn.disabled = true;

    renderPack(data.pack);
    packResult.classList.remove("hidden");
    paymentSection.classList.remove("hidden");
    exportSection.classList.add("hidden");

    setStatus(listingStatus, "Pack ready. Complete checkout to unlock export.", "ok");
    setStatus(paymentStatus, "Checkout is ready.", "neutral");
  } catch (error) {
    setStatus(listingStatus, `Could not generate pack: ${error.message}`, "error");
  } finally {
    generateBtn.disabled = false;
  }
});

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
