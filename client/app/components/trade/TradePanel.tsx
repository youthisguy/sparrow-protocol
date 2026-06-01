"use client";

import { useState, useEffect, useCallback } from "react";
import { useChain, toUnit } from "@/app/context/ChainContext";
import PositionsTable from "./PositionsTable";

type TradeTab = "long" | "short";

type PositionStatus = "Healthy" | "MarginCall" | "Critical" | "Liquidatable";

interface PositionStatusData {
  positionId: BigInt;
  hf: number;
  status: PositionStatus;
  pnlAmount: bigint;
  isProfit: boolean;
  interest: bigint;
  collateralNow: bigint;
  collateralNeeded: bigint;
}

const STATUS_COLORS: Record<PositionStatus, string> = {
  Healthy: "var(--accent-green)",
  MarginCall: "var(--accent-amber)",
  Critical: "#ff8c00",
  Liquidatable: "var(--accent-red)",
};

const STATUS_LABELS: Record<PositionStatus, string> = {
  Healthy: "● Healthy",
  MarginCall: "⚠ Margin Call",
  Critical: "⚠ Critical",
  Liquidatable: "✕ Liquidatable",
};

function fmtBalance(val: bigint, decimals = 4): string {
  const divisor = 10n ** 12n;
  const whole = val / divisor;
  const frac = val % divisor;
  const fracStr = frac.toString().padStart(12, "0").slice(0, decimals);
  return `${whole}.${fracStr}`;
}

function decodeStatusTuple(
  raw: unknown,
  positionId: bigint
): PositionStatusData | null {
  let data = raw;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    data =
      (data as any).ok ?? (data as any).value ?? Object.values(data as any)[0];
  }

  if (!Array.isArray(data) || data.length < 7) {
    console.warn("decodeStatusTuple: unexpected shape", raw);
    return null;
  }

  const [
    hf,
    statusRaw,
    pnlAmount,
    isProfit,
    interest,
    collateralNow,
    collateralNeeded,
  ] = data;

  let status: PositionStatus = "Healthy";
  if (typeof statusRaw === "string") {
    const map: Record<string, PositionStatus> = {
      healthy: "Healthy",
      margincall: "MarginCall",
      critical: "Critical",
      liquidatable: "Liquidatable",
    };
    status = map[statusRaw.toLowerCase()] ?? (statusRaw as PositionStatus);
  } else if (statusRaw && typeof statusRaw === "object") {
    const key = Object.keys(statusRaw)[0];
    const map: Record<string, PositionStatus> = {
      healthy: "Healthy",
      marginCall: "MarginCall",
      margincall: "MarginCall",
      critical: "Critical",
      liquidatable: "Liquidatable",
    };
    status = map[key] ?? (key as PositionStatus);
  }

  const toBigInt = (v: unknown): bigint => {
    if (v === null || v === undefined) return 0n;
    const s = v.toString();
    return s.startsWith("0x") ? BigInt(s) : BigInt(s);
  };

  return {
    positionId,
    hf: Number(hf),
    status,
    pnlAmount: toBigInt(pnlAmount),
    isProfit: Boolean(isProfit),
    interest: toBigInt(interest),
    collateralNow: toBigInt(collateralNow),
    collateralNeeded: toBigInt(collateralNeeded),
  };
}

export default function TradePanel() {
  const {
    connected,
    connecting,
    connect,
    freeCollateral,
    currentPrice,
    sendTx,
    query,
    loading,
    addToast,
    positions,
  } = useChain();

  const [activeTab, setActiveTab] = useState<TradeTab>("long");
  const [collateralAmt, setCollateralAmt] = useState("");
  const [posLeverage, setPosLeverage] = useState(100);
  const [posCollateral, setPosCollateral] = useState("");
  const [mockPrice, setMockPrice] = useState("");
  const [mcHfInput, setMcHfInput] = useState("");
  const [statusMap, setStatusMap] = useState<
    Record<string, PositionStatusData>
  >({});
  const [addColInputs, setAddColInputs] = useState<Record<string, string>>({});

  // Gate modal state
  const [gateOpen, setGateOpen] = useState(false);

  const posDirection = activeTab === "long" ? "Long" : "Short";

  // ── Helper: run an action only if connected, else open gate ──────────────────
  const requireWallet = (action: () => void) => {
    if (!connected) {
      setGateOpen(true);
      return;
    }
    action();
  };

  // ── Poll get_position_status for every open position ─────────────────────────
  const pollPositionStatuses = useCallback(async () => {
    if (!connected || !positions?.length || typeof query !== "function") return;
    const updates: Record<string, PositionStatusData> = {};
    await Promise.all(
      positions.map(async (pos: { id: bigint | number }) => {
        const id = BigInt(pos.id);
        try {
          const raw = await query("margin", "getPositionStatus", [
            id.toString(),
          ]);
          console.log("raw status for", id.toString(), JSON.stringify(raw));
          const decoded = decodeStatusTuple(raw, id);
          if (decoded) updates[id.toString()] = decoded;
        } catch {}
      })
    );
    console.log("updates", updates);
    setStatusMap((prev) => ({ ...prev, ...updates }));
  }, [connected, positions, query]);

  useEffect(() => {
    pollPositionStatuses();
    const interval = setInterval(pollPositionStatuses, 6_000);
    return () => clearInterval(interval);
  }, [pollPositionStatuses]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleDepositCollateral = () =>
    requireWallet(() => {
      const amt = toUnit(collateralAmt);
      if (!amt) return addToast("Enter collateral amount", "error");
      sendTx("margin", "depositCollateral", [], amt, "Deposit Collateral");
      setCollateralAmt("");
    });

  const handleOpenPosition = () =>
    requireWallet(() => {
      const colAmt = toUnit(posCollateral);
      if (!colAmt) return addToast("Enter collateral for position", "error");
      const direction =
        posDirection === "Long" ? { Long: null } : { Short: null };
      sendTx(
        "margin",
        "openPosition",
        [direction, posLeverage, colAmt.toString()],
        0n,
        `Open ${posDirection}`
      );
      setPosCollateral("");
    });

  const handleSetMockPrice = () =>
    requireWallet(() => {
      const p = toUnit(mockPrice);
      if (!p) return addToast("Enter price", "error");
      sendTx("margin", "setMockPrice", [p.toString()], 0n, "Set Mock Price");
      setMockPrice("");
    });

  const handleSetMarginCallHf = () =>
    requireWallet(() => {
      const hf = parseInt(mcHfInput, 10);
      if (isNaN(hf) || hf <= 0)
        return addToast("Enter a valid HF value", "error");
      sendTx("margin", "setMarginCallHf", [hf], 0n, "Set Margin Call HF");
      setMcHfInput("");
    });

  const handleAddCollateralToPosition = (positionId: bigint) =>
    requireWallet(() => {
      const key = positionId.toString();
      const raw = addColInputs[key] ?? "";
      const amt = toUnit(raw);
      if (!amt) return addToast("Enter amount to add", "error");
      sendTx(
        "margin",
        "addCollateralToPosition",
        [key],
        amt,
        `Add Collateral #${key}`
      );
      setAddColInputs((prev) => ({ ...prev, [key]: "" }));
    });

  const token = {
    bgElevated: "#1e2225",
    border: "#2a2e32",
    textMuted: "#4a5260",
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 9,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 4,
  };

  const inputStyle: React.CSSProperties = {
    background: "transparent",
    border: "none",
    outline: "none",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 22,
    fontWeight: 500,
    color: "var(--text-primary)",
    width: "100%",
    padding: 0,
  };

  return (
    <>
      <div
        style={{ minHeight: "100%", overflowY: "auto" }}
        className="trade-panel-inner"
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* ── Long / Short tab bar ── */}
          <div style={{ display: "flex", gap: 6, padding: "10px 0px" }}>
            {(["long", "short"] as TradeTab[]).map((tab) => {
              const isActive = activeTab === tab;
              const isLong = tab === "long";
              const activeColor = isLong ? "#00d084" : "#ff4757";
              const activeDim = isLong
                ? "rgba(0,208,132,0.15)"
                : "rgba(255,71,87,0.15)";
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    flex: 1,
                    padding: "9px 0",
                    border: `1px solid ${
                      isActive ? activeColor : "var(--border)"
                    }`,
                    borderRadius: 12,
                    background: isActive ? activeDim : "transparent",
                    color: isActive ? activeColor : "var(--text-muted)",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: "0.05em",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {isLong ? "▲ Long" : "▼ Short"}
                </button>
              );
            })}
          </div>

          {/* ── Card body ── */}
          <div
            style={{
              padding: "18px 0px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Deposit collateral block */}
            <div
              style={{
                background: "var(--bg-elevated)",
                borderRadius: 10,
                border: "1px solid var(--border)",
                padding: "12px 14px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: "var(--text-muted)",
                    letterSpacing: "0.05em",
                  }}
                >
                  Add Collateral
                </span>
              </div>
              <input
                type="text"
                placeholder="0.00"
                value={collateralAmt}
                onChange={(e) => setCollateralAmt(e.target.value)}
                style={inputStyle}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 8,
                }}
              >
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 1 }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 9,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Available:
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 13,
                      color: "var(--accent-amber)",
                      fontWeight: 700,
                      lineHeight: 1,
                    }}
                  >
                    {connected ? freeCollateral : "—"}{" "}
                    <span style={{ fontSize: 9, opacity: 0.7 }}>POT</span>
                  </span>
                </div>
                <button
                  onClick={handleDepositCollateral}
                  disabled={!!loading}
                  style={{
                    background: "var(--accent-amber)",
                    color: "#0d0e0f",
                    border: "none",
                    borderRadius: 4,
                    padding: "3px 10px",
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {loading === "Deposit Collateral" ? "…" : "+ Add"}
                </button>
              </div>
            </div>

            {/* Position collateral input */}
            <div
              style={{
                background: token.bgElevated,
                borderRadius: 10,
                border: `1px solid ${token.border}`,
                padding: "12px 14px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: token.textMuted,
                    letterSpacing: "0.05em",
                  }}
                >
                  Collateral to Use (POT)
                </span>
              </div>
              <input
                type="text"
                placeholder="0.00"
                value={posCollateral}
                onChange={(e) => setPosCollateral(e.target.value)}
                style={{
                  ...inputStyle,
                  color: posCollateral
                    ? "var(--text-primary)"
                    : "var(--text-muted)",
                }}
              />
              {posCollateral && (
                <div className="position-size-preview">
                  Position size ≈{" "}
                  {(
                    (parseFloat(posCollateral || "0") * posLeverage) /
                    100
                  ).toFixed(3)}{" "}
                  POT
                </div>
              )}
            </div>

            {/* Leverage slider */}
            <div style={{ padding: "2px 0" }}>
              <div style={{ ...labelStyle, marginBottom: 8 }}>Leverage</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                {[100, 200, 300, 500].map((lev) => {
                  const isActive = posLeverage === lev;
                  return (
                    <button
                      key={lev}
                      onClick={() => setPosLeverage(lev)}
                      style={{
                        flex: 1,
                        padding: "5px 0",
                        borderRadius: 6,
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                        border: `1px solid ${
                          isActive ? "var(--accent-amber)" : "var(--border)"
                        }`,
                        background: isActive
                          ? "var(--accent-amber)"
                          : "transparent",
                        color: isActive ? "#0d0e0f" : "var(--text-muted)",
                        transition: "all 0.15s",
                      }}
                    >
                      {lev / 100}×
                    </button>
                  );
                })}
              </div>
              <div
                style={{
                  position: "relative",
                  height: 20,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    height: 6,
                    borderRadius: 3,
                    background: `repeating-linear-gradient(-55deg, transparent, transparent 3px, rgba(0,0,0,0.18) 3px, rgba(0,0,0,0.18) 5px), linear-gradient(to right, #2a9d3a, #f0c040, #e03030)`,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    height: 6,
                    borderRadius: "0 3px 3px 0",
                    background: "var(--bg-secondary, #1a1b1c)",
                    width: `${100 - ((posLeverage - 100) / 400) * 100}%`,
                    transition: "width 0.15s",
                  }}
                />
                <input
                  type="range"
                  min="100"
                  max="500"
                  step="100"
                  value={posLeverage}
                  onChange={(e) => setPosLeverage(parseInt(e.target.value))}
                  style={{
                    position: "absolute",
                    width: "100%",
                    opacity: 0,
                    cursor: "pointer",
                    margin: 0,
                    padding: 0,
                    height: "100%",
                  }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 9,
                  color: "var(--text-muted)",
                  marginTop: 3,
                }}
              >
                {["1×", "2×", "3×", "4×", "5×"].map((l) => (
                  <span key={l}>{l}</span>
                ))}
              </div>
            </div>

            {/* Open position button */}
            <button
              onClick={!connected ? connect : handleOpenPosition}
              disabled={!!loading || connecting}
              style={{
                width: "100%",
                padding: "13px 0",
                borderRadius: 10,
                border: "none",
                cursor: loading || connecting ? "not-allowed" : "pointer",
                opacity: loading || connecting ? 0.5 : 1,
                background:
                  activeTab === "long"
                    ? "var(--accent-green)"
                    : "var(--accent-red)",
                color: "#0d0e0f",
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.02em",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {loading?.startsWith("Open") || connecting ? (
                <span className="spinner" />
              ) : !connected ? (
                "Connect Wallet"
              ) : (
                `Open ${posDirection} ${posLeverage / 100}× Position`
              )}
            </button>

            {/* Trade summary */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 7,
                padding: "2px 0",
              }}
            >
              {[
                { label: "POT Price", value: `${currentPrice} POT` },
                {
                  label: "Position Size",
                  value: posCollateral
                    ? `${(
                        (parseFloat(posCollateral) * posLeverage) /
                        100
                      ).toFixed(3)} POT`
                    : "--",
                },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    {label}
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 11,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {value}
                  </span>
                </div>
              ))}
            </div>

            {/* ── Admin section ── */}
            <div
              style={{
                paddingTop: 8,
                borderTop: "1px solid var(--border)",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {/* Set Oracle Price */}
              {connected && (
                <div>
                  <div style={{ ...labelStyle, marginBottom: 6 }}>
                    Set Oracle Price (admin)
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      placeholder="1.00"
                      value={mockPrice}
                      onChange={(e) => setMockPrice(e.target.value)}
                    />
                    <button
                      className="btn btn-ghost"
                      onClick={handleSetMockPrice}
                      disabled={!!loading}
                      style={{ flexShrink: 0, fontSize: 11 }}
                    >
                      {loading === "Set Mock Price" ? (
                        <span className="spinner" />
                      ) : (
                        "Set"
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Positions section ── */}
          <div style={{ border: "1px solid var(--border)", borderRadius: 12 }}>
            <div style={{ display: "flex", padding: "0 16px" }}>
              {["Positions"].map((tab, i) => (
                <div
                  key={tab}
                  style={{
                    padding: "10px 14px 10px 0",
                    marginRight: 16,
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 11,
                    fontWeight: 500,
                    color:
                      i === 0 ? "var(--text-primary)" : "var(--text-muted)",
                    borderBottom:
                      i === 0
                        ? "2px solid var(--accent-amber)"
                        : "2px solid transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {tab}
                  {i === 0 && connected && positions.length > 0 && (
                    <span
                      style={{
                        background: "var(--accent-amber)",
                        color: "#0d0e0f",
                        borderRadius: 3,
                        padding: "0 5px",
                        fontSize: 9,
                        fontWeight: 700,
                      }}
                    >
                      {positions.length}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div style={{ padding: "0 0 16px 0" }}>
              {connected ? (
                <PositionsTable />
              ) : (
                <p
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: 10,
                    color: "var(--text-muted)",
                    textAlign: "center",
                    padding: "20px 16px",
                    margin: 0,
                  }}
                >
                  Connect wallet to view positions
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
