# Hosting the site yourself

The site is static: the Blockly app (`index.html`) and the guide (`guide.html`).
The `Dockerfile` builds it and serves it with nginx (`deploy/nginx.conf`).
Nothing is stored on the server; every visitor's work stays in their own browser.

```sh
docker build -t chess-from-scratch .
docker run -d --restart unless-stopped -p 8080:80 chess-from-scratch
```

Then open http://localhost:8080. Put it behind your own reverse proxy (Caddy,
nginx, Traefik, ...) for HTTPS.

Without Docker: `npm ci && npm run build`, then serve `apps/web/dist/` with any
static web server.

A `docker-compose.yml` for your own server is ignored by git, so it can live in
your clone without being committed.
