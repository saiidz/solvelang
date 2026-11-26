# SolveLang Verification service image.
# Build context is the REPO ROOT, after `npm run build:kit` in
# services/verification has produced the compiled kit (see README.md).
FROM node:22-alpine

# tar extracts PR trees. git is deliberately NOT installed: the
# service never shells to git, and no credential ever rides a
# process argument.
RUN apk add --no-cache tar

WORKDIR /app
COPY services/verification/package.json ./services/verification/package.json
COPY services/verification/src ./services/verification/src
COPY services/verification/dist-receipt ./services/verification/dist-receipt
COPY packages/pr-gate/dist ./packages/pr-gate/dist

ENV NODE_ENV=production \
    VERIFICATION_PORT=8080 \
    VERIFICATION_REPO_ROOT=/app \
    VERIFICATION_WORK_ROOT=/tmp/verification-runs \
    VERIFICATION_APP_CREDENTIALS=/data/app.json

EXPOSE 8080
CMD ["node", "services/verification/src/server.js"]
