#!/usr/bin/env bash
# lantern-local-loop unattended driver.
#
# Re-invokes `claude -p` with fresh context on each pass, so a run can continue
# past any single context window. Each pass reads HANDOFF.md and PLAN.md from
# disk, does more steps, commits locally, and exits.
#
# In a Lantern project (.lantern/) the plan's last row is the map update, so
# the loop keeps going until it is done -- the run is not done when the code is
# done.
#
# Usage:
#   ./loop.sh "add rate limiting to the login endpoint"   # start a new run
#   ./loop.sh --resume                                    # continue the latest run
#
# Read this before running it. It commits to your repository.

set -uo pipefail

MAX_PASSES="${MAX_PASSES:-20}"
PASS_TIMEOUT="${PASS_TIMEOUT:-30m}"
MAX_TURNS="${MAX_TURNS:-40}"
RUNS_DIR=".ai/runs"

if [ $# -eq 0 ]; then
  echo "usage: $0 \"<goal>\" | $0 --resume" >&2
  exit 2
fi

# Refuse to run on the default branch, and refuse to start over a dirty tree.
branch="$(git rev-parse --abbrev-ref HEAD)"
case "$branch" in
  main|master|develop)
    echo "error: on '$branch'. Create a working branch first." >&2
    exit 1
    ;;
esac

if [ "$1" != "--resume" ] && [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty. Commit or stash first." >&2
  exit 1
fi

if [ "$1" = "--resume" ]; then
  PROMPT="/lantern-local-loop --resume"
else
  PROMPT="/lantern-local-loop $1"
fi

# Returns 0 while the newest run folder still has unfinished rows.
work_remains() {
  local plan
  plan="$(ls -dt "$RUNS_DIR"/*/ 2>/dev/null | head -1)PLAN.md"
  [ -f "$plan" ] || return 0                     # no plan yet: first pass must run
  grep -qE '^\|[^|]*\|[^|]*\|[[:space:]]*(todo|blocked)[[:space:]]*\|' "$plan"
}

for pass in $(seq 1 "$MAX_PASSES"); do
  if ! work_remains; then
    echo "==> plan complete after $((pass - 1)) pass(es)"
    break
  fi

  echo "==> pass $pass/$MAX_PASSES"

  timeout "$PASS_TIMEOUT" claude -p "$PROMPT" \
    --allowedTools "Read,Edit,Write,Bash" \
    --permission-mode acceptEdits \
    --max-turns "$MAX_TURNS"
  status=$?

  # Every pass after the first resumes rather than replanning.
  PROMPT="/lantern-local-loop --resume"

  if [ $status -eq 124 ]; then
    echo "!! pass $pass timed out after $PASS_TIMEOUT; state is on disk, continuing"
  elif [ $status -ne 0 ]; then
    echo "!! claude exited $status on pass $pass; stopping" >&2
    break
  fi

  # A blocked row means the agent gave up on a step. Stop and let a human look.
  if ls -dt "$RUNS_DIR"/*/ >/dev/null 2>&1 &&
     grep -qE '\|[[:space:]]*blocked[[:space:]]*\|' "$(ls -dt "$RUNS_DIR"/*/ | head -1)PLAN.md" 2>/dev/null; then
    echo "!! a step is blocked; see HANDOFF.md" >&2
    break
  fi
done

echo
echo "==> commits on this branch:"
git --no-pager log --oneline "$(git merge-base HEAD main 2>/dev/null || echo HEAD~20)"..HEAD 2>/dev/null | head -40

echo
echo "==> nothing has been pushed. Review with: git diff main...HEAD"
