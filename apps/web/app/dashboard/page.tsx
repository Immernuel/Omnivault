"use client";

import DepositModal from "@/components/DepositModal";
import { useState } from "react";
import {
  ArrowUpRight, ArrowDownLeft, Zap, Wallet, TrendingUp,
  CheckCircle2, Loader2, ExternalLink, RefreshCw, X, LogOut
} from "lucide-react";
import { useWallet } from "@/lib/walletContext";
import {
  useVaultData, formatAssetAmount, ASSET_LABELS, assetToUSD, rawToDecimal
} from "@/lib/useVaultData";
import { useWorldId } from "@/lib/useWorldId";
import { checkWorldIdVerified } from "@/lib/useVaultData";
import { useEffect } from "react";
import { closeYieldPosition, withdrawFromWallet } from "@/lib/contracts";

export default function Dashboard() {
  const { accountId, isConnected, signIn, signOut, selector, loading: walletLoading } = useWallet();
  const { assets, totalUSD, positions, loading, error, refetch, walletBalance } =
    useVaultData(isConnected ? accountId : null);
  const { verify, verifying, verified, setVerified, error: worldIdError } = useWorldId(accountId);

  useEffect(() => {
    if (accountId) {
      checkWorldIdVerified(accountId).then(isVerified => {
        if (isVerified) setVerified(true);
      });
    }
  }, [accountId]);

  const [showDeposit, setShowDeposit]         = useState(false);
  const [showWithdraw, setShowWithdraw]       = useState(false);
  const [withdrawAmount, setWithdrawAmount]   = useState("");
  const [withdrawing, setWithdrawing]         = useState(false);
  const [withdrawError, setWithdrawError]     = useState<string | null>(null);
  const [closingId, setClosingId]             = useState<string | null>(null);
  const [closeError, setCloseError]           = useState<string | null>(null);

  const totalYield = positions
    .filter(p => p.status === "active" && BigInt(p.yield_token_amount) > BigInt(0))
    .reduce((acc, p) => {
      const k = p.origin_asset === "ETH" ? "ETH_SEPOLIA" : p.origin_asset === "USDC" ? "USDC_SEPOLIA" : "NEAR";
      return acc + (assetToUSD(p.yield_token_amount, k) - assetToUSD(p.amount, k));
    }, 0);

  const vaultUSD = isConnected
    ? positions.reduce((sum, p) => {
        const k = p.origin_asset === "ETH" ? "ETH_SEPOLIA" : p.origin_asset === "USDC" ? "USDC_SEPOLIA" : "NEAR";
        return sum + assetToUSD(p.amount, k);
      }, 0)
    : 0;

  const positionGroups = Object.values(
    positions
      .filter(p => p.status === "active" || p.status === "bridging")
      .reduce((acc, p) => {
        const key = `${p.protocol}-${p.network}`;
        if (!acc[key]) acc[key] = {
          protocol: p.protocol,
          network: p.network,
          count: 0,
          total: 0,
          yieldTotal: 0,
          positions: [] as typeof positions,
        };
        const k = p.origin_asset === "ETH" ? "ETH_SEPOLIA" : p.origin_asset === "USDC" ? "USDC_SEPOLIA" : "NEAR";
        acc[key].count++;
        acc[key].total      += assetToUSD(p.amount, k);
        acc[key].yieldTotal += assetToUSD(p.yield_token_amount, k);
        acc[key].positions.push(p);
        return acc;
      }, {} as Record<string, {
        protocol: string; network: string; count: number;
        total: number; yieldTotal: number; positions: typeof positions;
      }>)
  );

  // ── Close position ─────────────────────────────────────────
  async function handleClose(positionId: string, originAsset: string) {
    if (!selector) return;
    setClosingId(positionId);
    setCloseError(null);
    try {
      await closeYieldPosition(selector, {
        positionId,
        originChain: "near",
        originAsset,
      });
      await refetch();
    } catch (err: any) {
      setCloseError(err?.message || "Failed to close position");
    } finally {
      setClosingId(null);
    }
  }

  // ── Withdraw NEAR ──────────────────────────────────────────
  async function handleWithdraw() {
    if (!selector || !withdrawAmount) return;
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      await withdrawFromWallet(selector, withdrawAmount);
      setShowWithdraw(false);
      setWithdrawAmount("");
      await refetch();
    } catch (err: any) {
      setWithdrawError(err?.message || "Failed to withdraw");
    } finally {
      setWithdrawing(false);
    }
  }

  const nearBalanceDecimal = rawToDecimal(walletBalance || "0", "NEAR");

  return (
    <div className="min-h-screen bg-[#080808] text-white font-mono">
      <div className="fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

      {/* Nav */}
      <nav className="relative border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div onClick={() => window.location.href = "/"} className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 rounded bg-emerald-500 flex items-center justify-center">
            <Zap size={14} className="text-black" fill="black" />
          </div>
          <span className="text-sm font-bold tracking-widest text-white/90">OMNIVAULT</span>
        </div>
        <div className="flex items-center gap-3">
          {loading && isConnected && <Loader2 size={14} className="text-white/30 animate-spin" />}
          {isConnected && (
            <button onClick={refetch} className="text-white/20 hover:text-white/50 transition-colors">
              <RefreshCw size={14} />
            </button>
          )}
          {walletLoading ? (
            <Loader2 size={14} className="text-white/30 animate-spin" />
          ) : isConnected ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs text-white/70">{accountId}</span>
              </div>
              <button onClick={signOut} className="text-xs text-white/20 hover:text-white/50 transition-colors px-2 py-1.5">disconnect</button>
            </div>
          ) : (
            <button onClick={signIn} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold px-4 py-2 rounded-lg transition-colors">
              <Wallet size={12} />Connect Wallet
            </button>
          )}
        </div>
      </nav>

      <main className="relative max-w-5xl mx-auto px-6 py-10 space-y-8">

        {/* Not connected */}
        {!isConnected ? (
          <div className="border border-white/5 border-dashed rounded-xl p-20 text-center">
            <Wallet size={32} className="text-white/10 mx-auto mb-4" />
            <p className="text-white/30 text-sm mb-6">Connect your wallet to view your portfolio</p>
            <button onClick={signIn} className="bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold px-6 py-2.5 rounded-lg transition-colors">
              Connect Wallet
            </button>
          </div>
        ) : (
          <>
            {/* World ID banner */}
            {!verified && (
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                    <span className="text-base">🌍</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-amber-400">Verify you're human</p>
                    <p className="text-xs text-white/30">World ID verification required to deposit funds · Prevents bots and sybil attacks</p>
                  </div>
                </div>
                <button
                  onClick={verify}
                  disabled={verifying}
                  className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 shrink-0"
                >
                  {verifying ? <Loader2 size={12} className="animate-spin" /> : null}
                  Verify with World ID
                </button>
              </div>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Portfolio header */}
            <div>
              <p className="text-xs text-white/30 tracking-wider uppercase mb-2">Portfolio</p>
              <p className="text-4xl font-bold">${totalUSD.toFixed(2)}</p>
              <p className="text-xs text-white/30 mt-1">{accountId}</p>
            </div>

            {/* Asset balances */}
            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs text-white/40 tracking-wider uppercase">Asset Balances</span>
                <span className="text-xs text-white/20">${totalUSD.toFixed(2)} total</span>
              </div>
              <div className="space-y-3">
                {assets.filter(a => a.decimal > 0).map(a => (
                  <div key={a.asset} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-white/5 flex items-center justify-center">
                        <span className="text-xs font-bold text-white/60">{ASSET_LABELS[a.asset]?.name?.charAt(0)}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium">{ASSET_LABELS[a.asset]?.name}</p>
                        <p className="text-xs text-white/30">{ASSET_LABELS[a.asset]?.chain}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">${a.usd.toFixed(2)}</p>
                      <p className="text-xs text-white/30">{formatAssetAmount(a.raw, a.asset)} {ASSET_LABELS[a.asset]?.name}</p>
                    </div>
                  </div>
                ))}
                {assets.every(a => a.decimal === 0) && (
                  <p className="text-white/20 text-sm text-center py-4">No balances yet — deposit to get started</p>
                )}
              </div>
            </div>

            {/* Vault + Yield row */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/[0.03] border border-white/5 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs text-white/40 tracking-wider uppercase">In Vault</span>
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <TrendingUp size={13} className="text-emerald-400" />
                  </div>
                </div>
                <p className="text-2xl font-bold">${vaultUSD.toFixed(2)}</p>
                <p className="text-xs text-white/30 mt-1">Committed to yield</p>
              </div>
              <div className={`border rounded-xl p-5 ${totalYield > 0 ? "bg-emerald-500/5 border-emerald-500/10" : "bg-white/[0.03] border-white/5"}`}>
                <div className="flex items-center justify-between mb-4">
                  <span className={`text-xs tracking-wider uppercase ${totalYield > 0 ? "text-emerald-400/60" : "text-white/40"}`}>Yield Earned</span>
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Zap size={13} className="text-emerald-400" />
                  </div>
                </div>
                <p className={`text-2xl font-bold ${totalYield > 0 ? "text-emerald-400" : "text-white"}`}>
                  +${totalYield.toFixed(2)}
                </p>
                <p className={`text-xs mt-1 ${totalYield > 0 ? "text-emerald-400/40" : "text-white/30"}`}>
                  {totalYield > 0 ? "From active positions" : "No active positions yet"}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 flex-wrap">
              <button
                onClick={() => window.location.href = "/vault"}
                className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold px-5 py-2.5 rounded-lg transition-colors"
              >
                <ArrowUpRight size={14} />Open Yield Position
              </button>
              <button
                onClick={() => {
                  if (!verified) { verify(); return; }
                  setShowDeposit(true);
                }}
                className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-xs font-medium px-5 py-2.5 rounded-lg transition-colors"
              >
                <ArrowDownLeft size={14} />
                {verified ? "Deposit Funds" : "Verify to Deposit"}
              </button>
              {nearBalanceDecimal > 0 && (
                <button
                  onClick={() => setShowWithdraw(true)}
                  className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-xs font-medium px-5 py-2.5 rounded-lg transition-colors"
                >
                  <LogOut size={14} />Withdraw NEAR
                </button>
              )}
            </div>

            {/* Positions */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-white/70 tracking-wider uppercase">Active Positions</h2>
                <span className="text-xs text-white/20">{positionGroups.length} active</span>
              </div>

              {closeError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-3">
                  <p className="text-red-400 text-xs">{closeError}</p>
                </div>
              )}

              {loading && positions.length === 0 ? (
                <div className="border border-white/5 rounded-xl p-12 text-center">
                  <Loader2 size={20} className="animate-spin text-white/20 mx-auto mb-3" />
                  <p className="text-white/20 text-sm">Loading positions...</p>
                </div>
              ) : positionGroups.length === 0 ? (
                <div className="border border-white/5 border-dashed rounded-xl p-12 text-center">
                  <p className="text-white/20 text-sm">No positions yet</p>
                  <p className="text-white/10 text-xs mt-1">Open a yield position to start earning</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {positionGroups.map(group => (
                    <div key={`${group.protocol}-${group.network}`} className="bg-white/[0.03] border border-white/5 hover:border-white/10 rounded-xl p-5 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                            <span className="text-xs font-bold text-blue-400">{group.protocol.charAt(0)}</span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-bold">{group.protocol}</span>
                              <span className="text-white/20 text-xs">·</span>
                              <a
                                href={group.network === "Ethereum" ? "https://sepolia.etherscan.io/address/0x74e2637e17e5963378b6aa196389efbc855fb7db" : "#"}
                                target="_blank" rel="noopener noreferrer"
                                className="text-xs text-white/40 hover:text-white/70 transition-colors flex items-center gap-1"
                              >
                                {group.network}<ExternalLink size={9} />
                              </a>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-emerald-500/15 text-emerald-400 border-emerald-500/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Active
                              </span>
                              <span className="text-xs text-white/30">{group.count} position{group.count > 1 ? "s" : ""} · aUSDC</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="flex items-center gap-2 justify-end mb-1">
                              <span className="text-sm font-bold">${group.total.toFixed(2)}</span>
                              {group.yieldTotal > group.total && (
                                <span className="text-xs text-emerald-400">+${(group.yieldTotal - group.total).toFixed(4)}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 justify-end">
                              <span className="text-xs text-white/30">aUSDC · 8.2% APY</span>
                              <a
                                href="https://explorer.testnet.near.org/accounts/vault-core.omnivault.testnet"
                                target="_blank" rel="noopener noreferrer"
                                className="text-xs text-emerald-400/50 hover:text-emerald-400 transition-colors flex items-center gap-1"
                              >
                                <ExternalLink size={10} />on-chain
                              </a>
                            </div>
                          </div>
                          {/* Close buttons for each position in this group */}
                          <div className="flex flex-col gap-1">
                            {group.positions.map(p => (
                              <button
                                key={p.id}
                                onClick={() => handleClose(p.id, p.origin_asset)}
                                disabled={closingId === p.id}
                                className="flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {closingId === p.id
                                  ? <Loader2 size={10} className="animate-spin" />
                                  : <X size={10} />
                                }
                                Close
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border border-white/5 rounded-xl p-5 flex items-start gap-4">
              <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 size={14} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-white/70 mb-1">Live on NEAR testnet</p>
                <p className="text-xs text-white/30 leading-relaxed">
                  wallet-core.omnivault.testnet · vault-core.omnivault.testnet · chain-bridge.omnivault.testnet
                </p>
              </div>
            </div>
          </>
        )}

        {/* Deposit Modal */}
        {showDeposit && (
          <DepositModal
            onClose={() => setShowDeposit(false)}
            onSuccess={() => { setShowDeposit(false); refetch(); }}
          />
        )}

        {/* Withdraw Modal */}
        {showWithdraw && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-sm">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-bold tracking-wider uppercase">Withdraw NEAR</h3>
                <button onClick={() => { setShowWithdraw(false); setWithdrawError(null); }} className="text-white/30 hover:text-white/70">
                  <X size={16} />
                </button>
              </div>

              <div className="bg-white/5 rounded-xl p-4 mb-4">
                <p className="text-xs text-white/40 mb-1">Available in wallet</p>
                <p className="text-xl font-bold">{nearBalanceDecimal.toFixed(4)} NEAR</p>
              </div>

              <div className="mb-4">
                <label className="text-xs text-white/40 mb-2 block">Amount to withdraw</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={withdrawAmount}
                    onChange={e => setWithdrawAmount(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-white/20 focus:outline-none focus:border-emerald-500/50"
                  />
                  <button
                    onClick={() => setWithdrawAmount(nearBalanceDecimal.toFixed(4))}
                    className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5 rounded-lg hover:bg-emerald-500/20 transition-colors"
                  >
                    MAX
                  </button>
                </div>
              </div>

              {withdrawError && (
                <p className="text-red-400 text-xs mb-4">{withdrawError}</p>
              )}

              <button
                onClick={handleWithdraw}
                disabled={withdrawing || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
                className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black text-xs font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {withdrawing
                  ? <><Loader2 size={14} className="animate-spin" />Withdrawing...</>
                  : <><LogOut size={14} />Withdraw to Wallet</>
                }
              </button>

              <p className="text-xs text-white/20 text-center mt-3">
                NEAR will be sent to your connected wallet
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
