# Orbitry

Orbitry shows every publicly tracked human-made object in space, from the satellite crossing your sky to the rovers on Mars.

- **Earth globe** (`/`): every active object, colored by orbit, purpose, country or operator. You can search, rewind or fast-forward time, and click an object to trace its orbit. Every view shows how old the data is and how accurate it is.
- **Moon and Mars** (`/moon/`, `/mars/`): landers, rovers, impact sites and orbiters at their real coordinates, with dates and outcomes.
- **Deep space** (`/solar-system/`): planets and probes from JPL Horizons, with each probe's distance, speed and signal travel time.
- **Launches and re-entries** (`/launches/`).
- **Object pages** (`/object/?norad=25544`, `/object/?id=moon:apollo-11`): photo, 3D model, key facts, a reviewed summary and sources. Each image and model shows its licence.
- **Pass predictor** (`/passes/`): ISS, Tiangong, Starlink trains or any object, with times, direction and brightness. A free account adds saved locations, favorites and email alerts.
- **API and embeds** (`/developers/`): a documented JSON API (a free tier with attribution, and API Pro) and an iframe globe.
- **Astro planner** (`/planner/`, paid): darkness, Moon, weather and target ranking for your sky and gear, satellite-streak prediction for your exposures, and a nightly email.

## How it fits together

```
pipeline/          Node scripts that download and merge upstream data → public/data/*.json
content/           Hand-curated records (Moon/Mars sites, probes, 3D models, descriptions)
public/            The static site: plain HTML, CSS and ES modules, no build step
  js/lib/          Shared, dependency-free logic, also used by the Worker and the tests
  js/app/          Page scripts
  vendor/          satellite.js and three.js browser builds (npm run vendor)
src/worker/        Cloudflare Worker for /api/*: API v1, accounts, alerts, billing, cron jobs
migrations/        D1 (SQLite) schema
scripts/           Description drafting/review, coordinate checks, vendoring
test/              node:test suites; the Worker tests run against SQLite and data fixtures
```

Orbital mechanics run in the browser: SGP4 through satellite.js, with Sun and Moon positions from low-precision almanac formulas. The same modules run in the Worker for API passes and email alerts.

### Data sources

| Data | Source | Refresh |
| --- | --- | --- |
| Orbital elements (OMM) | CelesTrak GP, active set | every 2 h |
| Object type, launch and decay dates | CelesTrak SATCAT | daily |
| Operator, country, purpose, mass | Jonathan McDowell's GCAT (CC BY 4.0) | daily |
| Planets and probes | NASA/JPL Horizons | daily |
| Launches | The Space Devs, Launch Library 2 | every 3 h |
| Photos and licences | Wikidata + Wikimedia Commons | weekly |
| 3D models | NASA 3D Resources (pinned commit) | manual |
| Deep-sky targets | OpenNGC (CC BY-SA 4.0) | monthly |
| Weather (planner) | Open-Meteo | on demand |

Downloads are cached in `.cache/` with per-source maximum ages. If a source is down, the last good copy is reused. `public/data/meta.json` records what happened on each run.

### Descriptions: drafted by Claude, published by people

1. `ANTHROPIC_API_KEY=… npm run draft -- --curated` (or `-- --norad 25544,20580`). Claude drafts 2–4 sentences from the record alone and cites the fields each sentence relies on. Drafts land in `content/descriptions/` as `unreviewed`, and any citation of a field that doesn't exist is flagged.
2. `npm run review -- --by "Your Name"` shows the record, the draft and its citations. You can approve, edit, or reject it.
3. Only approved descriptions are written to `public/data/descriptions.json` on the next pipeline run.

The Moon, Mars and probe records in `content/` follow the same idea. Each has a `review` block, and the site labels unreviewed records **Awaiting review**. `npm run check:sites` compares surface coordinates with Wikidata.

## Running it locally

Needs Node 22.13 or later.

```sh
npm ci
npm run pipeline            # downloads data into public/data (about a minute; --skip-slow skips photos)
npm test
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev                 # http://localhost:8787. Sign-in links are printed in the terminal.
```

To try the static pages without the Worker, serve `public/` with any static server. Account features then show as unavailable.

## Publishing on GitHub Pages (static)

`.github/workflows/pages.yml` builds the data and publishes `public/` to GitHub Pages every two hours and on every push to `main`. One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**, and set the custom domain to `orbitry.net` on the same page. On Pages, everything that runs in the browser works. Accounts, alerts, API keys, the API and the paid planner features need the Worker below, so the site hides them.

## Deploying the full site (Cloudflare Workers + D1)

1. `npx wrangler d1 create orbitry`, then put the returned `database_id` into `wrangler.toml`.
2. Set secrets with `npx wrangler secret put …`:
   - `RESEND_API_KEY` (verify the sending domain in Resend; `EMAIL_FROM` is in `wrangler.toml`)
   - `IP_SALT`
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_API_PRO`, `STRIPE_PRICE_PLANNER`
3. Point a Stripe webhook at `https://orbitry.net/api/billing/webhook` for `checkout.session.completed` and `customer.subscription.*`, and turn on the customer portal.
4. Uncomment the `routes` line in `wrangler.toml` once orbitry.net is a Cloudflare zone.
5. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub secrets and set the repository variable `DEPLOY_TARGET` to `cloudflare`. `.github/workflows/data.yml` then rebuilds the data every two hours, deploys, and records element history in D1, and the Pages workflow stops. Point orbitry.net's DNS at Cloudflare instead of GitHub Pages.

Displayed prices live in `public/js/app/plans.js`. What you charge is set by the Stripe prices.

## Accuracy

Positions come from public elements and SGP4. They're good for visualisation and pass timing, and not for collision avoidance or precise pointing. The site says this wherever it shows a position. See `/about/`.
