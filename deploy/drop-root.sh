#!/bin/sh
# Entrypoint for both images. Hosts mount volumes owned by root, so make the data directories writable, then give up
# root before starting the service.
set -eu

for dir in ${REDLINE_DATA_DIRS:-}; do
  mkdir -p "$dir"
  if [ "$(id -u)" = 0 ]; then chown -R node:node "$dir"; fi
done

if [ "$(id -u)" = 0 ]; then
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi
exec "$@"
