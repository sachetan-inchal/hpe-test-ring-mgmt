"use client";

import { useEffect, useMemo, useState } from "react";

type DeviceInfo = {
  ip: string;
  file: string;
};

type DiscoveryEvent = {
  type: "progress" | "complete" | "error";
  command?: string;
  msg?: string;
  nodes?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
  summary?: Record<string, unknown>;
  graph?: Record<string, unknown>;
};

type SanLabPanelProps = {
  backendUrl: string;
  token?: string;
  onClose: () => void;
};

type TerminalLine = {
  kind: "prompt" | "output" | "error" | "system";
  text: string;
};

export default function SanLabPanel({ backendUrl, token, onClose }: SanLabPanelProps) {
  const [activeTab, setActiveTab] = useState<"discovery" | "terminal">("discovery");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [seedIp, setSeedIp] = useState("10.20.10.5");
  const [discoveryRunning, setDiscoveryRunning] = useState(false);
  const [discoveryEvents, setDiscoveryEvents] = useState<DiscoveryEvent[]>([]);
  const [discoveryStatus, setDiscoveryStatus] = useState<Record<string, unknown> | null>(null);
  const [selectedDevice, setSelectedDevice] = useState("10.20.10.5");
  const [connectedDevice, setConnectedDevice] = useState<string | null>(null);
  const [terminalCommand, setTerminalCommand] = useState("showsys");
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([
    { kind: "system", text: "SAN CLI ready. Use connect <ip> or run a command against a device." },
  ]);
  const [terminalBusy, setTerminalBusy] = useState(false);

  const authHeaders = useMemo(() => {
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }, [token]);

  useEffect(() => {
    let mounted = true;

    async function loadDevices() {
      try {
        const response = await fetch(`${backendUrl}/san/cli/devices`, {
          headers: authHeaders,
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as { devices?: DeviceInfo[] };
        if (mounted && Array.isArray(payload.devices)) {
          setDevices(payload.devices);
          if (payload.devices[0]?.ip) {
            setSeedIp(payload.devices[0].ip);
            setSelectedDevice(payload.devices[0].ip);
          }
        }
      } catch {
        // Keep the panel usable even if the discovery backend is unavailable.
      }
    }

    async function loadStatus() {
      try {
        const response = await fetch(`${backendUrl}/san/discovery/status`, {
          headers: authHeaders,
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as Record<string, unknown>;
        if (mounted) {
          setDiscoveryStatus(payload);
        }
      } catch {
        // Ignore status load errors.
      }
    }

    loadDevices();
    loadStatus();
    return () => {
      mounted = false;
    };
  }, [authHeaders, backendUrl]);

  useEffect(() => {
    let source: EventSource | null = null;
    if (!discoveryRunning) {
      return () => {
        source?.close();
      };
    }

    source = new EventSource(`${backendUrl}/san/discovery/stream`);
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as DiscoveryEvent;
      setDiscoveryEvents((prev) => [...prev, payload]);
      if (payload.type === "complete") {
        setDiscoveryRunning(false);
        source?.close();
        source = null;
        setDiscoveryStatus(payload.summary ? { summary: payload.summary } : null);
      }
      if (payload.type === "error") {
        setDiscoveryRunning(false);
        source?.close();
        source = null;
      }
    };
    source.onerror = () => {
      setDiscoveryRunning(false);
      source?.close();
      source = null;
      setDiscoveryEvents((prev) => [...prev, { type: "error", msg: "Lost connection to discovery stream." }]);
    };

    return () => {
      source?.close();
    };
  }, [backendUrl, discoveryRunning]);

  const appendLine = (kind: TerminalLine["kind"], text: string) => {
    setTerminalLines((prev) => [...prev, { kind, text }]);
  };

  const startDiscovery = async () => {
    setDiscoveryEvents([]);
    setDiscoveryStatus(null);
    setDiscoveryRunning(true);
    try {
      const response = await fetch(`${backendUrl}/san/discovery/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({ seed_ip: seedIp }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(payload.detail || "Failed to start discovery");
      }
    } catch (error) {
      setDiscoveryRunning(false);
      const message = error instanceof Error ? error.message : "Discovery failed";
      setDiscoveryEvents((prev) => [...prev, { type: "error", msg: message }]);
    }
  };

  const connectDevice = async (ip: string) => {
    const trimmed = ip.trim();
    if (!trimmed) {
      return;
    }
    appendLine("prompt", `ssh ${trimmed}`);
    setTerminalBusy(true);
    try {
      const response = await fetch(`${backendUrl}/san/cli/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({ ip: trimmed }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        status?: string;
        device_file?: string;
        system_output?: string;
        available_commands?: string[];
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(payload.detail || "Connection failed");
      }
      setConnectedDevice(trimmed);
      appendLine("system", `Connected to ${trimmed} (${payload.device_file || "unknown"}).`);
      if (payload.system_output) {
        appendLine("output", payload.system_output.trim());
      }
      if (payload.available_commands?.length) {
        appendLine("system", `Available commands: ${payload.available_commands.join(", ")}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection failed";
      appendLine("error", message);
    } finally {
      setTerminalBusy(false);
    }
  };

  const runCommand = async (value?: string) => {
    const raw = (value ?? terminalCommand).trim();
    if (!raw || terminalBusy) {
      return;
    }

    if (raw === "clear") {
      setTerminalLines([{ kind: "system", text: "Screen cleared." }]);
      return;
    }

    if (raw === "exit") {
      setConnectedDevice(null);
      appendLine("system", "Disconnected.");
      return;
    }

    if (raw.startsWith("connect ")) {
      await connectDevice(raw.split(/\s+/, 2)[1] || selectedDevice);
      setTerminalCommand("");
      return;
    }

    const device = connectedDevice || selectedDevice;
    appendLine("prompt", `${device}> ${raw}`);
    setTerminalBusy(true);
    try {
      const response = await fetch(`${backendUrl}/san/cli/exec`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({ device, command: raw }),
      });
      const payload = (await response.json().catch(() => ({}))) as { output?: string; detail?: string };
      if (!response.ok) {
        throw new Error(payload.detail || "Command failed");
      }
      appendLine("output", payload.output || "");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Command failed";
      appendLine("error", message);
    } finally {
      setTerminalBusy(false);
    }
  };

  const summary = discoveryStatus?.summary as Record<string, unknown> | undefined;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md sm:p-6 md:p-8">
      <div className="flex h-full w-full max-w-[1480px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#09090b] shadow-2xl ring-1 ring-white/5">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-white/[0.02] px-6 py-5">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/20">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-400">SAN Lab Interface</div>
              <h2 className="mt-0.5 text-xl font-semibold text-white">Discovery and CLI Replay</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col bg-[#09090b] p-6">
          {/* Tabs */}
          <div className="mb-6 flex gap-2">
            <button
              onClick={() => setActiveTab("discovery")}
              className={`relative rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${activeTab === "discovery" ? "bg-white text-black shadow-lg" : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"}`}
            >
              Discovery
            </button>
            <button
              onClick={() => setActiveTab("terminal")}
              className={`relative rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${activeTab === "terminal" ? "bg-white text-black shadow-lg" : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"}`}
            >
              Terminal
            </button>
          </div>

          <div className="grid min-h-0 flex-1 gap-6 md:grid-cols-[320px_1fr]">
            <aside className="flex min-h-0 flex-col gap-4 overflow-hidden">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-4 shadow-inner">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Devices</div>
                <div className="mt-4 flex-1 space-y-2 overflow-y-auto pr-2 custom-scrollbar">
                  {devices.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 p-6 text-center">
                      <div className="text-zinc-500">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2 opacity-50"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                      </div>
                      <div className="text-sm text-zinc-400">No devices loaded.</div>
                    </div>
                  ) : (
                    devices.map((device) => (
                      <button
                        key={device.ip}
                        onClick={() => setSelectedDevice(device.ip)}
                        className={`group w-full rounded-xl border px-4 py-3 text-left transition-all ${selectedDevice === device.ip ? "border-indigo-500/50 bg-indigo-500/10 shadow-lg shadow-indigo-500/5" : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/5"}`}
                      >
                        <div className={`text-sm font-semibold ${selectedDevice === device.ip ? "text-indigo-400" : "text-zinc-300 group-hover:text-white"}`}>{device.ip}</div>
                        <div className="mt-1 truncate text-xs text-zinc-500">{device.file}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.02] p-5 shadow-inner">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Connection Status</div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-zinc-400">Selected</span>
                  <span className="text-sm font-medium text-white">{selectedDevice || "none"}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm text-zinc-400">Active</span>
                  <span className={`text-sm font-medium ${connectedDevice ? "text-emerald-400" : "text-zinc-500"}`}>{connectedDevice || "none"}</span>
                </div>
              </div>

              <div className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.02] p-5 shadow-inner">
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Quick Commands</div>
                <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[11px] text-zinc-400">
                  <div className="rounded border border-white/5 bg-white/5 px-2 py-1 text-center hover:bg-white/10 hover:text-white cursor-pointer transition-colors" onClick={() => setTerminalCommand("showsys")}>showsys</div>
                  <div className="rounded border border-white/5 bg-white/5 px-2 py-1 text-center hover:bg-white/10 hover:text-white cursor-pointer transition-colors" onClick={() => setTerminalCommand("shownode")}>shownode</div>
                  <div className="rounded border border-white/5 bg-white/5 px-2 py-1 text-center hover:bg-white/10 hover:text-white cursor-pointer transition-colors" onClick={() => setTerminalCommand("showport")}>showport</div>
                  <div className="rounded border border-white/5 bg-white/5 px-2 py-1 text-center hover:bg-white/10 hover:text-white cursor-pointer transition-colors" onClick={() => setTerminalCommand("showhost")}>showhost</div>
                  <div className="rounded border border-white/5 bg-white/5 px-2 py-1 text-center hover:bg-white/10 hover:text-white cursor-pointer transition-colors" onClick={() => setTerminalCommand("showpd")}>showpd</div>
                  <div className="rounded border border-white/5 bg-white/5 px-2 py-1 text-center hover:bg-white/10 hover:text-white cursor-pointer transition-colors" onClick={() => setTerminalCommand("clear")}>clear</div>
                </div>
              </div>
            </aside>

            <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0c0c0e] shadow-inner ring-1 ring-white/5">
              {activeTab === "discovery" ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-white/[0.02] px-6 py-4">
                    <div>
                      <h3 className="text-sm font-semibold text-white">BFS Discovery</h3>
                      <p className="text-xs text-zinc-500">Replay the SAN discovery flow against bundled logs.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <select
                        value={seedIp}
                        onChange={(event) => setSeedIp(event.target.value)}
                        className="rounded-xl border border-white/10 bg-[#09090b] px-4 py-2 text-sm text-white outline-none focus:border-indigo-500/50"
                      >
                        {devices.map((device) => (
                          <option key={device.ip} value={device.ip}>
                            {device.ip}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={startDiscovery}
                        disabled={discoveryRunning}
                        className="relative flex items-center gap-2 overflow-hidden rounded-xl bg-indigo-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition-all hover:bg-indigo-400 disabled:opacity-50 disabled:shadow-none"
                      >
                        {discoveryRunning && (
                          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-25" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" /></svg>
                        )}
                        {discoveryRunning ? "Discovering..." : "Start Discovery"}
                      </button>
                    </div>
                  </div>

                  <div className="grid min-h-0 flex-1 gap-6 p-6 xl:grid-cols-[300px_1fr]">
                    <div className="space-y-6">
                      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Status</div>
                        <div className="mt-3 flex items-center gap-3">
                          <span className="relative flex h-3 w-3">
                            {discoveryRunning && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75"></span>}
                            <span className={`relative inline-flex h-3 w-3 rounded-full ${discoveryRunning ? "bg-indigo-500" : "bg-zinc-600"}`}></span>
                          </span>
                          <span className="text-sm font-medium text-white">{discoveryRunning ? "Running" : "Idle"}</span>
                        </div>
                        {summary ? (
                          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                            <div className="flex flex-col items-center justify-center rounded-xl bg-white/5 p-4">
                              <div className="text-2xl font-light text-white">{String(summary.total_nodes ?? 0)}</div>
                              <div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-zinc-500">Nodes</div>
                            </div>
                            <div className="flex flex-col items-center justify-center rounded-xl bg-white/5 p-4">
                              <div className="text-2xl font-light text-white">{String(summary.total_edges ?? 0)}</div>
                              <div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-zinc-500">Edges</div>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Entity Breakdown</div>
                        <div className="mt-4 space-y-2 text-sm text-zinc-300">
                          {summary?.by_type && typeof summary.by_type === "object" ? (
                            Object.entries(summary.by_type as Record<string, unknown>).map(([key, value]) => (
                              <div key={key} className="flex items-center justify-between rounded-lg bg-white/5 px-4 py-2.5">
                                <span>{key}</span>
                                <span className="font-semibold text-white">{String(value)}</span>
                              </div>
                            ))
                          ) : (
                            <div className="text-center text-zinc-500 py-4">No discovery summary yet.</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/5 bg-[#050505]">
                      <div className="border-b border-white/5 bg-white/[0.02] px-5 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                        Live Stream Log
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto p-5 font-mono text-[13px]">
                        {discoveryEvents.length === 0 ? (
                          <div className="flex h-full flex-col items-center justify-center text-zinc-500">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mb-3 opacity-50"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
                            <div>Awaiting discovery stream...</div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {discoveryEvents.map((event, index) => (
                              <div key={`${event.type}-${index}`} className="rounded-xl border border-white/5 bg-white/[0.02] p-4 text-zinc-300">
                                <div className="mb-2 flex items-center gap-3">
                                  <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${event.type === 'error' ? 'bg-rose-500/10 text-rose-400' : event.type === 'complete' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-indigo-500/10 text-indigo-400'}`}>
                                    {event.type}
                                  </span>
                                  {event.command && (
                                    <span className="text-[10px] text-zinc-500">{event.command}</span>
                                  )}
                                </div>
                                <div className="break-words leading-relaxed">{event.msg || "{ no message }"}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-0 flex-col bg-[#050505]">
                  <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-white/[0.02] px-6 py-4">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Interactive Terminal</h3>
                      <p className="text-xs text-zinc-500">Run CLI commands on the emulated device.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => connectDevice(selectedDevice)}
                        className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-sm font-semibold text-indigo-400 transition-colors hover:bg-indigo-500/20"
                      >
                        Connect via SSH
                      </button>
                      <button
                        onClick={() => runCommand("clear")}
                        className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        Clear Buffer
                      </button>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto p-6 font-mono text-[13px] leading-relaxed">
                    {terminalLines.map((line, index) => (
                      <div
                        key={`${line.kind}-${index}`}
                        className={
                          line.kind === "error"
                            ? "mb-1 whitespace-pre-wrap text-rose-400"
                            : line.kind === "system"
                              ? "mb-1 whitespace-pre-wrap text-emerald-400/80"
                              : line.kind === "prompt"
                                ? "mb-1 mt-3 whitespace-pre-wrap font-semibold text-indigo-300"
                                : "mb-1 whitespace-pre-wrap text-zinc-300"
                        }
                      >
                        {line.text}
                      </div>
                    ))}
                  </div>

                  <div className="shrink-0 border-t border-white/10 bg-[#09090b] p-6">
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#050505] p-2 ring-1 ring-white/5 focus-within:border-indigo-500/50 focus-within:ring-indigo-500/20">
                      <div className="pl-3 font-mono text-sm font-semibold text-indigo-400">
                        {connectedDevice || selectedDevice}&gt;
                      </div>
                      <input
                        value={terminalCommand}
                        onChange={(event) => setTerminalCommand(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void runCommand();
                          }
                        }}
                        placeholder="Type command..."
                        className="min-w-0 flex-1 bg-transparent py-2 font-mono text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
                      />
                      <button
                        onClick={() => void runCommand()}
                        disabled={terminalBusy}
                        className="rounded-xl bg-white px-5 py-2 text-sm font-semibold text-black transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                      >
                        Execute
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
