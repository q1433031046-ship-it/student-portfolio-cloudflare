#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 7 ]]; then
  echo "Usage: governance-protected-write.sh STATE_ROOT EXPECTED_TIP PHASE COMMIT_MESSAGE PR_TITLE ENVELOPE_PATH PATH..." >&2
  exit 64
fi

STATE_ROOT="$1"
EXPECTED_TIP="$2"
PHASE="$3"
COMMIT_MESSAGE="$4"
PR_TITLE="$5"
ENVELOPE_PATH="$6"
shift 6
WRITE_PATHS=("$@")

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${REPOSITORY:?REPOSITORY is required}"
: "${REPOSITORY_OWNER:?REPOSITORY_OWNER is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

REQUIRED_STATUS_CONTEXT="governance-state-write"
REQUIRED_STATUS_APP_ID=15368
CHECK_ATTEMPTS="${GOVERNANCE_CHECK_ATTEMPTS:-60}"
CHECK_INTERVAL_SECONDS="${GOVERNANCE_CHECK_INTERVAL_SECONDS:-5}"
MERGEABLE_ATTEMPTS="${GOVERNANCE_MERGEABLE_ATTEMPTS:-15}"
MERGEABLE_INTERVAL_SECONDS="${GOVERNANCE_MERGEABLE_INTERVAL_SECONDS:-2}"

if [[ ! "$EXPECTED_TIP" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Expected governance-state tip must be a full lowercase commit SHA." >&2
  exit 64
fi
if [[ ! "$PHASE" =~ ^[a-z0-9][a-z0-9-]{0,63}$ ]]; then
  echo "Governance write phase is invalid." >&2
  exit 64
fi
if [[ ! "$CHECK_ATTEMPTS" =~ ^[1-9][0-9]*$ || ! "$CHECK_INTERVAL_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "Trusted-check polling configuration is invalid." >&2
  exit 64
fi
if [[ ! "$MERGEABLE_ATTEMPTS" =~ ^[1-9][0-9]*$ || ! "$MERGEABLE_INTERVAL_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "Mergeability polling configuration is invalid." >&2
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
if [[ ! -f "$ENVELOPE_PATH" ]]; then
  echo "Governance authorization envelope is missing." >&2
  exit 64
fi

declare -A seen_paths=()
for path in "${WRITE_PATHS[@]}"; do
  if [[ "$path" == /* || "$path" == *".."* || "$path" != governance/runtime/* || "$path" == */ ]]; then
    echo "Governance write path is outside governance/runtime." >&2
    exit 64
  fi
  if [[ -n "${seen_paths[$path]:-}" ]]; then
    echo "Governance write paths must be unique." >&2
    exit 64
  fi
  seen_paths[$path]=1
done

envelope_json="$(jq -c . "$ENVELOPE_PATH" | tr -d '\r\n')" || {
  echo "Governance authorization envelope is not valid JSON." >&2
  exit 64
}
if [[ "$(tr -d '\r\n' < "$ENVELOPE_PATH")" != "$envelope_json" ]]; then
  echo "Governance authorization envelope must be canonical single-line JSON." >&2
  exit 64
fi
jq -e --arg phase "$PHASE" --arg tip "$EXPECTED_TIP" '
  .schemaVersion == 1 and
  .phase == $phase and
  .expectedTip == $tip and
  (.expectedRevision | type == "number") and
  (.source | type == "object") and
  (.paths | type == "array") and
  (.contentDigests | type == "object")
' <<<"$envelope_json" >/dev/null || {
  echo "Governance authorization envelope does not match this proposal." >&2
  exit 64
}

mapfile -t envelope_paths < <(jq -r '.paths[]' <<<"$envelope_json" | tr -d '\r')
mapfile -t sorted_write_paths < <(printf '%s\n' "${WRITE_PATHS[@]}" | LC_ALL=C sort)
if [[ "${#envelope_paths[@]}" -ne "${#sorted_write_paths[@]}" ]]; then
  echo "Governance authorization envelope path count does not match." >&2
  exit 64
fi
for index in "${!sorted_write_paths[@]}"; do
  if [[ "${envelope_paths[$index]}" != "${sorted_write_paths[$index]}" ]]; then
    echo "Governance authorization envelope paths do not match." >&2
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
proposal_body="$(printf 'Protected governance proposal.\n\n<!-- governance-envelope\n%s\n-->' "$envelope_json")"
gh api "repos/$REPOSITORY/pulls" --method POST \
  -f "title=$PR_TITLE" \
  -f "head=$proposal_branch" \
  -f "base=governance-state" \
  -f "body=$proposal_body" > "$proposal_json"

pull_request="$(jq -r '.number' "$proposal_json" | tr -d '\r\n')"
jq -e --arg repository "$REPOSITORY" --arg branch "$proposal_branch" --arg sha "$head_sha" '
  .state == "open" and
  .draft == false and
  .base.ref == "governance-state" and
  .base.repo.full_name == $repository and
  .head.ref == $branch and
  .head.repo.full_name == $repository and
  .head.sha == $sha
' "$proposal_json" >/dev/null

dispatch_json="$RUNNER_TEMP/governance-${PHASE}-dispatch.json"
jq -n --arg proposal_pr "$pull_request" \
  '{event_type:"governance-proposal",client_payload:{proposal_pr:$proposal_pr}}' > "$dispatch_json"
gh api "repos/$REPOSITORY/dispatches" \
  --method POST --input "$dispatch_json"

remote_tip="$(git -C "$STATE_ROOT" ls-remote origin refs/heads/governance-state | cut -f1)"
if [[ "$remote_tip" != "$EXPECTED_TIP" ]]; then
  echo "governance-state tip changed before proposal authorization." >&2
  exit 75
fi

trusted_check="false"
for ((attempt = 1; attempt <= CHECK_ATTEMPTS; attempt += 1)); do
  checks_json="$RUNNER_TEMP/governance-${PHASE}-checks.json"
  gh api "repos/$REPOSITORY/commits/$head_sha/check-runs?per_page=100" > "$checks_json"
  latest_trusted="$(jq -c \
    --arg name "$REQUIRED_STATUS_CONTEXT" \
    --arg head "$head_sha" \
    --argjson app_id "$REQUIRED_STATUS_APP_ID" '
      [.check_runs[] |
        select(
          .name == $name and
          .head_sha == $head and
          .app.id == $app_id and
          .app.slug == "github-actions"
        )
      ] | sort_by(.id) | last // null
    ' "$checks_json" | tr -d '\r\n')"
  if jq -e '.status == "completed" and .conclusion == "success"' <<<"$latest_trusted" >/dev/null 2>&1; then
    trusted_check="true"
    break
  fi
  if jq -e '.status == "completed" and .conclusion != "success"' <<<"$latest_trusted" >/dev/null 2>&1; then
    echo "Trusted governance check completed without success." >&2
    exit 75
  fi
  if ((attempt < CHECK_ATTEMPTS)); then
    sleep "$CHECK_INTERVAL_SECONDS"
  fi
done
if [[ "$trusted_check" != "true" ]]; then
  echo "Timed out waiting for the pinned GitHub Actions governance check." >&2
  exit 75
fi

mergeable="null"
for ((attempt = 1; attempt <= MERGEABLE_ATTEMPTS; attempt += 1)); do
  mergeable="$(gh api "repos/$REPOSITORY/pulls/$pull_request" --jq '.mergeable')"
  if [[ "$mergeable" == "true" || "$mergeable" == "false" ]]; then
    break
  fi
  if ((attempt < MERGEABLE_ATTEMPTS)); then
    sleep "$MERGEABLE_INTERVAL_SECONDS"
  fi
done
if [[ "$mergeable" != "true" ]]; then
  echo "Protected governance proposal is not mergeable." >&2
  exit 75
fi

pr_before_merge="$RUNNER_TEMP/governance-${PHASE}-before-merge.json"
gh api "repos/$REPOSITORY/pulls/$pull_request" > "$pr_before_merge"
jq -e --arg repository "$REPOSITORY" --arg branch "$proposal_branch" --arg sha "$head_sha" '
  .state == "open" and
  .draft == false and
  .base.ref == "governance-state" and
  .base.repo.full_name == $repository and
  .head.ref == $branch and
  .head.repo.full_name == $repository and
  .head.sha == $sha
' "$pr_before_merge" >/dev/null || {
  echo "Protected governance proposal identity changed before merge." >&2
  exit 75
}

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
merged_tip="$(jq -r '.sha' "$merge_json" | tr -d '\r\n')"

remote_tip="$(git -C "$STATE_ROOT" ls-remote origin refs/heads/governance-state | cut -f1)"
if [[ "$remote_tip" != "$merged_tip" || "$remote_tip" == "$EXPECTED_TIP" ]]; then
  echo "Protected governance merge did not produce the expected target tip." >&2
  exit 75
fi

git -C "$STATE_ROOT" fetch --no-tags --depth=2 origin "$merged_tip"
read -r merge_commit first_parent second_parent extra_parent < <(git -C "$STATE_ROOT" rev-list --parents -n 1 FETCH_HEAD)
if [[ "$merge_commit" != "$merged_tip" || "$first_parent" != "$EXPECTED_TIP" || "$second_parent" != "$head_sha" || -n "${extra_parent:-}" ]]; then
  echo "Protected governance result is not the exact two-parent merge." >&2
  exit 75
fi

{
  echo "tip=$merged_tip"
  echo "pull_request=$pull_request"
} >> "$GITHUB_OUTPUT"
