"use client";

import { useChain } from "@/app/context/ChainContext";

const SPARROWLEND_ADDRESS = "5DneqbcDeANscg4PW99WJysFavNqFEFY5X6QCtMYSWRcQGT3";
const SPARROWMARGIN_ADDRESS =
  "5E1Yb3AtSAA2KgqzowdTgX8YWT1Gnhw7mSr7s4MoaHyH5pjJ";
const WS_ENDPOINT = "ws://127.0.0.1:9944";

const FEATURES = [
  {
    icon: "◈",
    title: "Variable Deposits",
    desc: "MasterChef yield accumulator with proportional share minting",
    color: "var(--accent-green)",
  },
  {
    icon: "◆",
    title: "Fixed-Term APY",
    desc: "Rate-locked deposits with guaranteed return and early-exit penalties",
    color: "var(--accent-amber)",
  },
  {
    icon: "◉",
    title: "Isolated Margin",
    desc: "Long/Short up to 5× leverage with health-factor liquidations",
    color: "var(--accent-blue)",
  },
];

export default function RightPanel() {
  const { connect, connecting } = useChain();

  return (
    <div className="right-panel-landing">
      {/* Hero text */}
      <div className="landing-hero">
        <h1 className="landing-title">
          Money Market &<br />
          <span className="landing-title-accent">Margin Trading</span>
        </h1>
        <p className="landing-subtitle">
          Sparrow Protocol delivers composable DeFi primitives on Substrate.
          Lend assets for yield or trade with leverage — all onchain, all
          atomic.
        </p>
        <button
          className="btn btn-primary landing-connect-btn"
          onClick={connect}
          disabled={connecting}
        >
          {connecting ? (
            <>
              <span className="spinner" /> Connecting to node…
            </>
          ) : (
            "▸ Connect to Local Node"
          )}
        </button>
        <div className="landing-node-hint">
          Requires Talisman / SubWallet + local node at{" "}
          <span className="mono" style={{ color: "var(--text-secondary)" }}>
            {WS_ENDPOINT}
          </span>
        </div>
      </div>

      {/* Feature cards */}
      <div className="landing-features">
        {FEATURES.map((f) => (
          <div key={f.title} className="landing-feature-card">
            <div className="feature-icon" style={{ color: f.color }}>
              {f.icon}
            </div>
            <div className="feature-title">{f.title}</div>
            <div className="feature-desc">{f.desc}</div>
          </div>
        ))}
      </div>

      {/* Contract addresses */}
      <div className="landing-contracts">
        {[
          { label: "SparrowLend", addr: SPARROWLEND_ADDRESS },
          { label: "SparrowMargin", addr: SPARROWMARGIN_ADDRESS },
        ].map((c) => (
          <div key={c.label} className="contract-item">
            <div className="stat-label">{c.label}</div>
            <div className="contract-addr mono">
              {c.addr.slice(0, 14)}…{c.addr.slice(-6)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
