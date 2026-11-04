# NovaSales on the Hostinger VPS

This deployment runs NovaSales as an isolated Docker Compose service behind the VPS's existing Nginx. It does not replace the University service, Evolution API, or Cloudflare Worker.

## Runtime

The VPS image builds TanStack Start with Nitro's `node_server` preset and runs `node .output/server/index.mjs`. The normal build remains on the existing default target unless `NITRO_PRESET=node_server` is set for the Docker build.

The container binds only to `127.0.0.1:18081`. Nginx should proxy `sales.novanoai.online` to that local port.

## Required environment

Create `.env` on the VPS from `.env.example` and set:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLIC_APP_URL=https://sales.novanoai.online`

The publishable key is embedded into the browser bundle during image build. The service-role key is passed only to the server container. Never commit `.env` or paste credentials into chat.

Optional server integrations:

- Evolution API: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_TOKEN`
- Meta: `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `META_VERIFY_TOKEN`, `META_GRAPH_VERSION`
- WAHA: `WAHA_API_URL`, `WAHA_API_KEY`

Cloudflare does not reveal saved secret values. If you do not have the original integration credentials, rotate/regenerate them in their provider and enter the new values in the VPS `.env`.

## First deployment

After DNS for `sales.novanoai.online` points to the VPS IP:

```bash
cd /opt/novasales
cp .env.example .env
nano .env
chmod 600 .env
docker compose up -d --build
docker compose ps
curl -sSI http://127.0.0.1:18081 | head -n 1
```

Keep the current Cloudflare Worker and DNS target unchanged until the VPS copy passes login, product, messaging, and webhook checks.

## Nginx and HTTPS

Add a separate Nginx site for `sales.novanoai.online` that proxies to `http://127.0.0.1:18081`, then validate and reload Nginx. Issue HTTPS with Certbot only after the DNS A record resolves to the VPS.

## Updates

```bash
cd /opt/novasales
git pull origin main
docker compose up -d --build
docker compose ps
```

Rollback by routing DNS back to the existing Worker until the VPS deployment is verified.
