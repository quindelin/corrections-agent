# The Redline image: the API by default, or the MCP server with a different command (see compose.yaml).
# Build from the repo root:  docker build -f deploy/Dockerfile --build-arg REDLINE_GIT_SHA=$(git rev-parse HEAD) .
# NOT YET BUILT: Docker wasn't available where this was written.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# tsx is a dev dependency, and it's how the services run.
RUN npm ci --no-audit --no-fund

# jurisdictions/seattle/comments.jsonl isn't committed. real:build makes it from Seattle's public data, with no keys
# and no model calls. It also rewrites other files that ARE committed, and the eval depends on those, so this stage
# is thrown away and only comments.jsonl is kept.
# Without network access at build time, use --build-arg SKIP_SEATTLE_COMMENTS=1. The service still runs, but the
# similar_comments tool returns nothing.
FROM deps AS seattle-comments
ARG SKIP_SEATTLE_COMMENTS=
COPY . .
RUN mkdir -p /out \
 && if [ -n "$SKIP_SEATTLE_COMMENTS" ]; then echo "Skipping Seattle comments"; \
    else npm run real:build && test -s jurisdictions/seattle/comments.jsonl \
      && mv jurisdictions/seattle/comments.jsonl /out/comments.jsonl; fi

FROM deps AS app
ARG REDLINE_GIT_SHA=unknown
ENV NODE_ENV=production \
    REDLINE_GIT_SHA=$REDLINE_GIT_SHA \
    HOME=/home/node \
    REDLINE_DATA_DIRS="/data/cache /data/feedback"
COPY . .
COPY --from=seattle-comments /out/ jurisdictions/seattle/
# Reports and the waitlist go to .cache/, and sign-offs to feedback/. Hosts like Fly allow one volume per machine, so
# both live on one volume at /data.
RUN test ! -e .env \
 && rm -rf .cache feedback \
 && ln -s /data/cache .cache \
 && ln -s /data/feedback feedback \
 && mkdir -p /data \
 && chown node:node /data
EXPOSE 8791 8792
# Starts as root only so drop-root.sh can fix volume ownership. The service runs as the node user.
ENTRYPOINT ["/app/deploy/drop-root.sh"]
# Refuses to start without a key, because an open API would let anyone spend the model credit and read reports.
CMD ["sh", "-c", ": \"${REDLINE_API_KEY:?Set REDLINE_API_KEY. See docs/deploy.md}\"; exec node --import tsx demo/server.ts"]
