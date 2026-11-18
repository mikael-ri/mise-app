#!/usr/bin/env bash
# Unattended card runner. One lane = one branch = one PR; one commit (or a few) per card.
#
# Usage: scripts/overnight.sh [options] CARD [CARD...]
#   --lane NAME          lane name, used in the branch name (default: main-lane)
#   --max-hours N        stop starting new cards after N hours (default 7)
#   --budget-usd N       stop starting new cards once reported cost reaches N (default 25)
#   --remote NAME        git remote to push to (default mise-app)
#   --no-push            do everything except push and PR
#   --skip-canary        skip the guardrail canary
#   --skip-deps-check    skip the dependency-change check (not recommended)
#   --allow-supervised   also run cards marked Autonomy: supervised
#
# Live view: tail -f .autonomy/run-<lane>-<stamp>.log (driver lines plus the agent text and tool calls)
# Env: CLAUDE_BIN MODEL_STRONG MODEL_REGULAR TURNS_STRONG TURNS_REGULAR CARD_TIMEOUT SKIP_DB
set -uo pipefail

LANE="main-lane"; MAX_HOURS=7; BUDGET=25; REMOTE="mise-app"
NO_PUSH=0; SKIP_CANARY=0; SKIP_DEPS=0; ALLOW_SUP=0
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
MODEL_STRONG="${MODEL_STRONG:-opus}"
MODEL_REGULAR="${MODEL_REGULAR:-sonnet}"
TURNS_STRONG="${TURNS_STRONG:-200}"
TURNS_REGULAR="${TURNS_REGULAR:-150}"
CARD_TIMEOUT="${CARD_TIMEOUT:-3h}"
SKIP_DB="${SKIP_DB:-0}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-mise-dev}"

CARDS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --lane) LANE="$2"; shift 2 ;;
    --max-hours) MAX_HOURS="$2"; shift 2 ;;
    --budget-usd) BUDGET="$2"; shift 2 ;;
    --remote) REMOTE="$2"; shift 2 ;;
    --no-push) NO_PUSH=1; shift ;;
    --skip-canary) SKIP_CANARY=1; shift ;;
    --skip-deps-check) SKIP_DEPS=1; shift ;;
    --allow-supervised) ALLOW_SUP=1; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) CARDS+=("$1"); shift ;;
  esac
done
[ ${#CARDS[@]} -gt 0 ] || { echo "no cards given" >&2; exit 2; }
export MISE_TEST_DB_SUFFIX="$LANE"

die() { echo "overnight: $*" >&2; exit 1; }
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }

cd "$(git rev-parse --show-toplevel)" || die "not in a git repo"
ROOT="$(pwd)"
mkdir -p .autonomy
STAMP="$(date +%Y%m%d-%H%M)"
LOG=".autonomy/run-$LANE-$STAMP.log"
SUMMARY=".autonomy/summary-$LANE-$STAMP.md"
: > "$LOG"

# ---------- preflight ----------
[ "$(id -u)" -ne 0 ] || die "refusing to run as root"
for t in git jq timeout pnpm "$CLAUDE_BIN"; do command -v "$t" >/dev/null 2>&1 || die "missing tool: $t"; done
git check-ignore -q .autonomy/ 2>/dev/null || die ".autonomy/ is not gitignored; add it to .gitignore first"
[ -z "$(git status --porcelain)" ] || die "working tree not clean"
git fetch "$REMOTE" main >/dev/null 2>&1 || log "warning: could not fetch $REMOTE"
git checkout main >/dev/null 2>&1 || die "cannot checkout main"
git merge --ff-only "$REMOTE/main" >/dev/null 2>&1 || log "warning: main not fast-forwarded from $REMOTE/main"

BASE_BRANCH="auto/$LANE-$(date +%Y%m%d)"
git rev-parse --verify -q "$BASE_BRANCH" >/dev/null && die "branch $BASE_BRANCH already exists"

if [ "$SKIP_DB" != "1" ]; then
  command -v docker >/dev/null 2>&1 || die "docker needed for the test database (or set SKIP_DB=1)"
  docker compose up -d --wait postgres >>"$LOG" 2>&1 || die "could not start the database"
fi
pnpm install --frozen-lockfile >>"$LOG" 2>&1 || die "pnpm install failed"
pnpm check >>"$LOG" 2>&1 || die "baseline pnpm check fails on main; fix that first (see $LOG)"

if [ "$SKIP_CANARY" -ne 1 ]; then
  ./scripts/autonomy-canary.sh >>"$LOG" 2>&1 || die "canary failed; see $LOG"
  log "canary passed"
fi

git checkout -b "$BASE_BRANCH" >/dev/null 2>&1 || die "cannot create $BASE_BRANCH"
BASE_SHA="$(git rev-parse HEAD)"
START=$(date +%s)
TOTAL_COST=0
DONE_CARDS=(); STOP_REASON=""; FAILED_CARD=""

./scripts/autonomy-lock.sh lock >>"$LOG" 2>&1
trap './scripts/autonomy-lock.sh unlock >/dev/null 2>&1; true' EXIT

card_file() { ls docs/milestone-*/tasks/"$1"-*.md 2>/dev/null | head -n1; }
header_field() { grep -m1 -o "\*\*$2:\*\* [^·]*" "$1" | sed -E "s/\*\*$2:\*\* *//; s/ *$//" | awk '{print $1}'; }

has_dep_change() { # compare dependency sections of all package.json between $1 and HEAD
  local base="$1" f a b
  for f in $(git diff --name-only "$base" HEAD -- '*package.json' package.json); do
    a="$(git show "$base:$f" 2>/dev/null | jq -S '[.dependencies,.devDependencies,.peerDependencies,.optionalDependencies]' 2>/dev/null || echo null)"
    b="$(jq -S '[.dependencies,.devDependencies,.peerDependencies,.optionalDependencies]' "$f" 2>/dev/null || echo null)"
    [ "$a" = "$b" ] || { echo "$f"; return 0; }
  done
  return 1
}

forbidden_change() {
  git diff --name-only "$1" HEAD | grep -E '^(\.claude/|\.github/|\.autonomy/|scripts/overnight\.sh|scripts/autonomy-.*\.sh|pnpm-lock\.yaml|pnpm-workspace\.yaml|docs/product-specification\.md|docs/technical-architecture\.md|docs/database-design\.md|\.env)' || return 1
}

park_and_reset() { # card
  ./scripts/autonomy-lock.sh unlock >>"$LOG" 2>&1
  local pb="failed/$LANE-$1-$(date +%H%M)"
  git add -A >/dev/null 2>&1
  git commit -qm "WIP parked: $1 did not pass verification" >/dev/null 2>&1 || true
  git branch "$pb" >/dev/null 2>&1 && log "parked unverified work on branch $pb"
  git reset -q --hard "$LAST_GOOD" >/dev/null 2>&1
  git clean -fdq -e .autonomy >/dev/null 2>&1
  ./scripts/autonomy-lock.sh lock >>"$LOG" 2>&1
}

LAST_GOOD="$BASE_SHA"

# jq program that turns stream-json events into one readable line each.
LIVE_FILTER='fromjson? |
  if .type=="assistant" then
    (.message.content[]? |
      if .type=="text" then "  agent: " + (.text | gsub("\n";" ") | .[0:300])
      elif .type=="tool_use" then "  tool:  " + .name + " " + ((.input.command // .input.file_path // .input.description // .input.subagent_type // "") | tostring | gsub("\n";" ") | .[0:200])
      else empty end)
  elif .type=="result" then "  result: " + ((.subtype // "") | tostring) + " cost=$" + ((.total_cost_usd // 0) | tostring)
  else empty end'

for CARD in "${CARDS[@]}"; do
  elapsed=$(( $(date +%s) - START ))
  if [ "$elapsed" -ge $(( MAX_HOURS * 3600 )) ]; then STOP_REASON="time limit"; break; fi
  if [ "$(printf '%.0f' "$TOTAL_COST")" -ge "$(printf '%.0f' "$BUDGET")" ]; then STOP_REASON="budget limit"; break; fi

  F="$(card_file "$CARD")"
  if [ -z "$F" ]; then STOP_REASON="no card file for $CARD"; FAILED_CARD="$CARD"; break; fi
  TIER="$(header_field "$F" 'Model tier')"
  AUTONOMY="$(header_field "$F" 'Autonomy')"
  if [ "$AUTONOMY" != "auto" ] && ! { [ "$ALLOW_SUP" -eq 1 ] && [ "$AUTONOMY" = "supervised" ]; }; then
    STOP_REASON="$CARD is Autonomy: ${AUTONOMY:-unset}, not auto"; FAILED_CARD="$CARD"; break
  fi
  if [ "$TIER" = "Strong" ]; then MODEL="$MODEL_STRONG"; TURNS="$TURNS_STRONG"; else MODEL="$MODEL_REGULAR"; TURNS="$TURNS_REGULAR"; fi

  log "start $CARD ($TIER, model $MODEL)"
  STREAM=".autonomy/stream-$LANE-$CARD-$STAMP.jsonl"
  OUT=".autonomy/out-$LANE-$CARD-$STAMP.json"
  : > "$STREAM"
  # Live view: the agent's text and tool calls are appended to $LOG as they happen (tail -f it).
  timeout "$CARD_TIMEOUT" "$CLAUDE_BIN" -p "/task-auto $CARD" \
    --permission-mode bypassPermissions \
    --model "$MODEL" \
    --max-turns "$TURNS" \
    --settings .claude/settings.autonomous.json \
    --output-format stream-json --verbose 2>>"$LOG" \
    | tee "$STREAM" \
    | jq -R -r --unbuffered "$LIVE_FILTER" >>"$LOG" 2>/dev/null
  rc=${PIPESTATUS[0]}
  # The last "result" event carries the final text, cost and error flag.
  grep -F '"type":"result"' "$STREAM" | tail -n1 > "$OUT" || true

  RESULT_TEXT="$(jq -r '.result // empty' "$OUT" 2>/dev/null || true)"
  COST="$(jq -r '.total_cost_usd // 0' "$OUT" 2>/dev/null || echo 0)"
  IS_ERR="$(jq -r '.is_error // false' "$OUT" 2>/dev/null || echo true)"
  TOTAL_COST="$(awk -v a="$TOTAL_COST" -v b="$COST" 'BEGIN{printf "%.2f", a+b}')"
  RLINE="$(printf '%s\n' "$RESULT_TEXT" | grep -E '^RESULT: (DONE|BLOCKED|FAILED)' | tail -n1)"
  log "$CARD finished rc=$rc is_error=$IS_ERR cost=\$$COST total=\$$TOTAL_COST line='${RLINE:-none}'"

  ok=1; why=""
  [ "$rc" -eq 0 ] || { ok=0; why="exit code $rc (timeout or crash)"; }
  [ "$IS_ERR" = "false" ] || { ok=0; why="${why:+$why; }agent reported error"; }
  case "$RLINE" in "RESULT: DONE $CARD"*) ;; *) ok=0; why="${why:+$why; }no DONE line (${RLINE:-none})" ;; esac

  if [ "$ok" -eq 1 ]; then
    [ -z "$(git status --porcelain)" ] || { ok=0; why="uncommitted changes left behind"; }
    [ "$(git rev-parse HEAD)" != "$LAST_GOOD" ] || { ok=0; why="${why:+$why; }no commit made"; }
  fi
  if [ "$ok" -eq 1 ]; then
    bad="$(forbidden_change "$LAST_GOOD")" && { ok=0; why="${why:+$why; }forbidden paths changed: $(echo "$bad" | tr '\n' ' ')"; }
  fi
  if [ "$ok" -eq 1 ] && [ "$SKIP_DEPS" -ne 1 ]; then
    dep="$(has_dep_change "$LAST_GOOD")" && { ok=0; why="${why:+$why; }dependency change in $dep"; }
  fi
  if [ "$ok" -eq 1 ]; then
    pnpm check >>"$LOG" 2>&1 || { ok=0; why="${why:+$why; }driver-run pnpm check failed"; }
  fi

  if [ "$ok" -eq 1 ]; then
    LAST_GOOD="$(git rev-parse HEAD)"
    DONE_CARDS+=("$CARD")
    log "$CARD verified"
  else
    log "$CARD FAILED verification: $why"
    park_and_reset "$CARD"
    FAILED_CARD="$CARD"; STOP_REASON="$CARD: $why"
    break
  fi
done

./scripts/autonomy-lock.sh unlock >>"$LOG" 2>&1

# ---------- summary ----------
{
  echo "# Overnight run $STAMP, lane $LANE"
  echo
  echo "- Branch: \`$BASE_BRANCH\`"
  echo "- Requested: ${CARDS[*]}"
  echo "- Verified and committed: ${DONE_CARDS[*]:-none}"
  echo "- Stopped because: ${STOP_REASON:-all requested cards done}"
  echo "- Reported cost: \$$TOTAL_COST"
  echo "- Log: \`$LOG\`"
  [ -z "$FAILED_CARD" ] || echo "- Card that stopped the lane: $FAILED_CARD. If it ran and failed, its unverified work is on a \`failed/$LANE-$FAILED_CARD-*\` branch."
  echo
  echo "Reports: \`docs/*/reports/\` on the branch."
} > "$SUMMARY"
log "summary written to $SUMMARY"

if [ ${#DONE_CARDS[@]} -eq 0 ]; then
  log "nothing verified; not pushing"
  exit 1
fi

if [ "$NO_PUSH" -eq 1 ]; then log "--no-push set; stopping before push"; exit 0; fi

git push -u "$REMOTE" "$BASE_BRANCH" >>"$LOG" 2>&1 || { log "push failed"; exit 1; }
if command -v gh >/dev/null 2>&1; then
  DRAFT=""; [ -z "$STOP_REASON" ] || DRAFT="--draft"
  gh pr create $DRAFT --base main --head "$BASE_BRANCH" \
    --title "Auto: lane $LANE, cards ${DONE_CARDS[*]}" \
    --body-file "$SUMMARY" >>"$LOG" 2>&1 && log "PR opened" || log "gh pr create failed; open it by hand"
else
  log "gh not installed; open the PR by hand"
fi
[ -z "$STOP_REASON" ] && exit 0 || exit 1