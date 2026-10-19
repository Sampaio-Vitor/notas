#!/usr/bin/env bash
# Real Docker integration test, with its own Compose project, port and database.
set -Eeuo pipefail
test_dir=$(mktemp -d)
export DEPLOY_DIR=$test_dir/app
export DEPLOY_PROJECT=notas-ci-test-$$
export DEPLOY_ALLOW_LOCAL=1 DEPLOY_SKIP_HTTPS=1
first=1111111111111111111111111111111111111111
second=2222222222222222222222222222222222222222
broken=3333333333333333333333333333333333333333
first_image=notas-ci-test:first-$$
second_image=notas-ci-test:second-$$
broken_image=notas-ci-test:broken-$$
restore_volume=${DEPLOY_PROJECT}_restore
compose() {
  docker compose --project-name "$DEPLOY_PROJECT" --project-directory "$DEPLOY_DIR" --env-file "$DEPLOY_DIR/.env" -f "$DEPLOY_DIR/compose.yaml" "$@"
}
cleanup() {
  local status=$?
  trap - EXIT
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker volume rm "$restore_volume" >/dev/null 2>&1 || true
  docker image rm "$first_image" "$second_image" "$broken_image" >/dev/null 2>&1 || true
  rm -rf "$test_dir"
  exit "$status"
}
trap cleanup EXIT
mkdir -p "$DEPLOY_DIR" "$test_dir/release"
cp compose.yaml "$DEPLOY_DIR/compose.yaml"
cp compose.yaml scripts/deploy.sh "$test_dir/release/"
printf 'APP_PASSWORD=test-deploy-only\nPUBLIC_ORIGIN=https://127.0.0.1:1\nNOTAS_PORT=0\n' > "$DEPLOY_DIR/.env"
docker build --build-arg "APP_REVISION=$first" -t "$first_image" .
docker build --build-arg "APP_REVISION=$second" -t "$second_image" .
docker build -t "$broken_image" - <<EOF
FROM $second_image
LABEL org.opencontainers.image.revision=$broken
CMD ["node", "-e", "process.exit(42)"]
EOF
export NOTAS_IMAGE=$first_image
compose up -d --no-build --pull never --wait --wait-timeout 60
container=$(compose ps --quiet notas)
docker exec "$container" node -e 'const fs=require("node:fs");fs.writeFileSync("/app/data/persistence-marker","preserved")'
# Persist a real operation and session so recovery is checked beyond container health.
docker exec "$container" node --input-type=module -e '
  const base="http://127.0.0.1:4329";
  const login=await fetch(base+"/api/login",{method:"POST",body:JSON.stringify({password:"test-deploy-only"})});
  const cookie=login.headers.get("set-cookie").split(";")[0];
  const result=await fetch(base+"/api/operations",{method:"POST",headers:{cookie},body:JSON.stringify({opId:"deploy-test",collection:"tasks",id:"deployment",patch:{text:"Must survive deployment"}})});
  if(!result.ok)process.exit(1);
  const fs=await import("node:fs");fs.writeFileSync("/app/data/test-session",cookie);
'

assert_persistence() {
  local container_id
  container_id=$(compose ps --quiet notas)
  docker exec "$container_id" node --input-type=module -e '
    import fs from "node:fs";
    if(fs.readFileSync("/app/data/persistence-marker","utf8")!=="preserved")process.exit(1);
    const r=await fetch("http://127.0.0.1:4329/api/state",{headers:{cookie:fs.readFileSync("/app/data/test-session","utf8")}});
    if(!r.ok || (await r.json()).tasks.deployment.text!=="Must survive deployment")process.exit(1);
  '
}

bash "$test_dir/release/deploy.sh" "$second_image" "$second"
[[ $(sed -n '2p' "$DEPLOY_DIR/.deploy/current") == "$second" ]]
assert_persistence
backup=$(sed -n '3p' "$DEPLOY_DIR/.deploy/current")
sha256sum --check "$backup.sha256"
docker volume create "$restore_volume" >/dev/null
docker run --rm --user 0 -i --entrypoint tar --mount "type=volume,src=$restore_volume,dst=/data" "$second_image" -C /data -xf - < "$backup"
docker run --rm --mount "type=volume,src=$restore_volume,dst=/data" "$second_image" node --input-type=module -e '
  import {DatabaseSync} from "node:sqlite";
  const db=new DatabaseSync("/data/notas.sqlite",{readOnly:true});
  if(db.prepare("PRAGMA integrity_check").get().integrity_check!=="ok")process.exit(1);
  const op=db.prepare("SELECT value FROM operations WHERE id=?").get("deploy-test");
  if(JSON.parse(op.value).patch.text!=="Must survive deployment")process.exit(1);
'

if bash "$test_dir/release/deploy.sh" "$broken_image" "$broken"; then
  echo 'Broken image unexpectedly deployed' >&2; exit 1
fi
[[ $(sed -n '2p' "$DEPLOY_DIR/.deploy/current") == "$second" ]]
assert_persistence

# A working container behind a failing HTTPS proxy must also roll back.
if DEPLOY_SKIP_HTTPS=0 bash "$test_dir/release/deploy.sh" "$first_image" "$first"; then
  echo 'Failing HTTPS check unexpectedly passed' >&2; exit 1
fi
[[ $(sed -n '2p' "$DEPLOY_DIR/.deploy/current") == "$second" ]]
assert_persistence

# flock rejects a concurrent deployment without touching the service.
exec 8>"$DEPLOY_DIR/.deploy/deploy.lock"
flock -n 8
if bash "$test_dir/release/deploy.sh" "$first_image" "$first"; then
  echo 'Concurrent deployment unexpectedly passed' >&2; exit 1
fi
flock -u 8
assert_persistence
echo 'PASS: deploy, database/session persistence, backup restore, failed-image recovery, HTTPS recovery and lock'
