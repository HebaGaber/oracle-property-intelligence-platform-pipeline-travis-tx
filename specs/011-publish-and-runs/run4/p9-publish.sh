#!/bin/sh
# Run 4 P9: the real publish (PO approved 2026-10-26), one step at a time, stopping at the first
# failure. Run 3.1's environment, but WITHOUT PUBLISH_CARFILES_NO_PROBE: every CAR is already
# public from Runs 3 and 3.1, so the car-files step must probe and adopt instead of re-uploading.
cd /Users/hebagaber/Github/oracle-property-intelligence-platform-pipeline-travis-tx || exit 1
export CID_COPY_HOST=d2xsqoqv09bd0q.cloudfront.net
TSX_LOADER=$(cd pipeline/publish && node -e "console.log(require('path').dirname(require.resolve('tsx'))+'/loader.mjs')")
export NODE_OPTIONS="--import $TSX_LOADER --import $PWD/pipeline/publish/scripts/fetch-retry.ts"
RUN=travis-full-run4-20261026
MANIFEST=runs/$RUN/manifest.json
for step in gate filebase car-files manifest cid-copy gate-remote; do
  echo "[p9] $(date -u +%FT%TZ) step $step start"
  npx tsx pipeline/publish/scripts/publish-run.ts --manifest $MANIFEST --run-id $RUN \
    --copy-host $CID_COPY_HOST --step $step
  rc=$?
  echo "[p9] $(date -u +%FT%TZ) step $step exit=$rc"
  [ $rc -ne 0 ] && { echo "[p9] STOPPED at $step"; exit $rc; }
done
for step in release index; do
  echo "[p9] $(date -u +%FT%TZ) step $step start"
  npx tsx pipeline/publish/scripts/publish-run.ts --manifest $MANIFEST --run-id $RUN \
    --copy-host $CID_COPY_HOST --step $step \
    --release-reuse-tag run-travis-full-run3-1-20261025 \
    --release-reuse-tag run-travis-full-run3-20261025 \
    --release-target feature/oracle-pipeline
  rc=$?
  echo "[p9] $(date -u +%FT%TZ) step $step exit=$rc"
  [ $rc -ne 0 ] && { echo "[p9] STOPPED at $step"; exit $rc; }
done
echo "[p9] all steps complete"
