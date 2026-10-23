#!/usr/bin/env bash
# A-11: batched hash -> validate(CAR) -> export-tables per data group, local only (no upload,
# no --atlas-page). Mirrors A-04's proven fix (specs/004-property-backbone/run-log.md lines
# 95-99, 101): `elephant-cli validate` over loose files measured at 0.5 s/file (infeasible at
# scale: county's 441,961 files would be ~61 h); batching into N CARs first and validating each
# CAR instead measured at 12.8 s per 1,000 properties (~40x faster), with hash ~16.3s/1,000 and
# export-tables ~1.7s/1,000 (also measured at that run).
#
# Usage:
#   batch-hash-validate-export.sh <group-dir> <out-dir> <n-batches> <workers> <car-prefix>
#
#   <group-dir>   loose-file data-group directory (one item per property: a .zip file for
#                 county, or a folio directory for permits)
#   <out-dir>     output root (created): batches/, hashed/, cars/, tables/, logs/
#   <n-batches>   number of batches to split into (A-04 precedent: ~44,000 items per batch)
#   <workers>     max concurrent batch workers (bounded; this is local CPU work, not an
#                 external source, so parallelism here is not the polite-rate-limit rule)
#   <car-prefix>  prefix for this group's CAR/tables file names, e.g. travis-county
#
# Each batch, once linked (pipeline/publish/scripts/split-into-batches.py, hard links only):
#   1. elephant-cli hash   <batch-dir>      -> hashed zip + CSV + one CAR for the batch
#   2. elephant-cli validate <batch-car>    -> validates the CAR, not the loose files
#   3. elephant-cli export-tables <batch-car> -> this batch's Parquet tables + tables.car
# No --atlas-page, no upload, no IPFS/S3/GitHub writes: this script is a local dry run only.
set -uo pipefail

GROUP_DIR="$1"
OUT_DIR="$2"
N_BATCHES="$3"
WORKERS="$4"
PREFIX="$5"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELEPHANT_CLI="${ELEPHANT_CLI:-$HOME/.local/share/elephant-cli-main/node_modules/.bin/elephant-cli}"
[ -x "$ELEPHANT_CLI" ] || ELEPHANT_CLI="elephant-cli"
PYTHON="${PYTHON:-python3}"

mkdir -p "$OUT_DIR/batches" "$OUT_DIR/hashed" "$OUT_DIR/cars" "$OUT_DIR/tables" "$OUT_DIR/logs"

echo "[split] $GROUP_DIR -> $OUT_DIR/batches ($N_BATCHES batches)"
"$PYTHON" "$SCRIPT_DIR/split-into-batches.py" "$GROUP_DIR" "$OUT_DIR" "$N_BATCHES" \
  >"$OUT_DIR/logs/split.log" 2>&1
echo "[split] done, see $OUT_DIR/logs/split.log"

run_batch() {
  local bname="$1"
  local bdir="$OUT_DIR/batches/$bname"
  local hashed="$OUT_DIR/hashed/$bname"
  local car="$OUT_DIR/cars/${PREFIX}-${bname}.car"
  local csv="$OUT_DIR/cars/${PREFIX}-${bname}-hash.csv"
  local tables="$OUT_DIR/tables/$bname"
  local log="$OUT_DIR/logs/${bname}.log"
  mkdir -p "$tables"

  {
    echo "=== $bname start $(date -u +%FT%TZ) ==="
    echo "-- hash --"
    t0=$(date +%s)
    "$ELEPHANT_CLI" hash "$bdir" \
      --output-zip "$hashed" \
      --output-csv "$csv" \
      --output-car "$car"
    rc=$?
    t1=$(date +%s)
    echo "hash exit=$rc elapsed=$((t1 - t0))s"
    [ "$rc" -eq 0 ] || { echo "=== $bname FAILED at hash ==="; exit "$rc"; }

    echo "-- validate (CAR) --"
    t0=$(date +%s)
    "$ELEPHANT_CLI" validate "$car" \
      --output-csv "$OUT_DIR/cars/${PREFIX}-${bname}-validate-errors.csv"
    rc=$?
    t1=$(date +%s)
    echo "validate exit=$rc elapsed=$((t1 - t0))s"
    [ "$rc" -eq 0 ] || { echo "=== $bname FAILED at validate ==="; exit "$rc"; }

    echo "-- export-tables --"
    t0=$(date +%s)
    "$ELEPHANT_CLI" export-tables "$car" \
      --output "$tables" \
      --output-json "$OUT_DIR/tables/${bname}-export.json"
    rc=$?
    t1=$(date +%s)
    echo "export-tables exit=$rc elapsed=$((t1 - t0))s"
    [ "$rc" -eq 0 ] || { echo "=== $bname FAILED at export-tables ==="; exit "$rc"; }

    echo "=== $bname done $(date -u +%FT%TZ) ==="
  } >"$log" 2>&1
}

running=0
declare -a pids=()
for i in $(seq 1 "$N_BATCHES"); do
  bname="$(printf 'b%02d' "$i")"
  run_batch "$bname" &
  pids+=("$!")
  running=$((running + 1))
  if [ "$running" -ge "$WORKERS" ]; then
    wait "${pids[0]}"
    pids=("${pids[@]:1}")
    running=$((running - 1))
  fi
done
wait

echo "[batch-hash-validate-export] all $N_BATCHES batches launched/finished for $PREFIX; logs in $OUT_DIR/logs"
