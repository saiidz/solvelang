# SolveLang Recipes service image — same digest-pinned container
# pattern as the verification service: build context is the REPO
# ROOT, the image carries only this service's package + src (the
# recipes machinery has no compiled-kit dependency in Stage 0).
FROM node:22-alpine

WORKDIR /app
COPY services/recipes/package.json ./services/recipes/package.json
COPY services/recipes/src ./services/recipes/src

ENV NODE_ENV=production \
    RECIPES_PORT=8080

EXPOSE 8080
CMD ["node", "services/recipes/src/server.js"]
