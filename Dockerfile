# Chess From Scratch: the static site (app + guide), served by nginx.
# Build:  docker build -t chess-from-scratch .
# Run:    docker run -p 8080:80 chess-from-scratch

# 1. Build the site with Node.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/codegen/package.json packages/codegen/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci
COPY . .
RUN npm run build -w @cfs/codegen && npm run build -w @cfs/web

# 2. Serve it with nginx (small, works on the Raspberry Pi's arm64 too).
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=60s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
