import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { TimelineScrubber } from "./components/TimelineScrubber";
import { narrationForEvent } from "./narration";
import { getDurationMs, getEventMarkers, getRelativeTime, resolveReplayState } from "./replayEngine";
import type { Decision, MatchEvent, MatchMode } from "./types";

type AgentMeta = {
  id: string;
  name: string;
  role: string;
  color: string;
  vibe: string;
};

type AmbientNodes = {
  oscillatorA: OscillatorNode;
  oscillatorB: OscillatorNode;
  gain: GainNode;
};

type SystemLogLevel = "info" | "success" | "warning";

type SystemLogEntry = {
  id: string;
  level: SystemLogLevel;
  text: string;
  timestamp: number;
};

const AGENTS: AgentMeta[] = [
  { id: "trader", name: "Vortex Trader", role: "Aggression Engine", color: "#16f2a5", vibe: "Momentum hunter" },
  { id: "risk", name: "Sentinel Risk", role: "Capital Guardian", color: "#ff5d7a", vibe: "Defensive firewall" },
  { id: "manipulator", name: "Echo Whale", role: "Narrative Distorter", color: "#ff9f43", vibe: "Biased influence" },
  { id: "strategist", name: "Atlas Strategist", role: "Systems Thinker", color: "#6c7bff", vibe: "Balanced planner" },
  { id: "chaos", name: "Glitch Chaos", role: "Entropy Injector", color: "#d16bff", vibe: "Unpredictable shocks" }
];

const initialScenarios = [
  "Should I long ETH right now?",
  "Is this meme coin safe?",
  "Launch this meme token tonight?",
  "Trade this breakout opportunity"
];

const decisionLabel: Record<Decision, string> = {
  BUY: "BUY",
  SELL: "SELL",
  HOLD: "HOLD",
  DO_NOT_TOUCH: "DO NOT TOUCH",
  LAUNCH: "LAUNCH",
  WAIT: "WAIT"
};

const modeLabel: Record<MatchMode, string> = {
  "live-ai": "LIVE AI",
  simulation: "SIMULATION",
  demo: "DEMO"
};

const socketUrl = (import.meta as ImportMeta & { env: { VITE_CLASH_SERVER?: string } }).env.VITE_CLASH_SERVER ?? "http://localhost:8787";

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [scenario, setScenario] = useState(initialScenarios[0]);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [runMode, setRunMode] = useState<Exclude<MatchMode, "demo">>("live-ai");
  const [cursorMs, setCursorMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [serverWarning, setServerWarning] = useState<string | null>(null);
  const [systemLog, setSystemLog] = useState<SystemLogEntry[]>([]);
  const [dismissedOutcomeTimestamp, setDismissedOutcomeTimestamp] = useState<number | null>(null);
  const [focusAgentId, setFocusAgentId] = useState<string | null>(null);
  const [focusBeat, setFocusBeat] = useState<"smooth" | "snap" | "aggressive" | "outcome">("smooth");
  const [isShaking, setIsShaking] = useState(false);

  const soundEnabledRef = useRef(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ambientNodesRef = useRef<AmbientNodes | null>(null);
  const lastAudibleEventIndexRef = useRef(-1);
  const replayImportInputRef = useRef<HTMLInputElement | null>(null);
  const shakeTimerRef = useRef<number | null>(null);

  const durationMs = useMemo(() => getDurationMs(events), [events]);
  const markers = useMemo(() => getEventMarkers(events), [events]);
  const hasOutcomeEvent = useMemo(() => events.some((event) => event.type === "outcome"), [events]);
  const replayState = useMemo(() => resolveReplayState(events, cursorMs), [events, cursorMs]);
  const narration = useMemo(() => narrationForEvent(replayState.lastEvent), [replayState.lastEvent]);

  const appendLog = (entry: Omit<SystemLogEntry, "id">) => {
    setSystemLog((previous) => {
      const next = [...previous, { id: `${entry.timestamp}-${previous.length}`, ...entry }];
      return next.slice(-18);
    });
  };

  const findEventIndexAtCursor = (nextCursorMs: number) => {
    if (events.length === 0) {
      return -1;
    }
    let index = -1;
    for (let i = 0; i < events.length; i += 1) {
      const eventMs = getRelativeTime(events, events[i].timestamp);
      if (eventMs <= nextCursorMs) {
        index = i;
      } else {
        break;
      }
    }
    return index;
  };

  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  };

  const ensureAmbientLoop = () => {
    const context = getAudioContext();
    if (ambientNodesRef.current) {
      return;
    }

    const gain = context.createGain();
    const oscillatorA = context.createOscillator();
    const oscillatorB = context.createOscillator();

    gain.gain.value = 0.0001;
    oscillatorA.type = "sine";
    oscillatorB.type = "triangle";
    oscillatorA.frequency.value = 47;
    oscillatorB.frequency.value = 63;

    oscillatorA.connect(gain);
    oscillatorB.connect(gain);
    gain.connect(context.destination);

    oscillatorA.start();
    oscillatorB.start();

    ambientNodesRef.current = { oscillatorA, oscillatorB, gain };
  };

  const syncAmbient = (active: boolean) => {
    if (!soundEnabledRef.current) {
      return;
    }

    const context = getAudioContext();
    if (context.state === "suspended") {
      void context.resume();
    }

    ensureAmbientLoop();
    const ambient = ambientNodesRef.current;
    if (!ambient) {
      return;
    }

    const now = context.currentTime;
    ambient.gain.gain.cancelScheduledValues(now);
    ambient.gain.gain.setValueAtTime(ambient.gain.gain.value, now);
    ambient.gain.gain.exponentialRampToValueAtTime(active ? 0.009 : 0.0001, now + 0.24);
  };

  const playTone = ({
    type,
    frequency,
    duration,
    volume,
    detune,
    delayMs
  }: {
    type: OscillatorType;
    frequency: number;
    duration: number;
    volume: number;
    detune?: number;
    delayMs?: number;
  }) => {
    if (!soundEnabledRef.current) {
      return;
    }

    const context = getAudioContext();
    if (context.state === "suspended") {
      void context.resume();
    }

    const now = context.currentTime + (delayMs ?? 0) / 1000;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.detune.value = detune ?? 0;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
  };

  const playCueForEvent = (event: MatchEvent) => {
    if (event.type === "agent_decision") {
      if (event.turn.agentId === "manipulator" || event.turn.maliciousSignal) {
        playTone({ type: "sawtooth", frequency: 190, duration: 0.11, volume: 0.025, detune: -28 });
        playTone({ type: "square", frequency: 80, duration: 0.09, volume: 0.016, delayMs: 25 });
      } else {
        playTone({ type: "square", frequency: 700, duration: 0.05, volume: 0.018 });
      }
      return;
    }

    if (event.type === "agent_rebuttal") {
      playTone({ type: "triangle", frequency: 160, duration: 0.08, volume: 0.022 });
      return;
    }

    if (event.type === "outcome") {
      syncAmbient(false);
      playTone({ type: "sine", frequency: 58, duration: 0.22, volume: 0.05, delayMs: 380 });
    }
  };

  useEffect(() => {
    if (isPlaying && events.length > 0) {
      syncAmbient(true);
      return;
    }
    syncAmbient(false);
  }, [isPlaying, events.length]);

  useEffect(() => {
    const connection = io(socketUrl, { transports: ["websocket"] });
    setSocket(connection);
    setServerWarning(null);

    connection.on("match:event", (incomingEvent: MatchEvent) => {
      if (incomingEvent.type === "match_started") {
        appendLog({
          level: incomingEvent.mode === "live-ai" ? "success" : "info",
          text: `Match started in ${incomingEvent.mode.toUpperCase()} mode`,
          timestamp: incomingEvent.timestamp
        });
      }

      if (incomingEvent.type === "agent_decision") {
        appendLog({
          level: incomingEvent.turn.maliciousSignal ? "warning" : "info",
          text: `${incomingEvent.turn.agentId} decided ${incomingEvent.turn.decision}`,
          timestamp: incomingEvent.timestamp
        });
      }

      if (incomingEvent.type === "agent_rebuttal") {
        appendLog({
          level: "info",
          text: `${incomingEvent.agentId} challenged ${incomingEvent.targetAgentId}`,
          timestamp: incomingEvent.timestamp
        });
      }

      if (incomingEvent.type === "outcome") {
        appendLog({
          level: incomingEvent.mode === "live-ai" ? "success" : "info",
          text: `Outcome: ${incomingEvent.winnerAgentId} wins (${incomingEvent.mode.toUpperCase()})`,
          timestamp: incomingEvent.timestamp
        });
      }

      setEvents((previous) => {
        const lastTimestamp = previous[previous.length - 1]?.timestamp ?? incomingEvent.timestamp;
        let nextTimestamp = Math.max(incomingEvent.timestamp, lastTimestamp + 1);

        if (incomingEvent.type === "outcome") {
          nextTimestamp = Math.max(nextTimestamp, lastTimestamp + 380);
        }

        const normalizedEvent = {
          ...incomingEvent,
          timestamp: nextTimestamp
        } as MatchEvent;

        return [...previous, normalizedEvent];
      });
    });

    connection.on("match:warning", (payload: { message?: string }) => {
      const warning = payload?.message?.trim();
      if (!warning) {
        return;
      }
      setServerWarning(warning);
      appendLog({
        level: "warning",
        text: `Fallback warning: ${warning}`,
        timestamp: Date.now()
      });
    });

    return () => {
      connection.off("match:warning");
      connection.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      syncAmbient(false);
      return;
    }

    syncAmbient(events.length > 0);
    const intervalId = window.setInterval(() => {
      setCursorMs((current) => {
        if (current >= durationMs) {
          return durationMs;
        }
        return Math.min(durationMs, current + 33);
      });
    }, 33);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isPlaying, durationMs, events.length]);

  useEffect(() => {
    if (isPlaying && hasOutcomeEvent && cursorMs >= durationMs && durationMs > 0) {
      setIsPlaying(false);
      syncAmbient(false);
    }
  }, [isPlaying, hasOutcomeEvent, cursorMs, durationMs]);

  useEffect(() => {
    const event = replayState.lastEvent;

    if (!event) {
      setFocusAgentId(null);
      setFocusBeat("smooth");
      return;
    }

    if (event.type === "outcome") {
      setFocusAgentId(event.winnerAgentId);
      setFocusBeat("outcome");
      return;
    }

    if (event.type === "agent_rebuttal") {
      setFocusAgentId(event.agentId);
      setFocusBeat("snap");
      setIsShaking(true);
      if (shakeTimerRef.current) {
        window.clearTimeout(shakeTimerRef.current);
      }
      shakeTimerRef.current = window.setTimeout(() => {
        setIsShaking(false);
      }, 260);
      return;
    }

    if (event.type === "agent_decision") {
      const manipulative = event.turn.agentId === "manipulator" || event.turn.maliciousSignal;
      setFocusAgentId(event.turn.agentId);
      setFocusBeat(manipulative ? "aggressive" : "smooth");

      if (manipulative) {
        setIsShaking(true);
        if (shakeTimerRef.current) {
          window.clearTimeout(shakeTimerRef.current);
        }
        shakeTimerRef.current = window.setTimeout(() => {
          setIsShaking(false);
        }, 280);
      }
      return;
    }

    if (event.type === "agent_thinking") {
      setFocusAgentId(event.agentId);
      setFocusBeat("smooth");
    }
  }, [replayState.lastEvent]);

  useEffect(() => {
    return () => {
      if (shakeTimerRef.current) {
        window.clearTimeout(shakeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (replayState.lastEvent?.type === "outcome" && replayState.outcome) {
        setDismissedOutcomeTimestamp(replayState.outcome.timestamp);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [replayState.lastEvent, replayState.outcome]);

  useEffect(() => {
    if (!isPlaying || events.length === 0) {
      return;
    }

    const visibleIndex = findEventIndexAtCursor(cursorMs);

    if (visibleIndex < lastAudibleEventIndexRef.current) {
      lastAudibleEventIndexRef.current = visibleIndex;
      return;
    }

    for (let index = lastAudibleEventIndexRef.current + 1; index <= visibleIndex; index += 1) {
      const event = events[index];
      if (!event || event.type === "match_started" || event.type === "agent_thinking") {
        continue;
      }
      playCueForEvent(event);
    }

    lastAudibleEventIndexRef.current = visibleIndex;
  }, [cursorMs, isPlaying, events]);

  const resetPlayback = (nextEvents: MatchEvent[], autoPlay: boolean) => {
    setEvents(nextEvents);
    setCursorMs(0);
    setIsPlaying(autoPlay);
    setServerWarning(null);
    setSystemLog([]);
    setDismissedOutcomeTimestamp(null);
    setFocusAgentId(null);
    setFocusBeat("smooth");
    setIsShaking(false);
    lastAudibleEventIndexRef.current = -1;
  };

  const startClash = () => {
    if (!socket || scenario.trim().length < 3) {
      return;
    }

    const nextSessionId = `match_${Date.now().toString(36)}`;
    resetPlayback([], true);
    socket.emit("scenario:start", { scenario: scenario.trim(), sessionId: nextSessionId, mode: runMode });
  };

  const runDemo = () => {
    if (!socket) {
      return;
    }

    const demoSessionId = `demo_${Date.now().toString(36)}`;
    resetPlayback([], true);
    socket.emit("scenario:start", {
      scenario: "demo",
      sessionId: demoSessionId,
      mode: "demo"
    });
  };

  const exportReplay = () => {
    if (events.length === 0) {
      return;
    }

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      events
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `clash-replay-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const importReplay = async (file: File) => {
    const text = await file.text();
    let parsed: { events?: MatchEvent[] };

    try {
      parsed = JSON.parse(text) as { events?: MatchEvent[] };
    } catch {
      return;
    }

    if (!Array.isArray(parsed.events) || parsed.events.length === 0) {
      return;
    }
    resetPlayback(parsed.events, false);
  };

  const handleSeek = (nextMs: number) => {
    setIsPlaying(false);
    setCursorMs(nextMs);
    lastAudibleEventIndexRef.current = findEventIndexAtCursor(nextMs);
  };

  const handleReplay = () => {
    setCursorMs(0);
    setIsPlaying(true);
    lastAudibleEventIndexRef.current = -1;
  };

  const togglePlayPause = () => {
    setIsPlaying((previous) => !previous);
  };

  const decisionCounts = useMemo(() => {
    const counts = new Map<Decision, number>();
    for (const turn of Object.values(replayState.turns)) {
      counts.set(turn.decision, (counts.get(turn.decision) ?? 0) + 1);
    }
    return counts;
  }, [replayState.turns]);

  const disagreementIndex = useMemo(() => {
    const unique = new Set(Object.values(replayState.turns).map((turn) => turn.decision)).size;
    if (Object.keys(replayState.turns).length === 0) {
      return 0;
    }
    return Math.round((unique / AGENTS.length) * 100);
  }, [replayState.turns]);

  const firstTimestamp = events[0]?.timestamp;
  const manipulatorRecentMs = firstTimestamp && replayState.lastManipulatorAt ? firstTimestamp + cursorMs - replayState.lastManipulatorAt : Infinity;
  const manipulatorGlitch = manipulatorRecentMs < 950;
  const outcomeTakeover = Boolean(replayState.outcome && replayState.lastEvent?.type === "outcome");
  const outcomeVisible = Boolean(outcomeTakeover && replayState.outcome && dismissedOutcomeTimestamp !== replayState.outcome.timestamp);
  const tensionZoom = disagreementIndex >= 60 && !outcomeTakeover;

  const runtimeStatus = useMemo(() => {
    if (!replayState.mode) {
      return { label: "IDLE", tone: "info" as const };
    }

    if (replayState.mode === "demo") {
      return { label: "DEMO SCRIPT", tone: "info" as const };
    }

    if (replayState.mode === "live-ai") {
      return { label: "LIVE VERIFIED", tone: "success" as const };
    }

    if (serverWarning) {
      return { label: "FALLBACK SIMULATION", tone: "warning" as const };
    }

    return { label: "SIMULATION", tone: "info" as const };
  }, [replayState.mode, serverWarning]);

  return (
    <div className={`app-shell ${outcomeVisible ? "camera-outcome" : ""}`.trim()}>
      <div className="scanline" />

      <AnimatePresence mode="wait">
        <motion.div
          key={narration}
          className="narration-overlay"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.28 }}
        >
          {narration}
        </motion.div>
      </AnimatePresence>

      <header className="hero">
        <p className="eyebrow">REAL-TIME AI BATTLEGROUND</p>
        <h1>CLASH</h1>
        <p className="tagline">Where AI agents don’t agree — they compete.</p>
      </header>

      <section className="scenario-bar">
        <input value={scenario} onChange={(event) => setScenario(event.target.value)} placeholder="Enter a scenario..." />
        <button onClick={startClash}>INITIATE CLASH</button>
        <button className="demo-btn" onClick={runDemo}>RUN DEMO</button>
      </section>

      <section className="controls-bar">
        <button className={`control-btn ${runMode === "live-ai" ? "mode-active" : ""}`.trim()} onClick={() => setRunMode("live-ai")}>
          LIVE AI
        </button>
        <button className={`control-btn ${runMode === "simulation" ? "mode-active" : ""}`.trim()} onClick={() => setRunMode("simulation")}>
          SIMULATION
        </button>
        <button className="control-btn" disabled={events.length === 0} onClick={exportReplay}>
          EXPORT REPLAY JSON
        </button>
        <button className="control-btn" onClick={() => replayImportInputRef.current?.click()}>
          LOAD REPLAY JSON
        </button>
        <input
          ref={replayImportInputRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) {
              return;
            }
            void importReplay(file);
            event.target.value = "";
          }}
        />
        <span className="status-chip">
          {replayState.sessionId
            ? `Session: ${replayState.sessionId} • ${modeLabel[replayState.mode ?? runMode]}`
            : `No active session • ${modeLabel[runMode]}`}
        </span>
        <span className={`verify-badge ${runtimeStatus.tone}`.trim()}>{runtimeStatus.label}</span>
      </section>

      {serverWarning && <p className="warning-chip">{serverWarning}</p>}

      <section className="scenario-suggestions">
        {initialScenarios.map((item) => (
          <button key={item} onClick={() => setScenario(item)}>
            {item}
          </button>
        ))}
      </section>

      <TimelineScrubber
        cursorMs={cursorMs}
        durationMs={durationMs}
        isPlaying={isPlaying}
        markers={markers}
        onSeek={handleSeek}
        onReplay={handleReplay}
        onPlayPause={togglePlayPause}
      />

      <section className="system-log panel">
        <div className="panel-head">
          <h2>SYSTEM LOG</h2>
          <span>{systemLog.length ? `${systemLog.length} events` : "No events"}</span>
        </div>
        <div className="system-log-list">
          {systemLog.length === 0 && <p className="idle">Awaiting runtime events...</p>}
          {systemLog.map((entry) => (
            <div key={entry.id} className={`system-log-item ${entry.level}`.trim()}>
              <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
              <p>{entry.text}</p>
            </div>
          ))}
        </div>
      </section>

      <main className={`battle-grid ${tensionZoom ? "camera-zoom" : ""} ${isShaking ? "camera-shake" : ""}`.trim()}>
        <section className="agents-panel panel">
          <div className="panel-head">
            <h2>AGENT CHAMBER</h2>
            <span>{replayState.sessionId ? `Session: ${replayState.sessionId}` : "Idle"}</span>
          </div>
          <div className="agents-grid">
            {AGENTS.map((agent) => {
              const turn = replayState.turns[agent.id];
              const isThinking = replayState.thinkingAgents.has(agent.id);
              const isWinner = replayState.outcome?.winnerAgentId === agent.id;
              const isManipulator = agent.id === "manipulator";
              const glitchClass = isManipulator && manipulatorGlitch ? "glitch" : "";
              const hasDirectedFocus = Boolean(focusAgentId) && !outcomeTakeover;
              const isFocused = focusAgentId === agent.id && hasDirectedFocus;
              const isMuted = hasDirectedFocus && focusAgentId !== agent.id;
              const beatClass = isFocused ? (focusBeat === "snap" ? "focus-snap" : focusBeat === "aggressive" ? "focus-aggressive" : "") : "";

              return (
                <motion.article
                  layout
                  key={agent.id}
                  className={`agent-card ${isWinner ? "winner" : ""} ${glitchClass} ${isFocused ? "focused" : ""} ${isMuted ? "deemphasized" : ""} ${beatClass}`.trim()}
                  style={{ borderColor: agent.color, boxShadow: `0 0 0 1px ${agent.color}22, 0 0 32px ${agent.color}22` }}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35 }}
                >
                  <div className="agent-head">
                    <div>
                      <h3>{agent.name}</h3>
                      <p>{agent.role}</p>
                    </div>
                    <span className="vibe">{agent.vibe}</span>
                  </div>

                  <div className="agent-body">
                    {isThinking && <p className="thinking">Analyzing live signal...</p>}
                    {turn ? (
                      <>
                        <p className="decision">{decisionLabel[turn.decision]}</p>
                        <p className="reasoning">{turn.reasoning}</p>
                        <div className="metrics">
                          <span>CONF {turn.confidence}%</span>
                          <span>RISK {turn.risk}%</span>
                          {turn.maliciousSignal && <span className="malicious">MANIPULATION SIGNAL</span>}
                        </div>
                      </>
                    ) : (
                      !isThinking && <p className="idle">Awaiting deployment...</p>
                    )}
                  </div>
                </motion.article>
              );
            })}
          </div>
        </section>

        <section className="conflict-panel panel">
          <div className="panel-head">
            <h2>CONFLICT RADAR</h2>
            <span>{replayState.activeScenario || "No active scenario"}</span>
          </div>

          <div className="radar-block">
            <p>DISAGREEMENT INDEX</p>
            <div className="meter">
              <motion.div
                className="meter-fill"
                animate={{ width: `${disagreementIndex}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </div>
            <strong>{disagreementIndex}%</strong>
          </div>

          <div className="decision-stack">
            {Array.from(decisionCounts.entries()).map(([decision, count]) => (
              <div key={decision} className="decision-row">
                <span>{decisionLabel[decision]}</span>
                <div className="mini-meter">
                  <motion.div animate={{ width: `${(count / AGENTS.length) * 100}%` }} transition={{ duration: 0.35 }} />
                </div>
                <b>{count}</b>
              </div>
            ))}
            {decisionCounts.size === 0 && <p className="idle">No decisions yet.</p>}
          </div>

          <div className="timeline">
            <h3>ESCALATION FEED</h3>
            <AnimatePresence>
              {replayState.rebuttals.slice(-6).map((rebuttal, index) => (
                <motion.div
                  key={`${rebuttal.agentId}-${index}-${rebuttal.text}`}
                  className="timeline-item"
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                >
                  <p>
                    <strong>{rebuttal.agentId}</strong> challenges <strong>{rebuttal.targetAgentId}</strong>
                  </p>
                  <span>{rebuttal.text}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      </main>

      <AnimatePresence>
        {outcomeVisible && replayState.outcome && (
          <motion.section
            className="outcome-takeover"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <button
              className="outcome-close"
              onClick={() => setDismissedOutcomeTimestamp(replayState.outcome?.timestamp ?? null)}
              aria-label="Close outcome overlay"
            >
              ×
            </button>
            <p>SYSTEM VERDICT</p>
            <h2>{replayState.outcome.winnerAgentId.toUpperCase()} WINS</h2>
            <strong>{replayState.outcome.summary}</strong>
            {replayState.outcome.manipulationDetected && <span>Manipulation attempt failed integrity checks.</span>}
          </motion.section>
        )}
      </AnimatePresence>

      <footer className="outcome-layer panel">
        <div className="panel-head">
          <h2>OUTCOME LAYER</h2>
          <span>{events.length ? `${events.length} events streamed` : "Waiting for conflict"}</span>
        </div>
        {replayState.outcome ? (
          <div className="outcome-grid">
            <div>
              <p>WINNER</p>
              <h3>{replayState.outcome.winnerAgentId}</h3>
            </div>
            <div>
              <p>RISK LEVEL</p>
              <h3>{replayState.outcome.riskLevel}</h3>
            </div>
            <div>
              <p>CONSENSUS</p>
              <h3>{replayState.outcome.consensusScore}%</h3>
            </div>
            <div>
              <p>MALICIOUS SIGNAL</p>
              <h3>{replayState.outcome.manipulationDetected ? "DETECTED" : "NONE"}</h3>
            </div>
            {replayState.outcome.manipulationDetected && (
              <p className="manipulation-warning">This agent attempted to manipulate the decision.</p>
            )}
            <p className="summary">{replayState.outcome.summary}</p>
          </div>
        ) : (
          <p className="idle">Run a scenario to reveal who collapses under pressure.</p>
        )}
      </footer>
    </div>
  );
}

export default App;
