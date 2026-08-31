#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 6 ]]; then
  echo "Usage: governance-protected-write.sh STATE_ROOT EXPECTED_TIP PHASE COMMIT_MESSAGE PR_TITLE PATH..." >&2
  exit 64
fi

STATE_ROOT="$1"
EXPECTED_TIP="$2"
PHASE="$3"
COMMIT_MESSAGE="$4"
PR_TITLE="$5"
shift 5
WRITE_PATHS=("$@")

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${REPOSITORY:?REPOSITORY is required}"
: "${REPOSITORY_OWNER:?REPOSITORY_OWNER is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

if [[ ! "$EXPECTED_TIP" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected governance-state tip must be a full lowercase commit SHA." >&2
  exit 64
fi
if [[ ! "$PHASE" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]]; then
  echo "Governance write phase is invalid." >&2
  exit 64
fi
if [[ ! "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "Repository identity is invalid." >&2
  exit 64
fi
if [[ "$REPOSITORY" != "$REPOSITORY_OWNER/"* ]]; then
  echo "Repository owner does not match the repository identity." >&2
  exit 64
fi
if [[ ! -d "$STATE_ROOT/.git" ]]; then
  echo "State root is not an initialized Git worktree." >&2
  exit 64
fi
if [[ "$COMMIT_MESSAGE" == *$'\n'* || "$PR_TITLE" == *$'\n'* ]]; then
  echo "Commit message and pull request title must be single-line values." >&2
  exit 64
fi
for path in "${WRITE_PATHS[@]}"; do
  if [[ "$path" == /* || "$path" == *".."* || "$path" != governance/runtime/* ]]; then
    echo "Governance write path is outside governance/runtime." >&2
    exit 64
  fi
done

remote_tip="$(git -C "$STATE_ROOT" ls-remote origin refs/heads/governance-state | cut -f1)"
if [[ "$remote_tip" != "$EXPECTED_TIP" ]]; then
  echo "governance-state tip changed before proposal creation." >&2
  exit 75
fi

git -C "$STATE_ROOT" add -- "${WRITE_PATHS[@]}"
if git -C "$STATE_ROOT" diff --cached --quiet; then
  echo "Governance proposal contains no staged change." >&2
  exit 64
fi
git -C "$STATE_ROOT" commit -m "$COMMIT_MESSAGE"
head_sha="$(git -C "$STATE_ROOT" rev-parse HEAD)"
parent_sha="$(git -C "$STATE_ROOT" rev-parse HEAD^)"
if [[ "$parent_sha" != "$EXPECTED_TIP" ]]; then
  echo "Governance proposal is not based on the expected tip." >&2
  exit 75
fi

proposal_branch="governance-write/${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${PHASE}"
git -C "$STATE_ROOT" push origin "HEAD:refs/heads/$proposal_branch"

proposal_json="$RUNNER_TEMP/governance-${PHASE}-proposal.json"
gh api "repos/$REPOSITORY/pulls" --method POST \
  -f "title=$PR_TITLE" \
  -f "head=$proposal_branch" \
  -f "base=governance-state" \
  -f "body=Trusted governance write phase: $PHASE. Expected target tip: $EXPECTED_TIP." > "$proposal_json"

pull_request="$(jq -r '.number' "$proposal_json")"
jq -e --arg repository "$REPOSITORY" --arg branch "$proposal_branch" --arg sha "$head_sha" '
  .state == "open" and
  .draft == false and
  .base.ref == "governance-state" and
  .base.repo.full_name == $repository and
  .head.ref == $branch and
  .head.repo.full_name == $repository and
  .head.sha == $sha
' "$proposal_json" >/dev/null

remote_tip="$(git -C "$STATE_ROOT" ls-remote origin refs/heads/governance-state | cut -f1)"
if [[ "$remote_tip" != "$EXPECTED_TIP" ]]; then
  echo "governance-state tip changed before proposal authorization." >&2
  exit 75
fi

gh api "repos/$REPOSITORY/statuses/$head_sha" --method POST \
  -f "state=success" \
  -f "context=governance-state-write" \
  -f "description=Validated owner-only governance write" >/dev/null

mergeable="null"
for _attempt in {1..15}; do
  mergeable="$(gh api "repos/$REPOSITORY/pulls/$pull_request" --jq '.mergeable')"
  if [[ "$mergeable" == "true" || "$mergeable" == "false" ]]; then
    break
  fi
  sleep 2
done
if [[ "$mergeable" != "true" ]]; then
  echo "Protected governance proposal is not mergeable." >&2
  exit 75
fi

remote_tip="$(git -C "$STATE_ROOT" ls-remote origin refs/heads/governance-state | cut -f1)"
if [[ "$remote_tip" != "$EXPECTED_TIP" ]]; then
  echo "governance-state tip changed before protected merge." >&2
  exit 75
fi

merge_json="$RUNNER_TEMP/governance-${PHASE}-merge.json"
gh api "repos/$REPOSITORY/pulls/$pull_request/merge" --method PUT \
  -f "sha=$head_sha" \
  -f "merge_method=merge" > "$merge_json"
jq -e '.merged == true and (.sha | test("^[0-9a-f]{40}$"))' "$merge_json" >/dev/null
merged_tip="$(jq -r '.sha' "$merge_json")"

remote_tip="$(git -C "$STATE_ROOT" ls-remote origin refs/heads/governance-state | cut -f1)"
if [[ "$remote_tip" != "$merged_tip" || "$remote_tip" == "$EXPECTED_TIP" ]]; then
  echo "Protected governance merge did not produce the expected target tip." >&2
  exit 75
fi

{
  echo "tip=$merged_tip"
  echo "pull_request=$pull_request"
} >> "$GITHUB_OUTPUT"
