import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import DarkVeil from "./components/DarkVeil";
import { TimelineScrubber } from "./components/TimelineScrubber";
import { narrationForEvent } from "./narration";
import { getDurationMs, getEventMarkers, getRelativeTime, resolveReplayState } from "./replayEngine";
import type { Decision, MatchEvent, MatchMode } from "./types";
import { connectWalletConnect, type WalletEventProvider } from "./walletConnect";

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

type HealthPayload = {
  llmProviderHint?: string;
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

const curatedWatchScenarios = [
  "Should I ape into this new meme coin?",
  "Should I long ETH right now?",
  "Should I launch this meme token?"
];

const lockedDemoScenario = "Should I ape into this new meme coin?";

const decisionLabel: Record<Decision, string> = {
  BUY: "BUY",
  SELL: "SELL",
  HOLD: "HOLD",
  DO_NOT_TOUCH: "DO NOT TOUCH",
  LAUNCH: "LAUNCH",
  WAIT: "WAIT"
};

const sceneStageLabel = (event: MatchEvent | null) => {
  if (!event || event.type === "match_started" || event.type === "agent_thinking") {
    return "STAGE 1 · DECISION";
  }
  if (event.type === "agent_decision") {
    return "STAGE 1 · DECISION";
  }
  if (event.type === "agent_rebuttal") {
    return "STAGE 2 · REBUTTAL";
  }
  if (event.type === "agent_escalation") {
    return "STAGE 3 · ESCALATION";
  }
  return "STAGE 4 · COLLAPSE";
};

const socketUrl = (import.meta as ImportMeta & { env: { VITE_VEIL_SERVER?: string } }).env.VITE_VEIL_SERVER ?? "http://localhost:8787";
const walletConnectProjectId =
  (import.meta as ImportMeta & { env: { VITE_WALLETCONNECT_PROJECT_ID?: string } }).env.VITE_WALLETCONNECT_PROJECT_ID ??
  "e40e7554a29d019bedaad883896164a4";

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
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletPopupOpen, setWalletPopupOpen] = useState(false);
  const [walletProvider, setWalletProvider] = useState<WalletEventProvider | null>(null);
  const [llmProviderHint, setLlmProviderHint] = useState<string>("unknown");

  const soundEnabledRef = useRef(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const ambientNodesRef = useRef<AmbientNodes | null>(null);
  const lastAudibleEventIndexRef = useRef(-1);
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

  const getInjectedProvider = () => {
    return (globalThis as typeof globalThis & { ethereum?: WalletEventProvider }).ethereum;
  };

  const shortAddress = (value: string) => `${value.slice(0, 6)}...${value.slice(-4)}`;

  const chainLabel = (chainId: string | null) => {
    if (!chainId) {
      return "No chain";
    }
    if (chainId === "0x38") {
      return "BNB Chain";
    }
    if (chainId === "0x1") {
      return "Ethereum";
    }
    if (chainId === "0x89") {
      return "Polygon";
    }
    return `Chain ${chainId}`;
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

    if (event.type === "agent_escalation") {
      const heavy = event.severity === "high";
      playTone({ type: "sawtooth", frequency: heavy ? 132 : 176, duration: heavy ? 0.14 : 0.11, volume: 0.024 });
      playTone({ type: "square", frequency: heavy ? 74 : 92, duration: 0.1, volume: 0.015, delayMs: 24 });
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

      if (incomingEvent.type === "agent_escalation") {
        appendLog({
          level: incomingEvent.severity === "high" ? "warning" : "info",
          text: `${incomingEvent.agentId} escalated against ${incomingEvent.targetAgentId}`,
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
    let disposed = false;

    const loadHealth = async () => {
      try {
        const response = await fetch(`${socketUrl}/health`);
        if (!response.ok || disposed) {
          return;
        }
        const payload = (await response.json()) as HealthPayload;
        if (!disposed) {
          setLlmProviderHint(payload.llmProviderHint ?? "unknown");
        }
      } catch {
        if (!disposed) {
          setLlmProviderHint("unreachable");
        }
      }
    };

    void loadHealth();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const provider = walletProvider;
    if (!provider?.on || !provider.removeListener) {
      return;
    }

    const onAccountsChanged = (...args: unknown[]) => {
      const nextAccounts = args[0] as string[] | undefined;
      const account = nextAccounts?.[0] ?? null;
      setWalletAddress(account);
      if (!account) {
        setWalletChainId(null);
      }
    };

    const onChainChanged = (...args: unknown[]) => {
      const nextChain = args[0] as string | undefined;
      if (nextChain) {
        setWalletChainId(nextChain);
      }
    };

    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);

    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [walletProvider]);

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

    if (event.type === "agent_escalation") {
      setFocusAgentId(event.agentId);
      setFocusBeat("aggressive");
      setIsShaking(true);
      if (shakeTimerRef.current) {
        window.clearTimeout(shakeTimerRef.current);
      }
      shakeTimerRef.current = window.setTimeout(() => {
        setIsShaking(false);
      }, event.severity === "high" ? 360 : 280);
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

  const ensureWalletConnected = () => {
    if (walletAddress) {
      return true;
    }

    const message = "Please connect your wallet first.";
    setWalletError(message);
    setWalletPopupOpen(true);
    appendLog({
      level: "warning",
      text: "Operation blocked: wallet connection required.",
      timestamp: Date.now()
    });
    return false;
  };

  const startVeil = () => {
    if (!ensureWalletConnected() || !socket || scenario.trim().length < 3) {
      return;
    }

    const nextSessionId = `match_${Date.now().toString(36)}`;
    resetPlayback([], true);
    socket.emit("scenario:start", { scenario: scenario.trim(), sessionId: nextSessionId, mode: runMode });
  };

  const runDemo = () => {
    if (!ensureWalletConnected() || !socket) {
      return;
    }

    const demoSessionId = `demo_${Date.now().toString(36)}`;
    resetPlayback([], true);
    socket.emit("scenario:start", {
      scenario: lockedDemoScenario,
      sessionId: demoSessionId,
      mode: "demo"
    });
  };

  const runWatchScenario = (selectedScenario: string) => {
    if (!ensureWalletConnected() || !socket) {
      return;
    }

    const demoSessionId = `watch_${Date.now().toString(36)}`;
    setScenario(selectedScenario);
    resetPlayback([], true);
    socket.emit("scenario:start", {
      scenario: selectedScenario,
      sessionId: demoSessionId,
      mode: "demo"
    });
  };

  const connectWallet = async () => {
    try {
      setWalletError(null);
      const injected = getInjectedProvider();

      if (injected?.request) {
        const accounts = (await injected.request({ method: "eth_requestAccounts" })) as string[];
        const chain = (await injected.request({ method: "eth_chainId" })) as string;
        setWalletAddress(accounts?.[0] ?? null);
        setWalletChainId(chain ?? null);
        setWalletPopupOpen(false);
        setWalletProvider(injected);
        appendLog({
          level: "success",
          text: "Injected wallet connected for Web3 context.",
          timestamp: Date.now()
        });
        return;
      }

      const wc = await connectWalletConnect(walletConnectProjectId);
      setWalletAddress(wc.account);
      setWalletChainId(wc.chainId);
      setWalletPopupOpen(false);
      setWalletProvider(wc.provider);
      appendLog({
        level: "success",
        text: "WalletConnect session established.",
        timestamp: Date.now()
      });
    } catch {
      setWalletError("Wallet connection rejected");
      appendLog({
        level: "warning",
        text: "Wallet connection canceled.",
        timestamp: Date.now()
      });
    }
  };

  const exportReplay = () => {
    if (!ensureWalletConnected()) {
      return;
    }

    if (!latestReplayPayload) {
      appendLog({
        level: "warning",
        text: "Replay export skipped: latest timeline is not ready.",
        timestamp: Date.now()
      });
      return;
    }

    const blob = new Blob([JSON.stringify(latestReplayPayload, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `veil-replay-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
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

  const latestReplayPayload = useMemo(() => {
    if (events.length === 0) {
      return null;
    }

    const hasInvalidTimestampFlow = events.some((event, index) => index > 0 && event.timestamp < events[index - 1].timestamp);
    if (hasInvalidTimestampFlow) {
      return null;
    }

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      events
    };
  }, [events]);

  const providerBadge = useMemo(() => {
    if (llmProviderHint === "dgrid") {
      return "DGRID GATEWAY";
    }
    if (llmProviderHint === "groq") {
      return "GROQ GATEWAY";
    }
    if (llmProviderHint === "openai") {
      return "OPENAI-COMPAT";
    }
    if (llmProviderHint === "unreachable") {
      return "GATEWAY OFFLINE";
    }
    return "CUSTOM GATEWAY";
  }, [llmProviderHint]);

  const myxPerpSignal = useMemo(() => {
    const outcome = replayState.outcome;
    if (!outcome) {
      return null;
    }

    const winnerTurn = replayState.turns[outcome.winnerAgentId];
    const winnerDecision = winnerTurn?.decision;
    let action = "NO-TRADE";

    if (winnerDecision === "BUY" || winnerDecision === "LAUNCH") {
      action = "LONG";
    } else if (winnerDecision === "SELL") {
      action = "SHORT";
    }

    if (outcome.manipulationDetected && outcome.riskLevel === "HIGH") {
      action = "NO-TRADE";
    }

    const leverage = outcome.riskLevel === "LOW" ? "3x" : outcome.riskLevel === "MEDIUM" ? "2x" : "1x";
    const stopLoss = outcome.riskLevel === "LOW" ? "3.4%" : outcome.riskLevel === "MEDIUM" ? "2.6%" : "1.8%";

    return {
      action,
      leverage,
      stopLoss,
      confidence: `${Math.max(35, outcome.consensusScore)}%`
    };
  }, [replayState.outcome, replayState.turns]);

  const replayHighlights = useMemo(() => {
    if (events.length === 0) {
      return [] as Array<{ label: string; atMs: number }>;
    }

    const firstConflict = events.find((event) => event.type === "agent_rebuttal" || event.type === "agent_escalation");
    const peakManipulation = events.find(
      (event) =>
        (event.type === "agent_decision" && (event.turn.agentId === "manipulator" || event.turn.maliciousSignal)) ||
        (event.type === "agent_escalation" && (event.agentId === "manipulator" || event.targetAgentId === "manipulator"))
    );
    const finalOutcome = events.find((event) => event.type === "outcome");

    const markers = [
      firstConflict ? { label: "FIRST CONFLICT", atMs: getRelativeTime(events, firstConflict.timestamp) } : null,
      peakManipulation ? { label: "PEAK MANIPULATION", atMs: getRelativeTime(events, peakManipulation.timestamp) } : null,
      finalOutcome ? { label: "FINAL OUTCOME", atMs: getRelativeTime(events, finalOutcome.timestamp) } : null
    ].filter((item): item is { label: string; atMs: number } => Boolean(item));

    const seen = new Set<string>();
    return markers.filter((item) => {
      if (seen.has(item.label)) {
        return false;
      }
      seen.add(item.label);
      return true;
    });
  }, [events]);

  const outcomeSecondaryLine = useMemo(() => {
    const outcome = replayState.outcome;
    if (!outcome) {
      return null;
    }
    if (outcome.winnerAgentId !== "manipulator") {
      return `Prevented by: ${outcome.winnerAgentId}`;
    }
    return null;
  }, [replayState.outcome]);

  const shareVeil = async () => {
    if (!ensureWalletConnected() || !replayState.outcome || !replayState.activeScenario) {
      return;
    }

    const text = [
      `VEIL RESULT`,
      `Scenario: ${replayState.activeScenario}`,
      `Winner: ${replayState.outcome.winnerAgentId}`,
      `Impact: ${replayState.outcome.impactStatement}`
    ].join("\n");

    try {
      if (navigator.share) {
        await navigator.share({
          title: "VEIL Result",
          text
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }

      appendLog({
        level: "success",
        text: "Share snippet ready.",
        timestamp: Date.now()
      });
    } catch {
      appendLog({
        level: "warning",
        text: "Share canceled or unavailable.",
        timestamp: Date.now()
      });
    }
  };

  const currentScene = useMemo(() => {
    const event = replayState.lastEvent;
    if (!event) {
      return {
        stage: "STAGE 1 · DECISION",
        speaker: "SYSTEM",
        text: "Awaiting first move..."
      };
    }

    if (event.type === "agent_decision") {
      return {
        stage: sceneStageLabel(event),
        speaker: event.turn.agentId,
        text: event.turn.reasoning
      };
    }

    if (event.type === "agent_rebuttal" || event.type === "agent_escalation") {
      return {
        stage: sceneStageLabel(event),
        speaker: event.agentId,
        text: event.text
      };
    }

    if (event.type === "outcome") {
      return {
        stage: sceneStageLabel(event),
        speaker: event.winnerAgentId,
        text: event.impactStatement
      };
    }

    if (event.type === "match_started") {
      return {
        stage: sceneStageLabel(event),
        speaker: "SYSTEM",
        text: "Arena synchronized. Agents are loading conflict posture."
      };
    }

    return {
      stage: sceneStageLabel(event),
      speaker: event.agentId,
      text: "Agents are locking targets..."
    };
  }, [replayState.lastEvent]);

  return (
    <div
      className={`app-shell ${outcomeVisible ? "camera-outcome" : ""}`.trim()}
      onClickCapture={(event) => {
        const target = event.target as HTMLElement;
        const button = target.closest("button");
        if (!button || walletAddress || button.classList.contains("wallet-float-btn") || button.closest(".wallet-popup")) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        ensureWalletConnected();
      }}
    >
      <div className="darkveil-layer">
        <DarkVeil hueShift={18} noiseIntensity={0.03} speed={2.15} scanlineIntensity={0.08} scanlineFrequency={1.5} warpAmount={0.28} />
      </div>

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

      <button className="wallet-float-btn" onClick={() => void connectWallet()}>
        {walletAddress ? "WALLET CONNECTED" : "CONNECT WALLET"}
      </button>

      <AnimatePresence>
        {walletPopupOpen && !walletAddress && (
          <motion.div
            className="wallet-popup-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.section
              className="wallet-popup"
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              role="dialog"
              aria-modal="true"
              aria-label="Wallet required"
            >
              <h3>Wallet Required</h3>
              <p>Please connect your wallet first.</p>
              <div className="wallet-popup-actions">
                <button className="control-btn" onClick={() => setWalletPopupOpen(false)}>
                  Close
                </button>
                <button className="watch-cta" onClick={() => void connectWallet()}>
                  CONNECT WALLET
                </button>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="hero">
        <img className="hero-logo" src="/Veil-Logo.png" alt="VEIL logo" />
        <p className="eyebrow">REAL-TIME AI BATTLEGROUND</p>
        <h1>VEIL</h1>
        <p className="tagline">Where AI agents don’t agree — they compete.</p>
        <button className="watch-cta" onClick={runDemo}>WATCH A VEIL</button>
      </header>

      <section className="value-statement panel">
        <strong>AI sounds convincing even when it’s wrong. VEIL shows that before it costs you.</strong>
      </section>

      <section className="scenario-bar">
        <input value={scenario} onChange={(event) => setScenario(event.target.value)} placeholder="Enter a scenario..." />
        <button onClick={startVeil}>INITIATE VEIL</button>
        <button className="demo-btn" onClick={runDemo}>WATCH NEXT VEIL</button>
      </section>

      <section className="watch-picks">
        {curatedWatchScenarios.map((item) => (
          <button key={item} className="watch-pick-btn" onClick={() => runWatchScenario(item)}>
            {item}
          </button>
        ))}
      </section>

      <section className="controls-bar">
        <button className={`control-btn ${runMode === "live-ai" ? "mode-active" : ""}`.trim()} onClick={() => setRunMode("live-ai")}>
          LIVE AI
        </button>
        <button className={`control-btn ${runMode === "simulation" ? "mode-active" : ""}`.trim()} onClick={() => setRunMode("simulation")}>
          SIMULATION
        </button>
        <button className="control-btn" disabled={!latestReplayPayload} onClick={exportReplay}>
          EXPORT REPLAY JSON
        </button>
        <button className="control-btn" disabled={!replayState.outcome} onClick={() => void shareVeil()}>
          SHARE THIS VEIL
        </button>
      </section>

      {walletError && <p className="warning-chip">{walletError}</p>}

      {serverWarning && <p className="warning-chip">{serverWarning}</p>}

      <TimelineScrubber
        cursorMs={cursorMs}
        durationMs={durationMs}
        isPlaying={isPlaying}
        markers={markers}
        highlights={replayHighlights}
        onSeek={handleSeek}
        onReplay={handleReplay}
        onPlayPause={togglePlayPause}
      />

      <section className="scene-panel panel">
        <div className="panel-head">
          <h2>LIVE SCENE</h2>
          <span>{currentScene.stage}</span>
        </div>
        <div className="scene-line">
          <strong>{currentScene.speaker.toUpperCase()}</strong>
          <p>{currentScene.text}</p>
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
              {[...replayState.rebuttals, ...replayState.escalations].slice(-7).map((rebuttal, index) => (
                <motion.div
                  key={`${rebuttal.agentId}-${index}-${rebuttal.text}`}
                  className={`timeline-item ${"severity" in rebuttal ? rebuttal.severity : ""}`.trim()}
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
            <strong>{replayState.outcome.impactStatement}</strong>
            {outcomeSecondaryLine && <strong>{outcomeSecondaryLine}</strong>}
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
              <p>PROJECTED IMPACT</p>
              <h3>{replayState.outcome.projectedImpactPercent}%</h3>
            </div>
            <div>
              <p>MALICIOUS SIGNAL</p>
              <h3>{replayState.outcome.manipulationDetected ? "DETECTED" : "NONE"}</h3>
            </div>
            {replayState.outcome.manipulationDetected && (
              <p className="manipulation-warning">This agent attempted to manipulate the decision.</p>
            )}
            <p className="summary">{replayState.outcome.summary}</p>

            <section className="sponsor-fit-grid">
              <article className="sponsor-fit-card myx">
                <h4>MYX · PERP SIGNAL</h4>
                {myxPerpSignal ? (
                  <p>
                    {myxPerpSignal.action} · {myxPerpSignal.leverage} · SL {myxPerpSignal.stopLoss} · CONF {myxPerpSignal.confidence}
                  </p>
                ) : (
                  <p>Awaiting outcome to produce a signal.</p>
                )}
              </article>

              <article className="sponsor-fit-card pieverse">
                <h4>PIEVERSE · WEB3 CONTEXT</h4>
                <p>{walletAddress ? `${shortAddress(walletAddress)} on ${chainLabel(walletChainId)}` : "Connect wallet to attach chain context."}</p>
              </article>

              <article className="sponsor-fit-card dgrid">
                <h4>DGRID · LLM GATEWAY</h4>
                <p>Provider route: {providerBadge}</p>
              </article>
            </section>
          </div>
        ) : (
          <p className="idle">Run a scenario to reveal who collapses under pressure.</p>
        )}
      </footer>
    </div>
  );
}

export default App;
