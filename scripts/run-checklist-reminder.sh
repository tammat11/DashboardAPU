#!/usr/bin/env bash
set -euo pipefail

worker_dir="$(cd "$(dirname "$0")" && pwd)"
set -a
. "$worker_dir/.env"
set +a

/usr/bin/node "$worker_dir/checklist-reminder-worker.mjs" --apply
