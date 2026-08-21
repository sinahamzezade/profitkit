# Multi-stage, because the build needs devDependencies and the runtime must not have
# them. The single-stage template version ran `npm ci --omit=dev` and then
# `npm run build`, which cannot work here: vite is a *peer* dependency of
# @react-router/dev, so omitting devDependencies removes the build's own bundler.

FROM node:20-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app

# NODE_ENV is deliberately not set to production here — npm would drop the
# devDependencies the build depends on.
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build


FROM node:20-alpine
# openssl is Prisma's requirement, not the app's.
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# prisma/ is needed at runtime, not just at build: `npm run docker-start` runs
# `prisma generate && prisma migrate deploy` on boot, and both read the schema.
COPY prisma ./prisma
COPY --from=build /app/build ./build

EXPOSE 3000
CMD ["npm", "run", "docker-start"]
