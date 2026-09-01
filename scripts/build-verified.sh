#!/usr/bin/env bash
set -euo pipefail

if [[ "${WORKERS_CI:-}" == "1" ]]; then
  workers_branch="${WORKERS_CI_BRANCH:-}"
  if [[ "$workers_branch" == "governance-state" || "$workers_branch" == governance/* || "$workers_branch" == governance-write/* ]]; then
    echo "Cloudflare Workers Builds is disabled for a verified governance-only event before any build or version upload." >&2
    exit 78
  fi

  if [[ "$workers_branch" == "main" ]]; then
    workers_commit_ref="${WORKERS_CI_COMMIT_SHA:-HEAD}"
    workers_commit="$(git rev-parse --verify "$workers_commit_ref^{commit}" 2>/dev/null || true)"
    workers_subject="$(git show -s --format=%s "$workers_commit_ref" 2>/dev/null || true)"
    head_subject="$(git show -s --format=%s HEAD 2>/dev/null || true)"
    trust_root_marker="Governance trust root:"
    marker_seen="false"
    if [[ "$workers_subject" == "$trust_root_marker"* || "$head_subject" == "$trust_root_marker"* ]]; then
      marker_seen="true"
    fi

    first_parent=""
    second_parent=""
    extra_parent=""
    changed_paths=()
    changed_paths_available="false"
    touches_trust_root="false"
    paths_allowed="true"
    if [[ "$workers_commit" =~ ^[0-9a-f]{40}$ ]] && git cat-file -e "$workers_commit^{commit}" 2>/dev/null; then
      read -r commit_sha first_parent second_parent extra_parent < <(git rev-list --parents -n 1 "$workers_commit")
      if [[ "$commit_sha" == "$workers_commit" && -n "${first_parent:-}" ]]; then
        if changed_output="$(git diff --name-only "$first_parent" "$workers_commit" 2>/dev/null)"; then
          changed_paths_available="true"
          if [[ -n "$changed_output" ]]; then
            mapfile -t changed_paths <<< "$changed_output"
          fi
          for changed_path in "${changed_paths[@]}"; do
            if [[ "$changed_path" == ".github/workflows/governance-state.yml" ]]; then
              touches_trust_root="true"
            fi
            case "$changed_path" in
              .github/workflows/governance-state.yml | \
              AGENTS.md | \
              governance/* | \
              scripts/governance-*.sh | \
              scripts/governance-*.mjs | \
              scripts/build-verified.sh | \
              tests/governance-contract.test.mjs | \
              docs/plans/* | \
              docs/superpowers/specs/* | \
              docs/superpowers/plans/* | \
              package.json | \
              package-lock.json)
                ;;
              *)
                paths_allowed="false"
                ;;
            esac
          done
        fi
      fi
    fi

    if [[ "$marker_seen" == "true" || "$touches_trust_root" == "true" ]]; then
      if [[ ! "$workers_commit" =~ ^[0-9a-f]{40}$ ]] || [[ "$changed_paths_available" != "true" ]]; then
        echo "Cloudflare governance proof is incomplete; the trust-root commit cannot be resolved." >&2
        exit 78
      fi
      if [[ "$commit_sha" != "$workers_commit" || -z "${first_parent:-}" || -z "${second_parent:-}" || -n "${extra_parent:-}" ]]; then
        echo "Cloudflare governance proof is incomplete; the trust-root merge shape cannot be resolved." >&2
        exit 78
      fi
      if [[ "${#changed_paths[@]}" -eq 0 ]]; then
        echo "Cloudflare governance proof is incomplete; the trust-root path set is empty." >&2
        exit 78
      fi
      if [[ "$paths_allowed" != "true" ]]; then
        echo "Cloudflare governance trust-root path mismatch; the commit is blocked before any build or version upload." >&2
        exit 78
      fi
      echo "Cloudflare Workers Builds is disabled for a verified governance-only event before any build or version upload." >&2
      exit 78
    fi
  fi
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

command -v timeout || {
  echo "build-verified.sh requires GNU timeout." >&2
  exit 69
}

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

echo "Running bounded vinext build..."
timeout \
  --signal=TERM \
  --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
  "${SITES_BUILD_TIMEOUT:-3m}" \
  "${vinext}" build
