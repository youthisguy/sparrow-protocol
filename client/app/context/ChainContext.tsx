"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";

const SPARROWLEND_ADDRESS = "5DneqbcDeANscg4PW99WJysFavNqFEFY5X6QCtMYSWRcQGT3";
const SPARROWMARGIN_ADDRESS =
  "5E1Yb3AtSAA2KgqzowdTgX8YWT1Gnhw7mSr7s4MoaHyH5pjJ";
const WS_ENDPOINT = "ws://127.0.0.1:9944";
const UNIT = 1_000_000_000_000n;

export function formatUnit(pico: bigint | string | number): string {
  try {
    const val = BigInt(pico.toString());
    const whole = val / UNIT;
    const frac = ((val % UNIT) * 1000n) / UNIT;
    return `${whole}.${frac.toString().padStart(3, "0")}`;
  } catch {
    return "0.000";
  }
}

export function toUnit(amount: string): bigint {
  if (!amount) return 0n;
  const n = parseFloat(amount);
  if (isNaN(n) || n <= 0) return 0n;
  return BigInt(Math.floor(n * 1_000_000_000_000));
}

export type ToastType = "success" | "error" | "info";
export interface Toast {
  id: number;
  msg: string;
  type: ToastType;
}

export interface PoolStats {
  availableLiquidity: string;
  tvl: string;
  utilization: number;
  borrowRate: number;
  supplyApy: number;
}

export interface Position {
  id: number;
  direction: string;
  collateral: string;
  borrowed: string;
  leverage: number;
  entryPrice: string;
  isActive: boolean;
  healthFactor: string;
  pnl?: string;
  isProfit?: boolean;
}

export interface FixedDeposit {
  principal: string;
  rateBps: number;
  unlockBlock: number;
  accruedInterest: string;
  isActive: boolean;
}

interface ChainCtx {
  // connection
  api: any;
  connecting: boolean;
  connected: boolean;
  accounts: any[];
  selectedAccount: any;
  setSelectedAccount: (a: any) => void;
  balance: string;
  connect: () => Promise<void>;
  // pool data
  poolStats: PoolStats | null;
  freeCollateral: string;
  positions: Position[];
  lenderShares: string;
  lenderValue: string;
  pendingYield: string;
  currentPrice: string;
  refreshData: () => Promise<void>;
  query: (method: "lend" | "margin", fn: string, args: any[]) => Promise<any>;
  // tx
  sendTx: (
    method: "lend" | "margin",
    fn: string,
    args: any[],
    value?: bigint,
    label?: string
  ) => Promise<void>;
  loading: string | null;
  fixedDeposit: FixedDeposit | null;
  currentBlock: number | null;
  // toasts
  toasts: Toast[];
  addToast: (msg: string, type?: ToastType) => void;
  dismissToast: (id: number) => void;
  // contract refs
  SPARROWLEND_ADDRESS: string;
  SPARROWMARGIN_ADDRESS: string;
}

const ChainContext = createContext<ChainCtx | null>(null);

export function useChain() {
  const ctx = useContext(ChainContext);
  if (!ctx) throw new Error("useChain must be used inside ChainProvider");
  return ctx;
}

async function loadContract(api: any, address: string, contractName: string) {
  const response = await fetch(`/contracts/${contractName}.contract`);
  if (!response.ok) throw new Error(`Failed to fetch ${contractName}.contract`);
  const contractJson = await response.json();
  const { ContractPromise } = await import("@polkadot/api-contract");
  return new ContractPromise(api, contractJson, address);
}

export function ChainProvider({ children }: { children: ReactNode }) {
  const [api, setApi] = useState<any>(null);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [balance, setBalance] = useState("0.000");
  const [fixedDeposit, setFixedDeposit] = useState<FixedDeposit | null>(null);
  const [currentBlock, setCurrentBlock] = useState<number | null>(null);

  const [poolStats, setPoolStats] = useState<PoolStats | null>(null);
  const [freeCollateral, setFreeCollateral] = useState("0.000");
  const [positions, setPositions] = useState<Position[]>([]);
  const [lenderShares, setLenderShares] = useState("0");
  const [lenderValue, setLenderValue] = useState("0.000");
  const [pendingYield, setPendingYield] = useState("0.000");
  const [currentPrice, setCurrentPrice] = useState("1.000");

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const toastId = useRef(0);

  const addToast = useCallback((msg: string, type: ToastType = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const { ApiPromise, WsProvider } = await import("@polkadot/api");
      const { web3Accounts, web3Enable } = await import(
        "@polkadot/extension-dapp"
      );
      const provider = new WsProvider(WS_ENDPOINT);
      const apiInstance = await ApiPromise.create({ provider });
      setApi(apiInstance);
      const extensions = await web3Enable("Sparrow Protocol");
      if (extensions.length === 0) {
        addToast(
          "No Polkadot wallet found. Install Talisman or SubWallet.",
          "error"
        );
        setConnecting(false);
        return;
      }
      const allAccounts = await web3Accounts();
      setAccounts(allAccounts);
      if (allAccounts.length > 0) setSelectedAccount(allAccounts[0]);
      setConnected(true);
      addToast("Connected to local node", "success");
    } catch (err: any) {
      addToast(`Connection failed: ${err.message}`, "error");
    }
    setConnecting(false);
  }, [addToast]);

  const refreshData = useCallback(async () => {
    if (!api || !selectedAccount) return;
    const addr = selectedAccount.address;
    try {
      const lend = await loadContract(api, SPARROWLEND_ADDRESS, "sparrowlend");
      const margin = await loadContract(
        api,
        SPARROWMARGIN_ADDRESS,
        "sparrowmargin"
      );
      const opts = {
        gasLimit: api.registry.createType("WeightV2", {
          refTime: 40_000_000_000n,
          proofSize: 524288n,
        }),
      };

      // Pool Stats
      try {
        const result = await lend.query.getPoolStats(addr, opts);
        if (result?.result.isOk && result.output) {
          const raw = (result.output as any).toJSON();
          const data = raw?.ok || raw;
          const [avail, tvl, util, rate, apy] = Array.isArray(data) ? data : [];
          setPoolStats({
            availableLiquidity: formatUnit(BigInt(avail || 0)),
            tvl: formatUnit(BigInt(tvl || 0)),
            utilization: Number(util || 0),
            borrowRate: Number(rate || 0) / 100,
            supplyApy: Number(apy || 0) / 100,
          });
        }
      } catch {}

      // Lender Position
      try {
        const result = await lend.query.getLenderPosition(addr, opts, addr);
        if (result?.result.isOk && result.output) {
          const raw = (result.output as any).toJSON();
          const data = raw?.ok || raw;
          const [sharesRaw, val, pending] = Array.isArray(data) ? data : [];
          let shares = "0";
          if (sharesRaw) {
            shares =
              typeof sharesRaw === "string" && sharesRaw.startsWith("0x")
                ? BigInt(sharesRaw).toString()
                : sharesRaw.toString();
          }
          setLenderShares(shares);
          setLenderValue(formatUnit(BigInt(val || 0)));
          setPendingYield(formatUnit(BigInt(pending || 0)));
        }
      } catch {}

      // Free Collateral
      try {
        const result = await margin.query.getFreeCollateral(addr, opts, addr);
        if (result?.result.isOk && result.output) {
          const raw = (result.output as any).toJSON();
          let value = raw?.ok || raw;
          if (value && typeof value === "object" && !Array.isArray(value))
            value = value.ok || value.value || Object.values(value)[0];
          setFreeCollateral(formatUnit(BigInt(value || 0)));
        }
      } catch {}

      // Current Price
      try {
        const result = await margin.query.getCurrentPrice(addr, opts);
        if (result?.result.isOk && result.output) {
          const raw = (result.output as any).toJSON();
          let value = raw?.ok || raw;
          if (value && typeof value === "object")
            value = value.ok || Object.values(value)[0];
          setCurrentPrice(formatUnit(BigInt(value || 0)));
        }
      } catch {}

      // Positions
      try {
        const result = await margin.query.getUserPositions(addr, opts, addr);
        if (result?.result.isOk && result.output) {
          const raw = (result.output as any).toJSON();
          const positionIds = raw?.ok || raw || [];
          const formattedPositions: Position[] = [];
          for (const id of positionIds) {
            try {
              const posResult = await margin.query.getPosition(addr, opts, id);
              if (!posResult?.result.isOk || !posResult.output) continue;
              const posRaw = (posResult.output as any).toJSON();
              const p = posRaw?.ok || posRaw;
              if (!p || !Array.isArray(p)) continue;
              const direction = Number(p[2] || 0) === 0 ? "Long" : "Short";
              const isActive = Boolean(p[8]);
              if (!isActive) continue;
              let pnl = "0.000",
                isProfit = true;
              try {
                const pnlResult = await margin.query.getPositionPnl(
                  addr,
                  opts,
                  id
                );
                if (pnlResult?.result.isOk && pnlResult.output) {
                  const pnlRaw = (pnlResult.output as any).toJSON();
                  const pnlData = pnlRaw?.ok || pnlRaw;
                  if (Array.isArray(pnlData)) {
                    pnl = formatUnit(BigInt(pnlData[0] || 0));
                    isProfit = Boolean(pnlData[1]);
                  }
                }
              } catch {}
              formattedPositions.push({
                id: Number(id),
                direction,
                collateral: formatUnit(BigInt(p[3] || 0)),
                borrowed: formatUnit(BigInt(p[4] || 0)),
                leverage: Number(p[5] || 100) / 100,
                entryPrice: formatUnit(BigInt(p[6] || 0)),
                isActive,
                healthFactor: (Number(p[7] || 150) / 100).toFixed(2),
                pnl,
                isProfit,
              });
            } catch {}
          }
          setPositions(formattedPositions);
        }
      } catch {}

      // Current block
      try {
        const header = await api.rpc.chain.getHeader();
        setCurrentBlock(header.number.toNumber());
      } catch {}

      // Fixed deposit
      try {
        const result = await lend.query.getFixedDeposit(addr, opts, addr);
        if (result?.result.isOk && result.output) {
          const raw = (result.output as any).toJSON();
          const data = raw?.ok || raw;
          if (data && Array.isArray(data)) {
            const [principal, rateBps, unlockBlock, interest, isActive] = data;
            setFixedDeposit({
              principal: formatUnit(BigInt(principal || 0)),
              rateBps: Number(rateBps || 0),
              unlockBlock: Number(unlockBlock || 0),
              accruedInterest: formatUnit(BigInt(interest || 0)),
              isActive: Boolean(isActive),
            });
          } else {
            setFixedDeposit(null);
          }
        }
      } catch {
        setFixedDeposit(null);
      }

      // Balance
      try {
        const accountData = await api.query.system.account(addr);
        setBalance(formatUnit(accountData.data.free));
      } catch {}
    } catch {}
  }, [api, selectedAccount]);

  useEffect(() => {
    if (connected) {
      refreshData();
      const interval = setInterval(refreshData, 8000);
      return () => clearInterval(interval);
    }
  }, [connected, refreshData]);

  const sendTx = useCallback(
    async (
      method: "lend" | "margin",
      fn: string,
      args: any[],
      value: bigint = 0n,
      label = fn
    ) => {
      if (!api || !selectedAccount) return;
      setLoading(label);
      try {
        const { web3FromAddress } = await import("@polkadot/extension-dapp");
        const contractName =
          method === "lend" ? "sparrowlend" : "sparrowmargin";
        const contractAddress =
          method === "lend" ? SPARROWLEND_ADDRESS : SPARROWMARGIN_ADDRESS;
        const contract = await loadContract(api, contractAddress, contractName);
        const injector = await web3FromAddress(selectedAccount.address);
        const gasLimit = api.registry.createType("WeightV2", {
          refTime: 60_000_000_000n,
          proofSize: 524288n,
        });
        await new Promise<void>((resolve, reject) => {
          let unsub: any;
          const txArgs =
            value > 0n
              ? [
                  {
                    gasLimit,
                    storageDepositLimit: null,
                    value: value.toString(),
                  },
                  ...args,
                ]
              : [{ gasLimit, storageDepositLimit: null }, ...args];
          (contract.tx[fn] as any)(...txArgs)
            .signAndSend(
              selectedAccount.address,
              { signer: injector.signer },
              (result: any) => {
                if (result.status.isInBlock) {
                  addToast(`✓ ${label} included in block`, "success");
                  refreshData();
                  resolve();
                  unsub?.();
                  setTimeout(refreshData, 1500);
                } else if (result.status.isFinalized) {
                  unsub?.();
                } else if (result.dispatchError) {
                  reject(new Error(result.dispatchError.toString()));
                  unsub?.();
                }
              }
            )
            .then((u: any) => {
              unsub = u;
            })
            .catch(reject);
        });
      } catch (err: any) {
        addToast(`✗ ${label} failed: ${err.message}`, "error");
      } finally {
        setLoading(null);
      }
    },
    [api, selectedAccount, addToast, refreshData]
  );

  const query = useCallback(
    async (method: "lend" | "margin", fn: string, args: any[]) => {
      if (!api || !selectedAccount) return null;
      const contractName = method === "lend" ? "sparrowlend" : "sparrowmargin";
      const contractAddress =
        method === "lend" ? SPARROWLEND_ADDRESS : SPARROWMARGIN_ADDRESS;
      const contract = await loadContract(api, contractAddress, contractName);
      const opts = {
        gasLimit: api.registry.createType("WeightV2", {
          refTime: 40_000_000_000n,
          proofSize: 524288n,
        }),
      };
      const result = await (contract.query[fn] as any)(
        selectedAccount.address,
        opts,
        ...args
      );
      if (result?.result.isOk && result.output) {
        const raw = (result.output as any).toJSON();
        return raw?.ok ?? raw;
      }
      throw new Error(result?.result.asErr?.toString() ?? "Query failed");
    },
    [api, selectedAccount]
  );

  return (
    <ChainContext.Provider
      value={{
        api,
        connecting,
        connected,
        accounts,
        selectedAccount,
        setSelectedAccount,
        balance,
        connect,
        fixedDeposit,
        currentBlock,
        poolStats,
        freeCollateral,
        positions,
        lenderShares,
        lenderValue,
        pendingYield,
        currentPrice,
        refreshData,
        query,
        sendTx,
        loading,
        toasts,
        addToast,
        dismissToast,
        SPARROWLEND_ADDRESS,
        SPARROWMARGIN_ADDRESS,
      }}
    >
      {children}
    </ChainContext.Provider>
  );
}
