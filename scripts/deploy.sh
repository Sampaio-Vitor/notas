#!/usr/bin/env bash
# Run on the Linux Docker host. Registry token, when needed, comes on stdin.
set -Eeuo pipefail
umask 077

image=${1:?Usage: deploy.sh IMAGE REVISION [REGISTRY_USER]}
revision=${2:?Missing full commit SHA}
registry_user=${3:-}
[[ $revision =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid revision' >&2; exit 2; }
if [[ ! $image =~ ^ghcr\.io/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$ ]]; then
  [[ ${DEPLOY_ALLOW_LOCAL:-0} == 1 && $image =~ ^notas-ci-test:[a-z0-9-]+$ ]] || { echo 'Use an immutable GHCR digest' >&2; exit 2; }
fi

app_dir=${DEPLOY_DIR:-$HOME/notas}
project=${DEPLOY_PROJECT:-notas}
[[ $project =~ ^[a-z0-9][a-z0-9_-]*$ ]] || exit 2
release_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
state_dir=$app_dir/.deploy
mkdir -p "$state_dir" "$app_dir/backups"
exec 9>"$state_dir/deploy.lock"
flock -n 9 || { echo 'Another deployment is running' >&2; exit 1; }
[[ -f $app_dir/.env && -f $release_dir/compose.yaml ]] || { echo 'Missing server .env or release compose.yaml' >&2; exit 1; }

export DOCKER_CONFIG
DOCKER_CONFIG=$(mktemp -d)
stopped=0
previous_container=
previous_image=
rollback_compose=$state_dir/rollback.compose.yaml
rollback_override=$state_dir/rollback.override.yaml
compose() {
  docker compose --project-name "$project" --project-directory "$app_dir" --env-file "$app_dir/.env" "$@"
}
recover() {
  local status=$?
  trap - EXIT INT TERM
  if (( stopped )); then
    echo 'Deployment failed; restoring previous container image (database is preserved).' >&2
    if NOTAS_IMAGE="$previous_image" compose -f "$rollback_compose" -f "$rollback_override" up -d --no-build --pull never --wait --wait-timeout 60 notas; then
      echo 'Previous service restored.' >&2
    else
      echo "RECOVERY FAILED. Keep the volume; backup: ${backup:-not-created}" >&2
    fi
  fi
  rm -rf -- "$DOCKER_CONFIG"
  exit "$status"
}
trap recover EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

if [[ -n $registry_user ]]; then
  docker login ghcr.io --username "$registry_user" --password-stdin
  docker pull "$image"
fi
actual_revision=$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[[ $actual_revision == "$revision" ]] || { echo 'Image revision does not match the requested commit' >&2; exit 1; }
export NOTAS_IMAGE=$image
compose -f "$release_dir/compose.yaml" config --quiet

# Capture the actual running image, including the first deployment from a local build.
previous_container=$(compose -f "$release_dir/compose.yaml" ps --all --quiet notas)
[[ -n $previous_container && $previous_container != *$'\n'* ]] || { echo 'Expected one existing notas container; bootstrap manually first' >&2; exit 1; }
previous_image=$(docker inspect "$previous_container" --format '{{.Image}}')
volume=$(docker inspect "$previous_container" --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}')
[[ $volume == "${project}_notas-data" ]] || { echo 'Unexpected database volume; refusing to replace it' >&2; exit 1; }
if [[ -f $state_dir/current.compose.yaml ]]; then
  cp "$state_dir/current.compose.yaml" "$rollback_compose"
else
  cp "$app_dir/compose.yaml" "$rollback_compose"
fi
printf 'services:\n  notas:\n    image: %s\n' "$previous_image" > "$rollback_override"

stamp=$(date -u +%Y%m%dT%H%M%SZ)-${revision:0:12}-$$
backup=$app_dir/backups/$stamp.tar
stopped=1
docker stop --time 30 "$previous_container" > /dev/null
# Preserve the whole stopped WAL database, ownership, passkeys and session secret.
docker run --rm --user 0 --entrypoint tar --mount "type=volume,src=$volume,dst=/data,readonly" "$previous_image" -C /data -cf - . > "$backup.tmp"
[[ -s $backup.tmp ]]
tar -tf "$backup.tmp" | grep -Fx './notas.sqlite' > /dev/null
mv "$backup.tmp" "$backup"
sha256sum "$backup" > "$backup.sha256"
echo "Backup: $backup"

compose -f "$release_dir/compose.yaml" up -d --no-build --pull never --wait --wait-timeout 60 notas
container=$(compose -f "$release_dir/compose.yaml" ps --quiet notas)
# Check the actual release through HTTP, and the configured HTTPS proxy as well.
docker exec "$container" node -e 'const expected=process.argv[1]; const url=process.argv[2]; fetch(url,{signal:AbortSignal.timeout(10000)}).then(async r=>{const h=await r.json(); if(!r.ok || !h.ok || h.revision!==expected)process.exit(1)}).catch(()=>process.exit(1))' "$revision" http://127.0.0.1:4329/healthz
if [[ ${DEPLOY_SKIP_HTTPS:-0} != 1 ]]; then
  public_origin=$(docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^PUBLIC_ORIGIN=//p')
  [[ $public_origin == https://* ]] || { echo 'Expected an HTTPS PUBLIC_ORIGIN' >&2; exit 1; }
  health=$(curl --fail --silent --show-error --max-time 15 "${public_origin%/}/healthz")
  printf '%s' "$health" | docker exec -i "$container" node -e 'let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>{const h=JSON.parse(b);if(!h.ok||h.revision!==process.argv[1])process.exit(1)})' "$revision"
fi

# Publish state only after both health checks pass. Keep previous image locally.
cp "$release_dir/compose.yaml" "$state_dir/current.compose.yaml.tmp"
mv "$state_dir/current.compose.yaml.tmp" "$state_dir/current.compose.yaml"
printf '%s\n%s\n%s\n' "$image" "$revision" "$backup" > "$state_dir/current.tmp"
mv "$state_dir/current.tmp" "$state_dir/current"
stopped=0
echo "Deployed $revision ($image)"
