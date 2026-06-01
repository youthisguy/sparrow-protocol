"use client";

import { useState } from "react";
import { useChain } from "@/app/context/ChainContext";

export default function VariablePool() {
  const {
    lenderShares,
    lenderValue,
    pendingYield,
    poolStats,
    loading,
    sendTx,
    addToast,
  } = useChain();

  const [depositAmt, setDepositAmt] = useState("");
  const [withdrawShares, setWithdrawShares] = useState("");

  const toUnit = (amount: string): bigint => {
    if (!amount) return 0n;
    const n = parseFloat(amount);
    if (isNaN(n) || n <= 0) return 0n;
    return BigInt(Math.floor(n * 1_000_000_000_000));
  };

  // Parse raw shares string from context into a number
  const totalShares = parseFloat(lenderShares || "0") || 0;

  const fillWithdrawPercent = (pct: number) => {
    const amount = (totalShares * pct) / 100;
    setWithdrawShares(amount > 0 ? Math.floor(amount).toString() : "");
  };

  const handleDeposit = () => {
    const amt = toUnit(depositAmt);
    if (!amt) return addToast("Enter deposit amount", "error");
    sendTx("lend", "deposit", [], amt, "Deposit");
    setWithdrawShares("")
    setDepositAmt("")
  };

  const handleWithdraw = () => {
    const shares = BigInt(withdrawShares || "0");
    if (!shares) return addToast("Enter shares to withdraw", "error");
    sendTx("lend", "withdraw", [shares.toString()], 0n, "Withdraw");
    setWithdrawShares("")
    setDepositAmt("")
  };

  const handleHarvestYield = () => {
    sendTx("lend", "harvestYield", [], 0n, "Harvest Yield");
    setWithdrawShares("")
    setDepositAmt("")
  };

  return (
    <div className="card" style={{ padding: 24,  borderRadius: 10, }}>
      <div className="section-header" >
        <span className="section-title">◈ Variable Pool</span>
        <div className="section-line" />
        {poolStats && (
          <span className="mono green" style={{ fontSize: 11, flexShrink: 0 }}>
            {poolStats.supplyApy.toFixed(2)}% APY
          </span>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
          marginBottom: 24,
          borderRadius: 10,
        }}
      >
        {[
          { label: "My Shares", value: lenderShares, cls: "" },
          { label: "Pool Value", value: lenderValue + " POT", cls: "" },
          {
            label: "Pending Yield",
            value: pendingYield + " POT",
            cls: "green",
          },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "10px 12px",
            }}
          >
            <div className="stat-label">{s.label}</div>
            <div
              className={`mono ${s.cls}`}
              style={{
                fontSize: 13,
                marginTop: 3,
                color: s.cls ? undefined : "var(--text-secondary)",
              }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14,  borderRadius: 10, }}>
        {/* Deposit */}
        <div>
          <div className="field-label">Deposit Amount (POT)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder="0.00"
              value={depositAmt}
              onChange={(e) => setDepositAmt(e.target.value)}
            />
            <button
              className="btn btn-green"
              onClick={handleDeposit}
              disabled={!!loading}
              style={{ flexShrink: 0 }}
            >
              {loading === "Deposit" ? <div className="spinner" /> : "Deposit"}
            </button>
          </div>
        </div>

        {/* Withdraw */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <div className="field-label" style={{ margin: 0 }}>
              Withdraw (shares)
            </div>
            {/* Percentage quick-fill buttons */}
            <div style={{ display: "flex", gap: 4 }}>
              {[20, 50, 100].map((pct) => (
                <button
                  key={pct}
                  onClick={() => fillWithdrawPercent(pct)}
                  disabled={totalShares === 0}
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 10,
                    padding: "2px 7px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--text-secondary)",
                    cursor: totalShares === 0 ? "not-allowed" : "pointer",
                    opacity: totalShares === 0 ? 0.4 : 1,
                    letterSpacing: "0.02em",
                  }}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder="0"
              value={withdrawShares}
              onChange={(e) => setWithdrawShares(e.target.value)}
            />
            <button
              className="btn btn-ghost"
              onClick={handleWithdraw}
              disabled={!!loading}
              style={{ flexShrink: 0 }}
            >
              {loading === "Withdraw" ? (
                <div className="spinner" />
              ) : (
                "Withdraw"
              )}
            </button>
          </div>
        </div>
        {/* Harvest */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              marginRight: "6px",
            }}
          >
            Yield accumulates each block. Harvest anytime.
          </div>
          <button
  className="btn btn-ghost"
  onClick={handleHarvestYield}
  disabled={!!loading}
>
  {loading === "Harvest Yield" ? <div className="spinner" /> : "🌾 Harvest Yield"}
</button>
        </div>
      </div>

      <div
        style={{
          marginTop: 20,
          padding: "12px 14px",
          background: "var(--bg-elevated)",
          borderRadius: 10,
          border: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-muted)",
          lineHeight: 1.7,
        }}
      >
        Shares are minted proportionally to your deposit. Yield accrues from
        borrower interest and is distributed via the MasterChef accumulator.
        Withdraw anytime with no lock-up.
      </div>
    </div>
  );
}
