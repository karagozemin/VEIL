# CLASH

**Tagline:** Where AI agents don’t agree — they compete.

CLASH is a real-time AI battleground where five distinct agents analyze the same scenario, contradict each other, escalate through rebuttals, and produce an outcome layer that surfaces winner, risk, consensus, and manipulation signals.

## Product Highlights

- Live, parallel-feeling agent activation with varying response timing.
- Distinct agent identities: Trader, Risk, Manipulator, Strategist, Chaos.
- Conflict-first interaction model (not a multi-response chatbot).
- Cinematic dark war-room UI with dynamic motion, narration overlay, and escalation feed.
- Outcome layer with winner selection, risk level, consensus score, and manipulation detection.
- Interactive replay timeline with scrub/play/pause/replay + event markers (`⚡`, `💥`, `☠`, `🏁`).
- Deterministic `RUN DEMO` mode for high-impact judge walkthroughs.
- Optional replay export/import as JSON for sharing deterministic replays.
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
- `CAMERA MODE`: Replay automatically focuses the active agent and de-emphasizes others.
- `SOUND ON/OFF`: Toggles ambient tension and event cues.
- `EXPORT REPLAY` / `LOAD REPLAY`: Save and reload replay JSON data.

## Demo Runner (CLI)

Run deterministic-ish simulation output in terminal:

```bash
npm --workspace @clash/server run demo -- "Should I long ETH after meme hype?"
```

## Tests

```bash
npm test
```

## Production Build

```bash
npm run build
```

## Project Structure

- `apps/server/src/index.ts`: Web + Socket server and event scheduling
- `apps/server/src/agents.ts`: Agent identities, personality logic, rebuttals
- `apps/server/src/engine.ts`: Conflict round execution and outcome scoring
- `apps/server/src/engine.test.ts`: Engine behavior tests
- `apps/web/src/App.tsx`: Main cinematic experience UI
- `apps/web/src/components/TimelineScrubber.tsx`: Interactive timeline control and event markers
- `apps/web/src/replayEngine.ts`: Deterministic event replay state reconstruction
- `apps/web/src/demoScript.ts`: Hardcoded demo narrative event sequence
- `apps/web/src/narration.ts`: Event-driven cinematic narration mapping
- `apps/web/src/styles.css`: Visual identity and animation styling

## Environment

Optional override for web socket endpoint:

- `VITE_CLASH_SERVER` (default: `http://localhost:8787`)

Create `apps/web/.env` if needed:

```bash
VITE_CLASH_SERVER=http://localhost:8787
```
