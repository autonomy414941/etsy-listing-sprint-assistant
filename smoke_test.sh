#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://etsy-listing.46.225.49.219.nip.io}"

health_payload="$(curl -fsS "$BASE_URL/api/health")"
status="$(printf '%s' "$health_payload" | jq -r '.status')"
if [[ "$status" != "ok" ]]; then
  echo "health check failed: $health_payload" >&2
  exit 1
fi

generate_payload="$(curl -fsS -X POST "$BASE_URL/api/listings/generate" \
  -H 'content-type: application/json' \
  --data '{"shopName":"Self Test Studio","productType":"ceramic mug","targetAudience":"book lovers","primaryKeyword":"book lover mug","supportingKeywordsCsv":"gift for reader, cozy mug, literary gift","materialsCsv":"ceramic, glaze","tone":"warm","priceBand":"$18-$30","processingTimeDays":3,"personalization":true,"includeUkSpelling":false,"source":"smoke","selfTest":true,"briefIntent":"manual_submit"}')"

session_id="$(printf '%s' "$generate_payload" | jq -r '.sessionId')"
tag_count="$(printf '%s' "$generate_payload" | jq -r '.pack.tags | length')"
if [[ -z "$session_id" || "$session_id" == "null" || "$tag_count" -lt 5 ]]; then
  echo "generate failed: $generate_payload" >&2
  exit 1
fi

checkout_payload="$(curl -fsS -X POST "$BASE_URL/api/billing/checkout" \
  -H 'content-type: application/json' \
  --data "{\"sessionId\":\"$session_id\",\"source\":\"smoke\",\"selfTest\":true}")"

checkout_mode="$(printf '%s' "$checkout_payload" | jq -r '.checkoutMode')"
if [[ "$checkout_mode" != "payment_link" ]]; then
  echo "checkout failed: $checkout_payload" >&2
  exit 1
fi

proof_payload="$(curl -fsS -X POST "$BASE_URL/api/billing/proof" \
  -H 'content-type: application/json' \
  --data "{\"sessionId\":\"$session_id\",\"payerEmail\":\"selftest@example.com\",\"transactionId\":\"smoke-$(date +%s)\",\"source\":\"smoke\",\"selfTest\":true}")"

proof_status="$(printf '%s' "$proof_payload" | jq -r '.status')"
if [[ "$proof_status" != "accepted" ]]; then
  echo "proof failed: $proof_payload" >&2
  exit 1
fi

export_payload="$(curl -fsS -X POST "$BASE_URL/api/listings/export" \
  -H 'content-type: application/json' \
  --data "{\"sessionId\":\"$session_id\",\"format\":\"text\",\"source\":\"smoke\",\"selfTest\":true}")"

export_file="$(printf '%s' "$export_payload" | jq -r '.fileName')"
if [[ -z "$export_file" || "$export_file" == "null" ]]; then
  echo "export failed: $export_payload" >&2
  exit 1
fi

metrics_payload="$(curl -fsS "$BASE_URL/api/metrics")"
brief_generated_count="$(printf '%s' "$metrics_payload" | jq -r '.totals.includingSelfTests.brief_generated')"
if [[ "$brief_generated_count" == "null" || "$brief_generated_count" -lt 1 ]]; then
  echo "metrics missing brief_generated: $metrics_payload" >&2
  exit 1
fi

echo "healthStatus=$status"
echo "tagCount=$tag_count"
echo "checkoutMode=$checkout_mode"
echo "proofStatus=$proof_status"
echo "exportFile=$export_file"
echo "briefGeneratedIncludingSelfTests=$brief_generated_count"
