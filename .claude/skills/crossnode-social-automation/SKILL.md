---
name: crossnode-social-automation
description: >
  Run Crossnode's multi-channel find-and-warm pipeline (LinkedIn, email, X, Instagram,
  Skool, YouTube). Triggers on "automate social outbound", "run crossnode social pipeline",
  "scrape skool youtube linkedin leads", "crossnode-social-run", or scheduling daily
  social lead mining for Crossnode.
---

# Crossnode Social Automation

**Build step-by-step.** Read `~/.gtm-os/system/roadmap.yaml` and only execute the `current_phase`. Do not run the full multi-channel script until Phase 6.

Automates as much of the Crossnode multi-channel stack as Crossnode GTM supports today.

## What is automated vs manual

| Channel | Find (automated) | Warm (automated) |
|---------|------------------|------------------|
| **LinkedIn** | `leads:scrape-post`, `skills:run scrape-linkedin`, `framework:run competitor-audience-mining` | `campaign:create`, `campaign:track`, `linkedin:answer-comments` |
| **Email** | After qualify + enrich | `email:send`, Instantly sequences |
| **Skool / YouTube / X / IG** | `crossnode-gtm research` on URLs in `~/.gtm-os/social-sources.json` → human CSV → `leads:import` | Manual DM/comment; templates in `campaign_templates.yaml` |

Instagram, X, and Skool have **no native API adapters** in Crossnode GTM yet. Research + import is the automation bridge until engager-fetch capabilities are added.

## Prerequisites

- `crossnode-gtm` installed (`npm i -g crossnode-gtm`)
- `~/.gtm-os/_preview/` committed to live (Crossnode ICP + templates)
- Keys in `~/.gtm-os/.env`: `UNIPILE_API_KEY` + `UNIPILE_DSN` (LinkedIn), `ANTHROPIC_API_KEY` (qualify/research), optional `FIRECRAWL_API_KEY`, `INSTANTLY_API_KEY` (email)

## Step 1 — Configure sources

Edit `~/.gtm-os/social-sources.json`:

- `linkedin_posts` — posts whose engagers match Crossnode ICP (n8n/Zapier/agency content)
- `skool_communities`, `youtube_videos`, `x_posts_to_scrape_engagement`, `instagram_posts`
- `competitor_linkedin_urls` — for daily `competitor-audience-mining` framework
- Replace all `PLACEHOLDER` URLs before running

## Step 2 — Run the daily pipeline

```bash
chmod +x ~/.gtm-os/scripts/crossnode-social-run.sh
~/.gtm-os/scripts/crossnode-social-run.sh
```

Dry-run outreach only (default):

```bash
DRY_RUN=1 ~/.gtm-os/scripts/crossnode-social-run.sh
```

## Step 3 — Install scheduled LinkedIn mining (once)

```bash
crossnode-gtm framework:install competitor-audience-mining --auto-confirm
crossnode-gtm agent:install competitor-audience-mining   # optional: 9am daily via launchd
```

Set `competitor_url` in framework inputs to n8n or creator LinkedIn URLs from `social-sources.json`.

## Step 4 — Import research output (Skool / YouTube / X / IG)

After the script writes `~/.gtm-os/data/social-runs/*/research-*.txt`:

1. Extract names + profile URLs into CSV: `name,linkedin_url,email,source,notes`
2. Import: `crossnode-gtm leads:import --source csv --input ./crossnode-social-leads.csv`
3. Qualify: `crossnode-gtm leads:qualify --result-set <id>`

## Step 5 — Launch warm sequences (when ready)

```bash
crossnode-gtm campaign:create \
  --title "Crossnode Social Warm Q2" \
  --hypothesis "Automation freelancers respond to IT-department-trap framing"

crossnode-gtm campaign:track --dry-run
```

Templates: `~/.gtm-os/campaign_templates.yaml` (after preview commit).

## Single-post pipeline (YAML)

For one LinkedIn post URL:

```bash
export LINKEDIN_POST_URL="https://www.linkedin.com/posts/..."
crossnode-gtm pipeline:run --file ~/.gtm-os/pipelines/crossnode-social-warm.yaml --dry-run
```

## Orchestrate (natural language fallback)

```bash
crossnode-gtm orchestrate \
  "Scrape LinkedIn engagers from Crossnode target posts, qualify automation freelancers min score 70, draft warm LinkedIn DMs using campaign_templates, dry run"
```

## Extending automation (future)

Add capabilities: `skool-member-fetch`, `youtube-comment-fetch`, `x-engager-fetch`, `instagram-engager-fetch` — then wire into `multi-channel-campaign.ts` dispatch. Until then, research → CSV → import is the supported path.
