# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

"我是世界口活冠军" — an IELTS speaking practice web app. The user speaks to an AI examiner (James Mitchell, British, 15yr experience) via speech recognition, and receives grammar corrections, natural expression suggestions, and a scored evaluation after each session.

**Tech stack:** Node.js + Express backend, vanilla HTML/CSS/JS frontend (single-page, no framework), deployed on Railway via GitHub.

## Commands

```bash
npm start          # Start server on PORT (default 3457)
```
No build step, no tests. The frontend is served as static files from `public/`.

## Architecture

```
POST /api/chat       →  AI examiner responds to user message, returns reply + [CORRECTION]
POST /api/evaluate   →  Full session evaluation: scores, transcriptWithChinese, corrections, naturalExpressions
POST /api/translate  →  English → Chinese translation (used as fallback when AI omits summaryChinese)
```

- **AI backend:** DeepSeek API (`deepseek-chat` model) via `https://api.deepseek.com/v1`
- **API key:** Injected via `DEEPSEEK_API_KEY` env var. On Railway, set manually in Variables (not synced from render.yaml)
- **All 3 endpoints** use the same DeepSeek chat completions endpoint with different prompts and max_tokens
- `/api/chat` and `/api/evaluate` both append `thinking: { type: "enabled" }` and `output_config: { effort: "max" }` for DeepSeek

## Frontend (public/app.html)

Three interaction modes, all sharing the same `/api/chat` endpoint:
- **free-talk:** Casual conversation, any topic
- **ielts-topics:** Practice around specific IELTS topics (17 predefined topics)
- **mock-test:** Full Part 1 → Part 2 → Part 3 exam simulation

Each mode offers two interaction styles:
- **Chat (A):** Voice input → text shown → examiner responds with text + speak button. Corrections shown inline per message.
- **Voice (B):** Pure voice conversation, no text shown during session. Evaluation shown at end.

Key features: British/American TTS accent, male/female voice, speed control 0.5x–1.5x, interrupt button to stop examiner speech, retry/end-turn buttons during recording, silence auto-send (5s), ready-to-speak indicator.

Evaluation view shows: overall band score (avg of 4 subscores), summary in English + Chinese, per-sentence corrections with natural expressions and suggestions, recommendation tags, next topic suggestions.

History stored in localStorage (`ielts-speaking-history`), supports search by topic/mode.

## Railway deployment

- **Service name:** `ielts-speaking` (from render.yaml)
- **Deploy URL:** `ielts-speaking-production.up.railway.app`
- **Env vars on Railway:** `NODE_ENV=production`, `DEEPSEEK_API_KEY` (manual, `sync: false`)
- After env var changes, Railway auto-redeploys. Check Deployments tab for status.
- Public Networking must be ON in service Settings for the app to be reachable.

## Key bugs fixed (session f0dd8924)

1. **summaryChinese empty** — server.js `content` was `const` inside try block, inaccessible in catch. Fixed by hoisting to `let content` before try. Also added server-side dedup of transcriptWithChinese.
2. **Examiner keeps talking after end** — `sendMessage()`/`processVoiceTurn()` called `speakExaminer()` before checking `conversationActive`. Fixed with guard check before speaking + AbortController on all fetch calls.
3. **Premature auto-cut** — SpeechRecognition `onend` only restarted when input was empty. Fixed: always restart recognition + reset silence timer.
4. **Double sentence analysis** — AI sometimes returns duplicate entries in transcriptWithChinese. Dedup added both server-side and frontend.

## API key management

- The API key in `.env` / `.env.deploy` must match Railway's `DEEPSEEK_API_KEY`
- Old leaked key (ending `56c0`) was removed from settings.local.json permissions allowlist
- Claude Code itself uses DeepSeek API via `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`, configured in `~/.zshrc`
