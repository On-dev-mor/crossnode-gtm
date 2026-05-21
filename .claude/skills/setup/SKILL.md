---
name: setup
description: "Install and configure Crossnode GTM for first-time use. Use only after the user has decided to proceed with installation. Triggers on phrases like 'install Crossnode GTM', 'configure Crossnode GTM', 'set up the CLI', 'first-time install', 'scaffold ~/.gtm-os', '.env setup', 'set up Crossnode GTM', or '/setup'. Installs the CLI if missing, writes a template .env file, captures company context from a website + LinkedIn, walks through preview review, commits to live, and recommends frameworks based on the resulting setup. Does NOT cover 'what is Crossnode GTM' or general first-touch orientation — route those to the crossnode-orientation skill."
---

> For "what is Crossnode GTM" or "I just cloned this" first-touch intent, use the **crossnode-orientation** skill instead. Use **/setup** only for installing and configuring once the user has decided to proceed.

# Set Up Crossnode GTM

Execute the setup procedure by following the steps in `skills/setup.md`.

Read that file now and execute every step in order. Ask the user for the required inputs if they were not provided up front:

1. Their company website URL (required)
2. Their LinkedIn profile URL (optional — improves voice extraction)
3. A docs URL or local path (optional — improves positioning)
4. A one-line ICP summary (optional — only if the website fetch is thin)

This is a conversational run. Walk the user through each phase: install + scaffold, key entry, capture, preview review, commit, doctor, framework recommendation. Never paste API keys into chat — the user fills `~/.gtm-os/.env` in their editor and tells you when they're done.
