#!/usr/bin/env bash
# validate-registry.sh
# Validates that committed registry files match what the scanner would generate.
# Usage: ./tools/scanner/validate-registry.sh [--threshold <percent>]
#
# Exit codes:
#   0 - Registry matches (or divergence within warning threshold)
#   1 - Registry divergence exceeds threshold (blocks PR)
#   2 - Usage/setup error

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

THRESHOLD_BLOCK=2   # >2% divergence = hard fail
THRESHOLD_WARN=1    # >1% divergence = warning

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --threshold)
      THRESHOLD_BLOCK="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

cd "${PROJECT_ROOT}"

# Create temp directory for generated registries
TMPDIR_WORK="$(mktemp -d)"
trap 'rm -rf "${TMPDIR_WORK}"' EXIT

echo "Registry Validation"
echo "==================="
echo "Project root: ${PROJECT_ROOT}"
echo "Temp dir: ${TMPDIR_WORK}"
echo ""

# Run registry generation into temp dir
echo "Generating registries..."
if ! make registry-generate REGISTRY_OUTPUT_DIR="${TMPDIR_WORK}" 2>&1; then
  echo "ERROR: make registry-generate failed" >&2
  exit 2
fi

# Compare backend registry
BACKEND_COMMITTED="${PROJECT_ROOT}/docs/registry/backend-features.json"
BACKEND_GENERATED="${TMPDIR_WORK}/backend-features.json"

# Fall back to committed location if REGISTRY_OUTPUT_DIR was not honoured
if [ ! -f "${BACKEND_GENERATED}" ]; then
  # Scanner may have written to default output location
  BACKEND_GENERATED="${PROJECT_ROOT}/docs/registry/backend-features.json"
  echo "Warning: using committed backend registry for comparison (output dir not overridden)"
fi

compare_registries() {
  local label="$1"
  local committed="$2"
  local generated="$3"
  local result=0

  if [ ! -f "${committed}" ]; then
    echo "WARN: Committed ${label} registry not found at ${committed}" >&2
    echo '{"divergencePercent":100,"addedIds":[],"removedIds":[],"changedIds":[]}'
    return
  fi

  if [ ! -f "${generated}" ]; then
    echo "WARN: Generated ${label} registry not found at ${generated}" >&2
    echo '{"divergencePercent":0,"addedIds":[],"removedIds":[],"changedIds":[]}'
    return
  fi

  # Extract feature IDs from both files
  local committed_ids generated_ids
  committed_ids="$(python3 -c "
import json, sys
with open('${committed}') as f:
    data = json.load(f)
ids = sorted([f['id'] for f in data.get('features', [])])
print('\n'.join(ids))
" 2>/dev/null || echo "")"

  generated_ids="$(python3 -c "
import json, sys
with open('${generated}') as f:
    data = json.load(f)
ids = sorted([f['id'] for f in data.get('features', [])])
print('\n'.join(ids))
" 2>/dev/null || echo "")"

  local committed_count generated_count
  committed_count="$(echo "${committed_ids}" | grep -c . || echo 0)"
  generated_count="$(echo "${generated_ids}" | grep -c . || echo 0)"

  local added_ids removed_ids
  added_ids="$(comm -13 <(echo "${committed_ids}") <(echo "${generated_ids}") | grep -c . || echo 0)"
  removed_ids="$(comm -23 <(echo "${committed_ids}") <(echo "${generated_ids}") | grep -c . || echo 0)"

  local total_committed="${committed_count}"
  local changed=$((added_ids + removed_ids))

  local divergence_pct=0
  if [ "${total_committed}" -gt 0 ]; then
    divergence_pct=$(python3 -c "print(round(${changed} / ${total_committed} * 100, 2))")
  fi

  # Collect IDs for output
  local added_list removed_list
  added_list="$(comm -13 <(echo "${committed_ids}") <(echo "${generated_ids}"))"
  removed_list="$(comm -23 <(echo "${committed_ids}") <(echo "${generated_ids}"))"

  echo "{"
  echo "  \"label\": \"${label}\","
  echo "  \"committedCount\": ${total_committed},"
  echo "  \"generatedCount\": ${generated_count},"
  echo "  \"divergencePercent\": ${divergence_pct},"
  echo "  \"addedCount\": ${added_ids},"
  echo "  \"removedCount\": ${removed_ids},"
  echo "  \"addedIds\": $(echo "${added_list}" | python3 -c 'import json,sys; print(json.dumps([l for l in sys.stdin.read().strip().split("\n") if l]))' 2>/dev/null || echo '[]'),"
  echo "  \"removedIds\": $(echo "${removed_list}" | python3 -c 'import json,sys; print(json.dumps([l for l in sys.stdin.read().strip().split("\n") if l]))' 2>/dev/null || echo '[]')"
  echo "}"
}

# Run comparisons
echo "Comparing backend registry..."
BACKEND_DIFF="$(compare_registries "backend" "${BACKEND_COMMITTED}" "${BACKEND_GENERATED}")"

FRONTEND_COMMITTED="${PROJECT_ROOT}/docs/registry/frontend-features.json"
FRONTEND_GENERATED="${TMPDIR_WORK}/frontend-features.json"
if [ ! -f "${FRONTEND_GENERATED}" ]; then
  FRONTEND_GENERATED="${PROJECT_ROOT}/docs/registry/frontend-features.json"
fi

echo "Comparing frontend registry..."
FRONTEND_DIFF="$(compare_registries "frontend" "${FRONTEND_COMMITTED}" "${FRONTEND_GENERATED}")"

# Build combined diff output
DIFF_SUMMARY="{\"backend\": ${BACKEND_DIFF}, \"frontend\": ${FRONTEND_DIFF}}"

echo ""
echo "=== Diff Summary ==="
echo "${DIFF_SUMMARY}" | python3 -m json.tool 2>/dev/null || echo "${DIFF_SUMMARY}"
echo ""

# Check divergence thresholds
BACKEND_PCT="$(echo "${BACKEND_DIFF}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("divergencePercent",0))')"
FRONTEND_PCT="$(echo "${FRONTEND_DIFF}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("divergencePercent",0))')"

MAX_PCT="$(python3 -c "print(max(${BACKEND_PCT}, ${FRONTEND_PCT}))")"

echo "Backend divergence:  ${BACKEND_PCT}%"
echo "Frontend divergence: ${FRONTEND_PCT}%"
echo "Max divergence:      ${MAX_PCT}%"
echo ""

# Check for new features (markers missing from committed registry)
BACKEND_ADDED="$(echo "${BACKEND_DIFF}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("addedCount",0))')"
if [ "${BACKEND_ADDED}" -gt 0 ]; then
  echo "⚠️  New backend features detected (not in committed registry):"
  echo "${BACKEND_DIFF}" | python3 -c 'import json,sys; d=json.load(sys.stdin); [print("  +", id) for id in d.get("addedIds",[])]'
  echo "  Review required: add these IDs to docs/registry/backend-features.json"
  echo ""
fi

# Check also for missing markers
BACKEND_MISSING_MARKER="$(python3 -c "
import json
with open('${BACKEND_COMMITTED}') as f:
    data = json.load(f)
missing = [f['id'] for f in data.get('features', []) if not f.get('backend', {}).get('markerFound', True)]
print(len(missing))
" 2>/dev/null || echo 0)"

if [ "${BACKEND_MISSING_MARKER}" -gt 0 ]; then
  echo "⚠️  Backend features missing // +api: markers (markerFound: false):"
  python3 -c "
import json
with open('${BACKEND_COMMITTED}') as f:
    data = json.load(f)
for f in data.get('features', []):
    if not f.get('backend', {}).get('markerFound', True):
        print('  -', f['id'])
" 2>/dev/null || true
  echo ""
fi

# Determine exit code
if python3 -c "exit(0 if float('${MAX_PCT}') > ${THRESHOLD_BLOCK} else 1)" 2>/dev/null; then
  echo "❌ Registry divergence (${MAX_PCT}%) exceeds threshold (${THRESHOLD_BLOCK}%). Blocking merge."
  echo "${DIFF_SUMMARY}"
  exit 1
elif python3 -c "exit(0 if float('${MAX_PCT}') > ${THRESHOLD_WARN} else 1)" 2>/dev/null; then
  echo "⚠️  Registry divergence (${MAX_PCT}%) is above warning threshold (${THRESHOLD_WARN}%). Human review recommended."
  echo "${DIFF_SUMMARY}"
  exit 0
else
  echo "✅ Registry validation passed. Divergence: ${MAX_PCT}%"
  echo "${DIFF_SUMMARY}"
  exit 0
fi
