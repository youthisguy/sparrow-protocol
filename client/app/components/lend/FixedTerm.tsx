"use client";

import { useState } from "react";
import { useChain } from "@/app/context/ChainContext";

export default function FixedTerm() {
  const { poolStats, loading, sendTx, addToast, fixedDeposit, currentBlock } =
    useChain();

  const [fixedAmt, setFixedAmt] = useState("");
  const [fixedBlocks, setFixedBlocks] = useState("500");

  const toUnit = (amount: string): bigint => {
    if (!amount) return 0n;
    const n = parseFloat(amount);
    if (isNaN(n) || n <= 0) return 0n;
    return BigInt(Math.floor(n * 1_000_000_000_000));
  };

  const handleFixedDeposit = () => {
    const amt = toUnit(fixedAmt);
    const blocks = parseInt(fixedBlocks);
    if (!amt) return addToast("Enter deposit amount", "error");
    if (blocks < 200) return addToast("Min lock is 200 blocks", "error");
    sendTx("lend", "depositFixed", [blocks], amt, "Fixed Deposit");
  };

  const handleWithdrawFixed = () => {
    sendTx("lend", "withdrawFixed", [], 0n, "Withdraw Fixed");
  };

  const blocksToTime = (blocks: number) => {
    const seconds = blocks * 12;
    if (seconds < 3600) return `~${Math.round(seconds / 60)} min`;
    if (seconds < 86400) return `~${(seconds / 3600).toFixed(1)} hrs`;
    return `~${(seconds / 86400).toFixed(1)} days`;
  };

  const lockedRate = poolStats?.borrowRate ?? 0;
  const blockCount = parseInt(fixedBlocks) || 0;

  // Derived from on-chain data
  const hasActive = fixedDeposit?.isActive === true;
  const blocksRemaining = hasActive
    ? Math.max(0, (fixedDeposit.unlockBlock ?? 0) - (currentBlock ?? 0))
    : 0;
  const isUnlocked = hasActive && blocksRemaining === 0;
  const positionRatePct = hasActive
    ? (fixedDeposit.rateBps / 100).toFixed(2)
    : null;

  return (
    <div className="card" style={{ padding: 24 }}>
      {/* Section header */}
      <div className="section-header">
        <span className="section-title">◆ Fixed-Term Deposit</span>
        <div className="section-line" />
        {poolStats && (
          <span className="mono amber" style={{ fontSize: 11, flexShrink: 0 }}>
            Rate locked at deposit
          </span>
        )}
      </div>

      {hasActive && (
        <div
          style={{
            padding: "14px 16px",
            background: "var(--bg-elevated)",
            borderRadius: 6,
            border: `1px solid ${
              isUnlocked ? "var(--accent-green)" : "var(--border)"
            }`,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono, monospace)",
              marginBottom: 10,
            }}
          >
            My Position
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 12,
            }}
          >
            {[
              {
                label: "Principal Locked",
                value: `${fixedDeposit.principal} POT`,
                cls: "",
              },
              {
                label: "Guaranteed Rate",
                value: `${positionRatePct}% APY`,
                cls: "amber",
              },
              {
                label: "Accrued Interest",
                value: `+${fixedDeposit.accruedInterest} POT`,
                cls: "green",
              },
              {
                label: isUnlocked ? "Status" : "Unlocks In",
                value: isUnlocked
                  ? "✓ Ready to withdraw"
                  : `${blocksRemaining.toLocaleString()} blocks (${blocksToTime(
                      blocksRemaining
                    )})`,
                cls: isUnlocked ? "green" : "",
              },
            ].map((s) => (
              <div key={s.label}>
                <div className="stat-label">{s.label}</div>
                <div
                  className={`mono ${s.cls}`}
                  style={{
                    fontSize: 12,
                    marginTop: 3,
                    color: s.cls ? undefined : "var(--text-secondary)",
                  }}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          <button
            className={`btn ${isUnlocked ? "btn-green" : "btn-ghost"}`}
            onClick={handleWithdrawFixed}
            disabled={!!loading}
            style={{ width: "100%" }}
          >
            {loading === "Withdraw Fixed" ? (
              <div className="spinner" />
            ) : isUnlocked ? (
              "Unlock & Withdraw"
            ) : (
              "Early Exit (10% yield penalty)"
            )}
          </button>
        </div>
      )}

      {!hasActive && (
        <div
          style={{
            padding: "16px",
            background: "var(--bg-elevated)",
            borderRadius: 6,
            border: "1px solid var(--border)",
            marginBottom: 20,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              marginBottom: 12,
            }}
          >
            <div>
              <div className="stat-label">Current Rate</div>
              <div
                className="stat-value amber"
                style={{ fontSize: 20, marginTop: 3 }}
              >
                {lockedRate.toFixed(2)}%
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    marginLeft: 4,
                  }}
                >
                  APY
                </span>
              </div>
            </div>
            <div>
              <div className="stat-label">Early Exit Penalty</div>
              <div
                className="stat-value red"
                style={{ fontSize: 20, marginTop: 3 }}
              >
                10.00%
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    marginLeft: 4,
                  }}
                >
                  of yield
                </span>
              </div>
            </div>
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              lineHeight: 1.7,
            }}
          >
            Rate is snapshotted at deposit time. Withdraw before maturity and
            forfeit 10% of accrued interest as a penalty.
          </div>
        </div>
      )}

      {!hasActive && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="field-label">Deposit Amount (POT)</div>
            <input
              type="text"
              placeholder="0.00"
              value={fixedAmt}
              onChange={(e) => setFixedAmt(e.target.value)}
            />
          </div>

          <div>
            <div className="field-label">
              Lock Duration — blocks (min 200
              {blockCount >= 200 ? `, ${blocksToTime(blockCount)}` : ""})
            </div>
            <input
              type="text"
              placeholder="500"
              value={fixedBlocks}
              onChange={(e) => setFixedBlocks(e.target.value)}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {[
                { label: "200", val: "200" },
                { label: "500", val: "500" },
                { label: "1 000", val: "1000" },
                { label: "5 000", val: "5000" },
              ].map((opt) => (
                <button
                  key={opt.val}
                  className={`leverage-btn ${
                    fixedBlocks === opt.val ? "active" : ""
                  }`}
                  onClick={() => setFixedBlocks(opt.val)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {fixedAmt && blockCount >= 200 && (
            <div
              style={{
                padding: "10px 14px",
                background: "var(--accent-amber-dim)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                fontSize: 11,
                color: "var(--text-secondary)",
                lineHeight: 1.7,
              }}
            >
              <span className="mono amber">Estimated yield: </span>
              {(
                (parseFloat(fixedAmt) * lockedRate) /
                100 /
                (2_628_000 / blockCount)
              ).toFixed(4)}{" "}
              POT
              <span style={{ color: "var(--text-muted)" }}>
                {" "}
                over {blocksToTime(blockCount)}
              </span>
            </div>
          )}

          <button
            className="btn btn-green"
            onClick={handleFixedDeposit}
            disabled={!!loading}
            style={{ width: "100%" }}
          >
            {loading === "Fixed Deposit" ? (
              <div className="spinner" />
            ) : (
              "Lock & Deposit"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
