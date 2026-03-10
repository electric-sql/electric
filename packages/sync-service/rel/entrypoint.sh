#!/bin/sh

DUMP_PATH="/tmp/erl_crash.dump"
export ERL_CRASH_DUMP="$DUMP_PATH"
export ERL_CRASH_DUMP_SECONDS=60

upload_dump() {
  echo "upload_dump: triggered"

  if [ -z "${CRASH_DUMP_PRESIGNER_URL}" ]; then
    echo "upload_dump: CRASH_DUMP_PRESIGNER_URL is not set, skipping"
    return
  fi

  if [ ! -f "$DUMP_PATH" ]; then
    echo "upload_dump: no dump file found at ${DUMP_PATH}, skipping"
    return
  fi

  echo "upload_dump: dump file found ($(wc -c < "$DUMP_PATH") bytes), fetching presigned URL"

  RESPONSE=$(curl -sf "${CRASH_DUMP_PRESIGNER_URL}")
  if [ -z "$RESPONSE" ]; then
    echo "upload_dump: failed to get presigned URL from ${CRASH_DUMP_PRESIGNER_URL}"
    return
  fi

  UPLOAD_URL=${RESPONSE%%|*}
  S3_KEY=${RESPONSE##*|}

  echo "upload_dump: uploading to s3://${S3_KEY}"
  curl -s --upload-file "$DUMP_PATH" "$UPLOAD_URL"
  echo "upload_dump: done"
}

trap upload_dump EXIT

/app/bin/electric "$@" &
wait $!
