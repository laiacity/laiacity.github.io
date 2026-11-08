# Let's build a city from 0 — town tracker

Fan-made public tracker for the interactive TikTok series "Let's build a city from 0".
Find your house, follow the proposals, ratios and votes.
Not affiliated with TikTok. To have your handle removed, comment REMOVE ME under any episode.

## Data is not in this repo

Player data (`town.json`) is not stored here, and never enters this repo's git history.
It lives in the private repo `laiacity/town-data`.

- The workflow `.github/workflows/deploy.yml` checks out `laiacity/town-data` at deploy time,
  copies `town.json` into `data/` in the build, and deploys the result with `actions/deploy-pages`.
- The checkout uses the secret `TOWN_DATA_TOKEN`: a fine-grained token with read-only Contents
  access to `laiacity/town-data` only.
- The Pages source must be set to **GitHub Actions** (Settings → Pages).
- `site/data/` is git-ignored. A local `data/town.json` is for local preview only.

## Publish

1. Export and push the data to the private repo (see `tracker/SCHEMA.md`, "Export and publish"):
   `python tracker.py export --out ../town-data/town.json`, then commit and push in `town-data`.
2. Start the deploy: `gh workflow run deploy -R laiacity/laiacity.github.io`.

Live site: https://laiacity.github.io/

## Local preview

Run the tracker export into the site folder, then open `index.html` through a local server:

```
cd tracker
python tracker.py export --out ../site/data/town.json
```
