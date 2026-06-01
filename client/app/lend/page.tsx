"use client";

import VariablePool from "../components/lend/VariablePool";
import FixedTerm from "../components/lend/FixedTerm";
import { useChain } from "../context/ChainContext";

function LendStatsBar() {
  const { poolStats } = useChain();

  if (!poolStats) return null;

  const utilPct = poolStats.utilization ?? 0;
  const utilColor = utilPct > 90 ? "red" : utilPct > 70 ? "amber" : "green";

  const stats = [
    { label: "Available Liquidity", value: poolStats.availableLiquidity + " POT", cls: "" },
    { label: "Total Value Locked", value: poolStats.tvl + " POT", cls: "" },
    { label: "Utilization", value: utilPct + "%", cls: utilColor },
    { label: "Borrow Rate APY", value: poolStats.borrowRate.toFixed(2) + "%", cls: "amber" },
    { label: "Supply APY", value: poolStats.supplyApy.toFixed(2) + "%", cls: "green" },
  ];

  return (
    <div className="lend-stats-bar">
      {stats.map((s) => (
        <div key={s.label} className="lend-stat-item"  style={{ borderRadius: 10 }}>
          <div className="stat-label">{s.label}</div>
          <div className={`stat-value ${s.cls}`} style={{ fontSize: 15 }}>
            {s.value}
          </div>
          {s.label === "Utilization" && (
            <div className="util-bar" style={{ marginTop: 6 }}>
              <div
                className={`util-fill ${utilPct > 90 ? "danger" : utilPct > 70 ? "warn" : ""}`}
                style={{ width: `${utilPct}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function LendPage() {
  return (
    <>
      <div className="lend-layout">
        <LendStatsBar />
        <div className="lend-grid">
          <VariablePool />
          <FixedTerm />
        </div>
      </div>

      <style>{`
        .lend-layout {
          display: flex;
          flex-direction: column;
          flex: 1;
          height: calc(100vh - 52px);
          overflow-y: auto;
        }

        /* Stats bar  */
        .lend-stats-bar {
          display: flex;
          flex-shrink: 0;
        }

        .lend-stat-item {
          flex: 1;
          padding: 12px 16px;
          border-right: 1px solid var(--border);
        }

        .lend-stat-item:last-child {
          border-right: none;
        }

        /* Panels  */
        .lend-grid {
          display: flex;
          flex: 1;
          min-height: 0;
          overflow: hidden;
        }

        .lend-grid > * {
          flex: 1;
          overflow-y: auto;
          border-right: 1px solid var(--border);
        }

        .lend-grid > *:last-child {
          border-right: none;
        }

        @media (max-width: 768px) {
          .lend-layout {
            height: auto;
            padding: 19px 14px;
            min-height: calc(100vh - 52px);
            overflow-y: auto;
          }

          /* Stats bar → 2-column grid */
          .lend-stats-bar {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }

          .lend-stat-item {
            border-right: none;
            border-bottom: 1px solid var(--border);
          }
 
          .lend-stat-item:nth-last-child(-n+2) {
            border-bottom: none;
          }

          .lend-stat-item:last-child:nth-child(odd) {
            grid-column: 1 / -1;
          }

          /* Panels → stacked vertically */
          .lend-grid {
            flex-direction: column;
            overflow: visible;
          }

          .lend-grid > * {
            border-right: none;
            border-bottom: 1px solid var(--border);
            overflow-y: visible;
          }

          .lend-grid > *:last-child {
            border-bottom: none;
          }
        }
      `}</style>
    </>
  );
}