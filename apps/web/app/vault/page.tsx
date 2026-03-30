"use client";
import { useWallet } from "@/lib/walletContext";
import { useVaultData, ASSET_LABELS } from "@/lib/useVaultData";
import { openYieldPosition } from "@/lib/contracts";
import { useState } from "react";
import {
  ArrowLeft, ArrowRight, Zap, CheckCircle2,
  Loader2, ChevronRight, Info
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────
type Step = 1 | 2 | 3 | 4 | 5;

interface Choice {
  amount:    number;
  asset:     string;  // "NEAR" | "ETH_SEPOLIA" | "USDC_SEPOLIA" | "ETH_BASE" | "USDC_BASE"
  network:   string;
  yieldType: string;
  protocol:  string;
}

// ── Step indicator ────────────────────────────────────────────
function StepDot({ n, current }: { n: number; current: Step }) {
  const done   = n < current;
  const active = n === current;
  return (
    <div className="flex items-center gap-2">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all
        ${done   ? "bg-emerald-500 text-black" : ""}
        ${active ? "bg-white text-black" : ""}
        ${!done && !active ? "bg-white/10 text-white/30" : ""}
      `}>
        {done ? <CheckCircle2 size={12} /> : n}
      </div>
      {n < 4 && (
        <div className={`w-12 h-px transition-colors ${n < current ? "bg-emerald-500" : "bg-white/10"}`} />
      )}
    </div>
  );
}

// ── Option card ───────────────────────────────────────────────
function OptionCard({
  label, sublabel, badge, selected, soon, onClick
}: {
  label: string; sublabel?: string; badge?: string;
  selected: boolean; soon?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={soon ? undefined : onClick}
      disabled={soon}
      className={`w-full text-left p-4 rounded-xl border transition-all
        ${selected
          ? "border-emerald-500 bg-emerald-500/10"
          : soon
          ? "border-white/5 bg-white/[0.02] opacity-40 cursor-not-allowed"
          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/5"
        }
      `}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold ${selected ? "text-emerald-400" : "text-white"}`}>
              {label}
            </span>
            {badge && (
              <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20">
                {badge}
              </span>
            )}
            {soon && (
              <span className="text-xs bg-white/5 text-white/30 px-2 py-0.5 rounded-full">
                soon
              </span>
            )}
          </div>
          {sublabel && (
            <p className="text-xs text-white/30 mt-1">{sublabel}</p>
          )}
        </div>
        {selected && <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />}
      </div>
    </button>
  );
}

// ── Main vault page ───────────────────────────────────────────
export default function VaultPage() {
  const [step, setStep]       = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]       = useState(false);

 const { selector, accountId, isConnected } = useWallet();
  const { assets, refetch } = useVaultData(isConnected ? accountId : null);

const [choice, setChoice] = useState<Choice>({
    amount:    0,
    asset:     "",
    network:   "",
    yieldType: "",
    protocol:  "",
  });
  const [amountInput, setAmountInput] = useState<string>("");

  const selectedAsset = assets.find(a => a.asset === choice.asset);
  const selectedAssetBalance = selectedAsset?.decimal ?? 0;
  const nonZeroAssets = assets.filter(a => a.decimal > 0);

const canNext = () => {
    if (step === 1) return choice.asset !== "" && choice.amount > 0 && choice.amount <= selectedAssetBalance;
    if (step === 2) return choice.network !== "";
    if (step === 3) return choice.yieldType !== "";
    if (step === 4) return choice.protocol !== "";
    return false;
  };

 const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!selector || !accountId) {
      setSubmitError("Please connect your wallet first");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
            // Convert decimal amount to raw units based on asset
      const decimals = 
        choice.asset === "USDC_SEPOLIA" || choice.asset === "USDC_BASE" ? 6 :
        choice.asset === "ETH_SEPOLIA"  || choice.asset === "ETH_BASE"  ? 18 : 24;
      const rawAmount = BigInt(Math.round(choice.amount * Math.pow(10, decimals))).toString();
   await openYieldPosition(selector, {
        rawAmount:   rawAmount,
        originChain:  choice.asset === "ETH_BASE" || choice.asset === "USDC_BASE" ? "base" : 
                      choice.asset === "NEAR" ? "near" : "ethereum",
        originAsset:  ASSET_LABELS[choice.asset]?.name ?? "NEAR",
        network:      choice.network,
        yieldType:    choice.yieldType,
        protocol:     choice.protocol,
      });
      refetch();
      setSubmitting(false);
      setDone(true);
    } catch (err: any) {
      setSubmitError(err?.message || "Transaction failed");
      setSubmitting(false);
    }
  };

  // ── Success screen ─────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen bg-[#080808] text-white font-mono flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto">
            <CheckCircle2 size={28} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-2">Position Opened</h2>
            <p className="text-white/40 text-sm leading-relaxed">
            {choice.amount} {ASSET_LABELS[choice.asset]?.name} is being bridged from {ASSET_LABELS[choice.asset]?.chain} to {choice.network} via NEAR MPC and deposited into {choice.protocol}. Your position is now active and earning yield automatically.
            </p>
          </div>

          {/* Summary */}
          <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5 text-left space-y-3">
            {[
            ["Amount",   `${choice.amount} ${ASSET_LABELS[choice.asset]?.name ?? ""}`],
              ["Network",  choice.network],
              ["Type",     choice.yieldType],
              ["Protocol", choice.protocol],
              ["Status",   "Bridging..."],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-white/30">{k}</span>
                <span className={k === "Status" ? "text-amber-400" : "text-white font-medium"}>
                  {v}
                </span>
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => window.location.href = "/dashboard"}
              className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-bold py-3 rounded-xl transition-colors"
            >
              View Dashboard
            </button>
            <button
           onClick={() => { setDone(false); setStep(1); setChoice({ amount: 0, asset: "", network: "", yieldType: "", protocol: "" }); }}
              className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm py-3 rounded-xl transition-colors"
            >
              Open Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080808] text-white font-mono">
      <div className="fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

      {/* Nav */}
      <nav className="relative border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div
  onClick={() => window.location.href = "/"}
  className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
>
  <div className="w-7 h-7 rounded bg-emerald-500 flex items-center justify-center">
    <Zap size={14} className="text-black" fill="black" />
  </div>
  <span className="text-sm font-bold tracking-widest text-white/90">OMNIVAULT</span>
</div>
        <button
          onClick={() => window.location.href = "/dashboard"}
          className="flex items-center gap-2 text-white/40 hover:text-white text-xs transition-colors"
        >
          <ArrowLeft size={14} />
          Back to dashboard
        </button>
      </nav>

      <main className="relative max-w-lg mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <p className="text-xs text-white/30 tracking-widest uppercase mb-1">New Position</p>
          <h1 className="text-2xl font-bold">Open Yield Position</h1>
          <p className="text-xs text-white/30 mt-1">
            Deploy your funds cross-chain to earn yield automatically
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center mb-8">
          {[1, 2, 3, 4].map(n => <StepDot key={n} n={n} current={step} />)}
        </div>

        {/* ── Step 1: Amount ── */}
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-bold text-white/70 uppercase tracking-wider mb-1">
                Which asset to commit?
              </h2>
              <p className="text-xs text-white/30">
                Select from your OmniVault wallet balances
              </p>
            </div>

            {/* Asset selector */}
            {nonZeroAssets.length === 0 ? (
              <div className="border border-white/5 border-dashed rounded-xl p-8 text-center">
                <p className="text-white/30 text-sm mb-2">No assets deposited yet</p>
                <p className="text-white/20 text-xs">Deposit funds first to open a yield position</p>
                <button
                  onClick={() => window.location.href = "/dashboard"}
                  className="mt-4 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  ← Go deposit funds
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {nonZeroAssets.map(a => (
                  <button
                    key={a.asset}
                   onClick={() => {
                      setAmountInput("");
                      setChoice(c => ({ ...c, asset: a.asset, amount: 0 }));
                    }}
                    className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all text-left
                      ${choice.asset === a.asset
                        ? "border-emerald-500 bg-emerald-500/10"
                        : "border-white/10 bg-white/[0.03] hover:border-white/20"
                      }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`text-xs font-bold ${ASSET_LABELS[a.asset]?.color ?? "text-white"}`}>
                        {ASSET_LABELS[a.asset]?.name ?? a.asset}
                      </div>
                      <div className="text-xs text-white/30">
                        {ASSET_LABELS[a.asset]?.chain}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-white">{a.decimal.toFixed(4)}</p>
                      <p className="text-xs text-white/30">${a.usd.toFixed(2)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Amount input — only show after asset selected */}
            {choice.asset && (
              <>
                <div>
                  <h2 className="text-sm font-bold text-white/70 uppercase tracking-wider mb-1">
                    How much?
                  </h2>
                  <p className="text-xs text-white/30">
                    Available: {selectedAssetBalance.toFixed(4)} {ASSET_LABELS[choice.asset]?.name}
                  </p>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {[0.1, 0.25, 0.5, 1].map(pct => {
                    const amt = parseFloat((selectedAssetBalance * pct).toFixed(6));
                    return (
                      <button
                        key={pct}
                        onClick={() => {
                          setAmountInput(amt.toString());
                          setChoice(c => ({ ...c, amount: amt }));
                        }}
                        className={`py-2 rounded-lg text-xs font-bold transition-all border
                          ${choice.amount === amt
                            ? "bg-emerald-500/20 border-emerald-500 text-emerald-400"
                            : "bg-white/5 border-white/10 text-white/60 hover:border-white/20"
                          }`}
                      >
                        {Math.round(pct * 100)}%
                      </button>
                    );
                  })}
                </div>

                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amountInput}
                    onChange={e => {
                      const val = e.target.value;
                      // Allow digits, one dot, leading zero
                      if (val === "" || /^\d*\.?\d*$/.test(val)) {
                        setAmountInput(val);
                        const num = parseFloat(val);
                        setChoice(c => ({ ...c, amount: isNaN(num) ? 0 : num }));
                      }
                    }}
                    placeholder="0.0"
                    className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/30 transition-colors pr-24"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 text-xs">
                    {ASSET_LABELS[choice.asset]?.name}
                  </span>
                </div>

                {choice.amount > 0 && choice.amount <= selectedAssetBalance && (
                  <div className="flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded-lg px-4 py-3">
                    <Info size={13} className="text-white/30 shrink-0" />
                    <p className="text-xs text-white/40">
                      {(selectedAssetBalance - choice.amount).toFixed(4)} {ASSET_LABELS[choice.asset]?.name} will remain in your wallet
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Step 2: Network ── */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-bold text-white/70 uppercase tracking-wider mb-1">
                Which network?
              </h2>
              <p className="text-xs text-white/30">
                Your funds will be bridged to this chain to farm yield
              </p>
            </div>
            <div className="space-y-3">
              <OptionCard
                label="Ethereum"
                sublabel="Most liquidity · battle-tested protocols"
                badge="Live"
                selected={choice.network === "Ethereum"}
                onClick={() => setChoice(c => ({ ...c, network: "Ethereum" }))}
              />
              <OptionCard
                label="Base"
                sublabel="Low fees · Coinbase ecosystem"
                selected={choice.network === "Base"}
                soon
                onClick={() => {}}
              />
              <OptionCard
                label="Arbitrum"
                sublabel="Fast finality · deep DeFi ecosystem"
                selected={choice.network === "Arbitrum"}
                soon
                onClick={() => {}}
              />
              <OptionCard
                label="Solana"
                sublabel="High throughput · low cost"
                selected={choice.network === "Solana"}
                soon
                onClick={() => {}}
              />
            </div>
          </div>
        )}

        {/* ── Step 3: Yield type ── */}
        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-bold text-white/70 uppercase tracking-wider mb-1">
                What type of yield?
              </h2>
              <p className="text-xs text-white/30">
                Choose how your funds generate returns
              </p>
            </div>
            <div className="space-y-3">
              <OptionCard
                label="Lending"
                sublabel="Supply assets to lending pools · earn interest"
                badge="Live"
                selected={choice.yieldType === "Lending"}
                onClick={() => setChoice(c => ({ ...c, yieldType: "Lending" }))}
              />
              <OptionCard
                label="LP / DEX"
                sublabel="Provide liquidity · earn trading fees"
                selected={choice.yieldType === "LP / DEX"}
                soon
                onClick={() => {}}
              />
              <OptionCard
                label="Staking"
                sublabel="Stake assets · earn protocol rewards"
                selected={choice.yieldType === "Staking"}
                soon
                onClick={() => {}}
              />
            </div>
          </div>
        )}

        {/* ── Step 4: Protocol ── */}
        {step === 4 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-bold text-white/70 uppercase tracking-wider mb-1">
                Which protocol?
              </h2>
              <p className="text-xs text-white/30">
                Select the lending protocol to deposit into
              </p>
            </div>
            <div className="space-y-3">
              <OptionCard
                label="Aave V3"
                sublabel="8.2% APY · $12B TVL · audited"
                badge="Live"
                selected={choice.protocol === "Aave"}
                onClick={() => setChoice(c => ({ ...c, protocol: "Aave" }))}
              />
              <OptionCard
                label="Compound V3"
                sublabel="6.1% APY · $3B TVL · audited"
                selected={choice.protocol === "Compound"}
                soon
                onClick={() => {}}
              />
              <OptionCard
                label="Spark"
                sublabel="7.4% APY · MakerDAO ecosystem"
                selected={choice.protocol === "Spark"}
                soon
                onClick={() => {}}
              />
            </div>
          </div>
        )}

        {/* ── Step 5: Confirm ── */}
        {step === 5 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-sm font-bold text-white/70 uppercase tracking-wider mb-1">
                Confirm position
              </h2>
              <p className="text-xs text-white/30">
                Review your choices before committing funds
              </p>
            </div>

            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5 space-y-4">
              {[
         ["Amount",   `${choice.amount} ${ASSET_LABELS[choice.asset]?.name ?? choice.asset}`],
                ["Asset",    ASSET_LABELS[choice.asset]?.chain ?? ""],
                ["From",     "OmniVault wallet"],
                ["Network",  choice.network],
                ["Type",     choice.yieldType],
                ["Protocol", choice.protocol],
                ["Est. APY", "8.2%"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm">
                  <span className="text-white/30">{k}</span>
                  <span className="text-white font-medium">{v}</span>
                </div>
              ))}
            </div>

            {/* Chain abstraction callout */}
            <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-4 flex items-start gap-3">
              <Zap size={14} className="text-emerald-400 shrink-0 mt-0.5" fill="currentColor" />
              <p className="text-xs text-emerald-400/70 leading-relaxed">
{choice.asset === "ETH_SEPOLIA" && choice.network === "Ethereum"
                  ? `OmniVault will deposit your ETH directly into ${choice.protocol} on Ethereum. Since your ETH is already on Ethereum, no bridging is needed — just a seamless deposit via NEAR MPC.`
                  : `OmniVault will bridge your ${ASSET_LABELS[choice.asset]?.name ?? "funds"} from ${ASSET_LABELS[choice.asset]?.chain ?? "your wallet"} to ${choice.network} via NEAR MPC chain signatures and deposit into ${choice.protocol} automatically.`
                } No manual bridging, no network switching, no gas management on your end.
              </p>
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-bold py-4 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Bridging & Depositing...
                </>
              ) : (
                <>
                  <Zap size={16} fill="black" />
                  Confirm & Deploy {choice.amount} {ASSET_LABELS[choice.asset]?.name}
                </>
              )}
            </button>
          </div>
        )}

        {/* Navigation buttons */}
        {step < 5 && (
          <div className="flex gap-3 mt-8">
            {step > 1 && (
              <button
                onClick={() => setStep(s => (s - 1) as Step)}
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 text-sm px-5 py-3 rounded-xl transition-colors"
              >
                <ArrowLeft size={14} />
                Back
              </button>
            )}
            <button
              onClick={() => setStep(s => (s + 1) as Step)}
              disabled={!canNext()}
              className="flex-1 flex items-center justify-center gap-2 bg-white hover:bg-white/90 disabled:opacity-30 disabled:cursor-not-allowed text-black text-sm font-bold py-3 rounded-xl transition-colors"
            >
              {step === 4 ? "Review" : "Continue"}
              <ChevronRight size={14} />
            </button>
          </div>
        )}

      </main>
    </div>
  );
}