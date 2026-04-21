# CLASH

**Tagline:** Where AI agents don’t agree — they compete.

CLASH is a real-time AI battleground where five distinct agents analyze the same scenario, contradict each other, escalate through rebuttals, and produce an outcome layer that surfaces winner, risk, consensus, and manipulation signals.

## Product Highlights

- Live, parallel-feeling agent activation with varying response timing.
- Distinct agent identities: Trader, Risk, Manipulator, Strategist, Chaos.
- Conflict-first interaction model (not a multi-response chatbot).
- Four-stage drama loop: Decision → Rebuttal → Escalation → Collapse.
- Cinematic dark war-room UI with dynamic motion, narration overlay, and escalation feed.
- Outcome layer with winner selection, risk level, consensus score, manipulation detection, and projected impact statement.
- Interactive replay timeline with scrub/play/pause/replay + polished event markers.
- Deterministic `RUN DEMO` mode for high-impact judge walkthroughs.
- Replay export as JSON for sharing deterministic latest session timelines.
- Camera Mode stage direction: event-driven focus, snap switches on rebuttals, manipulator instability, and outcome takeover.

## Tech Stack

- `apps/web`: React + Vite + TypeScript + Framer Motion + Socket.IO client
- `apps/server`: Node + Express + Socket.IO + TypeScript + Vitest
- Root npm workspaces orchestrate all scripts.

## Quick Start

```bash
cd /Users/eminkaragoz/Desktop/projects/Clash
npm install
npm run dev
```

- Web UI: `http://localhost:5173`
- Server health: `http://localhost:8787/health`

## Demo Controls (Web)

- `RUN DEMO`: Loads a deterministic cinematic sequence with guaranteed disagreement and manipulation reveal.
- `REPLAY TIMELINE`: Drag scrubber to seek forward/backward instantly; use `PLAY`, `PAUSE`, and `REPLAY`.
- `LIVE SCENE`: Shows the currently speaking agent and stage progression in real time.
- `CAMERA MODE`: Replay automatically focuses the active agent and de-emphasizes others.
- `LIVE AI` / `SIMULATION`: Choose real model-backed agent generation or local deterministic simulation before `INITIATE CLASH`.
- `EXPORT REPLAY JSON`: Saves the latest valid session timeline as a JSON file.

## Demo Runner (CLI)

Run deterministic-ish simulation output in terminal:

```bash
npm --workspace @clash/server run demo -- "Should I long ETH after meme hype?"
```

## Tests

```bash
npm test
```

Core flow browser tests (Playwright):

```bash
npm run test:e2e
```

## Live Readiness Check

Before demos, verify LIVE AI credentials and provider reachability:

```bash
npm run check:live
```

## Production Build

```bash
npm run build
```

## CI

GitHub Actions CI is configured in `.github/workflows/ci.yml` and runs:

- `npm ci`
- `npm run build`
- `npm test`
- `npm run test:e2e`

## Project Structure

- `apps/server/src/index.ts`: Web + Socket server and event scheduling
- `apps/server/src/agents.ts`: Agent identities, personality logic, rebuttals
- `apps/server/src/demoRound.ts`: Deterministic judge demo sequence (server-driven)
- `apps/server/src/engine.ts`: Conflict round execution and outcome scoring
- `apps/server/src/engine.test.ts`: Engine behavior tests
- `apps/server/src/liveAgents.ts`: LIVE AI multi-agent orchestration (OpenAI-compatible)
- `apps/web/src/App.tsx`: Main cinematic experience UI
- `apps/web/src/components/TimelineScrubber.tsx`: Interactive timeline control and event markers
- `apps/web/src/replayEngine.ts`: Deterministic event replay state reconstruction
- `apps/web/src/narration.ts`: Event-driven cinematic narration mapping
- `apps/web/src/styles.css`: Visual identity and animation styling

## Environment

Optional override for web socket endpoint:

- `VITE_CLASH_SERVER` (default: `http://localhost:8787`)

Server variables for real LIVE AI mode:

- `CLASH_LLM_API_KEY`: Required for `LIVE AI` mode
- `CLASH_LLM_MODEL`: Optional (default: `gpt-4o-mini`)
- `CLASH_LLM_BASE_URL`: Optional OpenAI-compatible base URL (default: `https://api.openai.com/v1`)
- `CLASH_LLM_TIMEOUT_MS`: Optional request timeout in ms (default: `16000`)
- `CLASH_LLM_MAX_RETRIES`: Optional retry count (default: `2`)
- `CLASH_LLM_BREAKER_COOLDOWN_MS`: Optional circuit-breaker cooldown in ms (default: `45000`)

### Groq Setup (recommended for speed)

Use these values in your root `.env`:

```bash
CLASH_LLM_API_KEY=your_groq_key
CLASH_LLM_MODEL=llama-3.3-70b-versatile
CLASH_LLM_BASE_URL=https://api.groq.com/openai/v1
```

Then start the app and select `LIVE AI` before `INITIATE CLASH`.

Security note: never commit real API keys; keep them only in local `.env`.

Create `apps/web/.env` if needed:

```bash
VITE_CLASH_SERVER=http://localhost:8787
```

Create root `.env` (or export env vars in shell) for LIVE AI:

```bash
CLASH_LLM_API_KEY=your_api_key
CLASH_LLM_MODEL=gpt-4o-mini
CLASH_LLM_BASE_URL=https://api.openai.com/v1
```
