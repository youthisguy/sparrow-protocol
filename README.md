# Sparrow Protocol

> Portaldot's native money market and isolated margin trading engine.

---

## Project Overview

- **Problem Statement:** DeFi on Substrate-based chains lacks composable, capital-efficient primitives. Traders have no access to leverage, and lenders have no way to earn optimized yield — both critical building blocks for any functioning onchain financial ecosystem.

- **Solution:** Sparrow Protocol delivers two tightly integrated smart contracts:
  - **SparrowLend** — a money market supporting variable deposits (MasterChef-style yield accumulator) and fixed-term deposits with rate-locked APY and early-exit penalties. Interest follows a kinked utilization curve (2% base → 8% optimal → 30% max), inspired by Compound V2.
  - **SparrowMargin** — an isolated margin trading engine for Long/Short positions with tiered leverage (5x under 10,000 POT, 3x above), health-factor-based liquidations with a 5% liquidator bonus, and funding rate settlement every 100 blocks.

- **Blockchain Relevance:** Both contracts are written in ink! 4.3 (Rust/WASM) and deployed on `pallet-contracts`. SparrowMargin makes cross-contract calls to SparrowLend for all borrowing and repayment atomically on position open and close — demonstrating composable DeFi primitive design on Substrate.

---

## Technical Architecture

### Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│                    SparrowLend                            │
│  Money Market + Yield Pool                                │
│                                                           │
│  • Variable deposits → MasterChef yield shares            │
│  • Fixed deposits    → Guaranteed APY                     │
│  • Kinked rate model → 2% → 8% optimal → 30% max          │
│  • Reserve factor    → 10% of interest to protocol        │
└──────────────────────┬───────────────────────────────────┘
                       │ borrow_for() / repay_for()
                       │ cross-contract, authorized only
┌──────────────────────▼───────────────────────────────────┐
│                   SparrowMargin                           │
│  Isolated Margin Trading Engine                           │
│                                                           │
│  • Long / Short positions, up to 5x leverage              │
│  • Health factor liquidations + 5% liquidator bonus       │
│  • Funding rate settlement every 100 blocks               │
│  • Mock price oracle (set_mock_price)                     │
└──────────────────────────────────────────────────────────┘
```

### Core Tech Stack

| Layer | Tool |
|---|---|
| Blockchain platform | substrate-contracts-node (pallet-contracts v9+) / Portaldot |
| Smart contract language | ink! 4.3 (Rust / WASM) |
| Frontend framework      | Next.js 16 (React 19, TypeScript, Tailwind CSS)     |
| Build tool | cargo-contract |
| Other components | Native POT balance (no wrapped tokens), mock price oracle |

---

## Smart Contracts

### Contract File Directory

```
portaldot-hackathon-2026-sparrow-protocol-sparrow-protocol/
├── sparrowlend/
│   ├── src/lib.rs        # Money market contract
│   ├── Cargo.toml
│   └── rust-toolchain.toml
├── sparrowmargin/
│   ├── src/lib.rs        # Margin trading contract
│   ├── Cargo.toml
│   └── rust-toolchain.toml
├── README.md
└── LICENSE
```

### Key Contracts

**SparrowLend** (`sparrowlend/src/lib.rs`)

| Function | Description |
|---|---|
| `deposit` | Deposit POT into the variable pool; mints yield-bearing shares |
| `deposit_fixed` | Deposit with a locked APY for a fixed term |
| `withdraw` | Redeem shares for POT plus accumulated yield |
| `borrow_for` | Authorized cross-contract call from SparrowMargin to borrow on behalf of a trader |
| `repay_for` | Authorized cross-contract call to repay a trader's debt |
| `set_margin_contract` | Admin: link the authorized SparrowMargin address |

**SparrowMargin** (`sparrowmargin/src/lib.rs`)

| Function | Description |
|---|---|
| `deposit_collateral` | Deposit POT collateral before opening a position |
| `open_position` | Open a Long or Short with specified leverage; cross-calls SparrowLend to borrow |
| `close_position` | Close a position, repay debt via SparrowLend, and receive payout |
| `get_health_factor` | Query a position's health (u32::MAX = fully healthy, no debt) |
| `liquidate` | Liquidate an unhealthy position; liquidator earns 5% bonus |
| `set_mock_price` | Admin: update the mock price oracle |

### Deployed Contracts

| Contract | Address |
|---|---|
| SparrowLend | `5DneqbcDeANscg4PW99WJysFavNqFEFY5X6QCtMYSWRcQGT3` |
| SparrowMargin | `5E1Yb3AtSAA2KgqzowdTgX8YWT1Gnhw7mSr7s4MoaHyH5pjJ` |

**Network:** `ws://127.0.0.1:9944` (substrate-contracts-node --dev)  
**Deployer:** `5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY` (Alice `//Alice`)

> ⚠️ Deployed on substrate-contracts-node due to Portaldot node binary limitation (specVersion 1002, Contracts API v5 rejects ink! 4.x wasm). Contracts compile and deploy as-is to Portaldot once the node binary is updated to Contracts API v9+.

---

## Installation & Setup

### Requirements

- Rust (nightly-2025-01-01) with `wasm32-unknown-unknown` target
- `cargo-contract`
- substrate-contracts-node v0.42.0

```bash
rustup toolchain install nightly-2025-01-01
rustup target add wasm32-unknown-unknown --toolchain nightly-2025-01-01
cargo install cargo-contract --force
```

### Steps

**1. Clone the repository**

```bash
git clone https://github.com/youthisguy/portaldot-hackathon-2026-sparrow-protocol-sparrow-protocol

```

**2. Start the local node**

```bash
curl -L https://github.com/paritytech/substrate-contracts-node/releases/download/v0.42.0/substrate-contracts-node-mac-universal.tar.gz \
     -o scn.tar.gz
tar -xzf scn.tar.gz
chmod +x substrate-contracts-node-mac/substrate-contracts-node
xattr -cr substrate-contracts-node-mac/substrate-contracts-node
./substrate-contracts-node-mac/substrate-contracts-node --dev
```

**3. Build contracts**

```bash
cd sparrowlend && cargo contract build --release
cd ../sparrowmargin && cargo contract build --release
```

**4. Deploy SparrowLend**

```bash
cd sparrowlend
cargo contract instantiate \
  target/ink/sparrowlend.contract \
  --constructor new \
  --suri //Alice \
  --url ws://127.0.0.1:9944 \
  --execute
# Note the printed contract address → 5DneqbcDeANscg4PW99WJysFavNqFEFY5X6QCtMYSWRcQGT3
```

**5. Deploy SparrowMargin**

```bash
cd ../sparrowmargin
cargo contract instantiate \
  target/ink/sparrowmargin.contract \
  --constructor new \
  --args 5DneqbcDeANscg4PW99WJysFavNqFEFY5X6QCtMYSWRcQGT3 1000000 \
  --suri //Alice \
  --url ws://127.0.0.1:9944 \
  --execute
# Pass to args the sparrowlend contract address 
```

**6. Link the contracts**

```bash
cd ../sparrowlend
cargo contract call \
  --contract 5DneqbcDeANscg4PW99WJysFavNqFEFY5X6QCtMYSWRcQGT3 \
  --message set_margin_contract \
  --args 5E1Yb3AtSAA2KgqzowdTgX8YWT1Gnhw7mSr7s4MoaHyH5pjJ \
  --suri //Alice \
  --url ws://127.0.0.1:9944 \
  --execute
# Pass to args the sparrowmargin contract address 
```

**7. start the client**

```bash
cd ../client
npm install
npm run dev
```

## Demo

**Video Link:** [https://youtu.be/La3cF0vxsXA](https://youtu.be/La3cF0vxsXA)
**Live demo Link:** [app-sparrow.vercel.app](https://app-sparrow.vercel.app)

## Roadmap

### Completed Features

- SparrowLend money market with variable and fixed-term deposit modes
- Kinked interest rate model (Compound V2-inspired)
- SparrowMargin isolated margin engine with Long/Short support
- Tiered leverage (5x / 3x) and health factor liquidations
- Cross-contract borrowing and repayment (SparrowMargin ↔ SparrowLend)
- Funding rate settlement every 100 blocks

### Next Phase Plans

- Integrate a live price oracle (e.g. Chainlink or a Substrate off-chain worker)
- Add multi-asset collateral and cross-margin mode
- Introduce governance token and protocol fee distribution

---

## Team

- **Team Name:** Sparrow Protocol
- **Members & roles:** Solo, Fullstack / Smart Contract dev
- **Contact:** [https://t.me/@youthisguy](https://t.me/@youthisguy)

---

## License

[MIT](./LICENSE.txt)