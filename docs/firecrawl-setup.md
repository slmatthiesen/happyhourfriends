# Self-hosted Firecrawl (dev render backend)

Firecrawl renders JS-heavy venue sites (Wix/Squarespace) so their happy-hour text and
menu/PDF links become visible to our extractor. It is an **optional, dev-only** backend
behind `lib/verification/renderUrl.ts`. When `FIRECRAWL_URL` is unset, nothing changes.

There is no published Firecrawl image — you clone their repo and build it with Docker.
Clone it OUTSIDE this repo (e.g. `~/src/firecrawl`) so it is never committed here.

## Run it

```bash
git clone https://github.com/firecrawl/firecrawl.git ~/src/firecrawl
cd ~/src/firecrawl
# minimal self-host env: API on :3002, DB auth off (see their SELF_HOST.md for the full list)
printf 'PORT=3002\nHOST=0.0.0.0\nUSE_DB_AUTHENTICATION=false\n' > .env
docker compose build
docker compose up -d
# wait ~20–30s for the worker to boot, then smoke-test from anywhere:
curl -s -X POST http://localhost:3002/v2/scrape \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","formats":[{"type":"markdown"}]}' | head -c 400
```

A JSON body with `"success":true` and a `data.markdown` field means it works. If `/v2/scrape`
returns 404, your checkout is older — try `/v1/scrape` and update `SCRAPE_PATH` in
`lib/places/firecrawl.ts` accordingly.

Then add to this project's `.env`:

```
FIRECRAWL_URL=http://localhost:3002
```

## Stop it

```bash
cd ~/src/firecrawl && docker compose down
```

## Notes / limits

- **Self-host vs cloud:** the self-hosted build has **no Fire-engine** (advanced anti-bot)
  and **no proxy rotation**. It renders ordinary venue sites fine but will not beat
  aggressive Cloudflare/bot walls. Those venues stay stubs (correct outcome).
- **Resources:** budget ~1–2 GB RAM for the stack.
- **PDFs/images are NOT routed through Firecrawl** — our client returns `null` for them so
  the byte-fetch path hands the raw document to Claude (higher quality than Firecrawl's
  text parse). Firecrawl is used only to render HTML and surface links.
- This stack is **not** wired into the production droplet. Local/dev only for now.
