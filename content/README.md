# Curated content

Everything in this folder is written or checked by people. The pipeline copies it into
`public/data/` and the site renders it, but it never invents any of it.

| File | What it holds |
| --- | --- |
| `moon.json`, `mars.json` | Landers, rovers, impact sites (with surface coordinates) and orbiters |
| `deep-space.json` | Probes beyond Earth orbit and their JPL Horizons IDs |
| `models.json` | NASA 3D models matched to objects |
| `descriptions/*.json` | Plain-language summaries: drafted by Claude, published only after human review |

## Review status

Every record carries a `review` block:

```json
"review": { "status": "unreviewed" }
"review": { "status": "approved", "by": "Your Name", "on": "2026-10-09", "notes": "Checked against NSSDCA" }
```

The site shows unreviewed records with a visible **Awaiting review** label. Descriptions are
stricter: an unreviewed description is never published.

## Checking surface coordinates

`npm run check:sites` compares each site's coordinates with Wikidata and lists any that differ
by more than 0.5°. Treat a mismatch as a prompt to check a primary source (NASA NSSDCA, the LRO
Camera team, the mission's own publications), not as proof that either value is right.

Longitudes are planetocentric, east-positive, from -180 to 180.
