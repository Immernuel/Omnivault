"use client";

import { useState } from "react";
import { X, Zap, Loader2, CheckCircle2, Copy, ExternalLink } from "lucide-react";
import { useWallet } from "@/lib/walletContext";
import { depositToWallet } from "@/lib/contracts";
import { BrowserProvider, parseUnits } from "ethers";
import { getDerivedAddress } from "@/lib/useVaultData";
import { FunctionCall, Action } from "@near-js/transactions";

interface Props {
  onClose:   () => void;
  onSuccess: () => void;
}

// ── Supported chains ──────────────────────────────────────────
const CHAINS = [
  { 
    id: "near", 
    name: "NEAR", 
    icon: "N", 
    color: "text-white",
    chainId: null,
    assets: ["NEAR"],
    testnet: "NEAR Testnet",
  },
  { 
    id: "ethereum", 
    name: "Ethereum", 
    icon: "E", 
    color: "text-blue-400",
    chainId: "0xaa36a7",  // Sepolia chainId
    assets: ["ETH", "USDC"],
    testnet: "Sepolia",
  },
  { 
    id: "base", 
    name: "Base", 
    icon: "B", 
    color: "text-blue-300",
    chainId: "0x14a34",  // Base Sepolia chainId
    assets: ["ETH", "USDC"],
    testnet: "Base Sepolia",
  },
];

// Simulated derived addresses — in production these come from chain_bridge
// via NEAR MPC chain signatures
const DERIVED_ADDRESSES: Record<string, string> = {
  ethereum: "0x4a8f2c1e9d3b7f6a0c5e2d8b1a4f7e3c6b9d2e5a",
  polygon:  "0x7c3d1a9f2e6b4c8d0a5f3e1b9c7d2a6f4e8b1c3d",
};

// ── Step indicator ────────────────────────────────────────────
function Step({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all
        ${done   ? "bg-emerald-500 text-black" : ""}
        ${active && !done ? "bg-white text-black" : ""}
        ${!active && !done ? "bg-white/10 text-white/30" : ""}
      `}>
        {done ? "✓" : n}
      </div>
      <span className={`text-xs ${active ? "text-white" : "text-white/30"}`}>{label}</span>
    </div>
  );
}

export default function DepositModal({ onClose, onSuccess }: Props) {
  const { selector, accountId } = useWallet();

  const [step, setStep]           = useState(1);
  const [chain, setChain]         = useState("");
  const [asset, setAsset]         = useState("");
  const [amount, setAmount]       = useState("");
  const [loading, setLoading]     = useState(false);
  const [done, setDone]           = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [copied, setCopied]       = useState(false);
  const [evmConnected, setEvmConnected] = useState(false);
  const [evmAddress, setEvmAddress]     = useState("");
  const [derivedAddress, setDerivedAddress] = useState<string>("");

  const selectedChain = CHAINS.find(c => c.id === chain);

  // ── Copy derived address ──────────────────────────────────
  const copyAddress = () => {
    const addr = derivedAddress;
    if (!addr) return;
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Connect MetaMask ──────────────────────────────────────
  const connectMetaMask = async () => {
    if (!(window as any).ethereum) {
      setError("MetaMask not found — please install it");
      return;
    }
    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      setEvmAddress(accounts[0]);
      setEvmConnected(true);
      setError(null);

      // Switch to correct network
     const chainId = chain === "base" ? "0x14a34" : "0xaa36a7";
      try {
        await provider.send("wallet_switchEthereumChain", [{ chainId }]);
      } catch {
        // Network switch failed — not critical for demo
      }
    } catch (err: any) {
      setError(err?.message || "Failed to connect MetaMask");
    }
  };
const sendFromMetaMask = async () => {
    if (!evmConnected || !amount) return;
    setLoading(true);
    setError(null);

    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const signer   = await provider.getSigner();
      const network = await provider.getNetwork();
const expectedChainId = chain === "base" ? BigInt(84532) : BigInt(11155111);
if (network.chainId !== expectedChainId) {
  throw new Error(`Please switch MetaMask to ${chain === "base" ? "Base Sepolia" : "Ethereum Sepolia"} and try again`);
}
      const target   = derivedAddress;

      if (asset === "ETH") {
        const tx = await signer.sendTransaction({
          to:    target,
          value: parseUnits(amount, 18),
          gasLimit: BigInt(21000),
        });
        await tx.wait();
      } else if (asset === "USDC") {
        const USDC_CONTRACTS: Record<string, string> = {
          ethereum: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
          base:     "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        };
        const usdcAddress = USDC_CONTRACTS[chain];
        if (!usdcAddress) throw new Error("USDC not supported on this chain");
        const { Contract } = await import("ethers");
        const erc20 = new Contract(usdcAddress, [
          "function transfer(address to, uint256 amount) returns (bool)",
          "function decimals() view returns (uint8)",
        ], signer);
        const decimals = await erc20.decimals();
        const tx = await erc20.transfer(target, parseUnits(amount, decimals));
        await tx.wait();
      }

      // After EVM tx confirms — credit wallet_core on NEAR
      if (selector && accountId) {
        const decimals  = asset === "USDC" ? 6 : 18;
        const rawAmount = BigInt(Math.round(parseFloat(amount) * Math.pow(10, decimals))).toString();

        const wallet = await (selector as any).wallet();
        const fc = new FunctionCall({
          methodName: "register_inbound_transfer",
          args: new TextEncoder().encode(JSON.stringify({
            user:           accountId,
            external_chain: chain,
            asset:          asset,
            amount:         rawAmount,
          })),
          gas:     BigInt("30000000000000"),
          deposit: BigInt("1000000000000000000000"),
        });
        const action = new Action({ functionCall: fc });

        await wallet.signAndSendTransaction({
          receiverId: "wallet-core.omnivault.testnet",
          actions: [action],
        });
      }

      setDone(true);
      setTimeout(() => { onSuccess(); onClose(); }, 2500);

    } catch (err: any) {
      setError(err?.message || "Transaction failed");
    } finally {
      setLoading(false);
    }
  };

  // ── NEAR deposit ──────────────────────────────────────────
  const depositNear = async () => {
    if (!selector || !amount || parseFloat(amount) <= 0) return;
    setLoading(true);
    setError(null);
    try {
      await depositToWallet(selector, amount);
      setDone(true);
      setTimeout(() => { onSuccess(); onClose(); }, 2000);
    } catch (err: any) {
      setError(err?.message || "Transaction failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Success screen ────────────────────────────────────────
  if (done) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
        <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-md p-8 font-mono text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={24} className="text-emerald-400" />
          </div>
          <p className="text-sm font-bold text-white mb-2">Deposit received</p>
          <p className="text-xs text-white/30 leading-relaxed">
            {amount} {asset} from {selectedChain?.name} has been credited
            to your OmniVault wallet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
      <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-md font-mono overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/5">
          <div>
            <h2 className="text-sm font-bold text-white">Deposit Funds</h2>
            <p className="text-xs text-white/30 mt-0.5">Any chain · Any asset</p>
          </div>
          <button onClick={onClose} className="text-white/20 hover:text-white/50 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-4 px-6 py-4 border-b border-white/5">
          <Step n={1} label="Chain"  active={step === 1} done={step > 1} />
          <div className="flex-1 h-px bg-white/5" />
          <Step n={2} label="Asset"  active={step === 2} done={step > 2} />
          <div className="flex-1 h-px bg-white/5" />
          <Step n={3} label="Amount" active={step === 3} done={step > 3} />
          <div className="flex-1 h-px bg-white/5" />
          <Step n={4} label="Send"   active={step === 4} done={done} />
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Step 1: Chain */}
          {step === 1 && (
            <>
              <p className="text-xs text-white/40">Select the chain you are depositing from</p>
              <div className="space-y-2">
                {CHAINS.map(c => (
                  <button
                    key={c.id}
                    onClick={async () => {
  setChain(c.id);
  setAsset("");
  setStep(2);
  // Fetch real derived address from chain_bridge
  if (c.id !== "near" && accountId) {
    const addr = await getDerivedAddress(accountId, c.id);
    setDerivedAddress(addr);
  }
}}
                    className="w-full flex items-center gap-3 bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 hover:border-white/15 rounded-xl p-4 transition-all text-left"
                  >
                    <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center font-bold text-sm">
                      <span className={c.color}>{c.icon}</span>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{c.name}</p>
                      <p className="text-xs text-white/30">{c.assets.join(" · ")}</p>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Step 2: Asset */}
          {step === 2 && selectedChain && (
            <>
              <p className="text-xs text-white/40">Select asset to deposit from {selectedChain.name}</p>
              <div className="grid grid-cols-2 gap-2">
                {selectedChain.assets.map(a => (
                  <button
                    key={a}
                    onClick={() => { setAsset(a); setStep(3); }}
                    className="bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 hover:border-white/15 rounded-xl p-4 text-left transition-all"
                  >
                    <p className="text-sm font-bold text-white">{a}</p>
                    <p className="text-xs text-white/30 mt-0.5">
                      {a === "USDC" ? "USD Coin" : a === "ETH" ? "Ether" : a === "MATIC" ? "Polygon" : "NEAR"}
                    </p>
                  </button>
                ))}
              </div>
              <button onClick={() => setStep(1)} className="text-xs text-white/20 hover:text-white/50 transition-colors">
                ← Back
              </button>
            </>
          )}

          {/* Step 3: Amount */}
          {step === 3 && (
            <>
              <p className="text-xs text-white/40">How much {asset} do you want to deposit?</p>
              <div className="grid grid-cols-4 gap-2">
                {["10", "50", "100", "500"].map(n => (
                  <button
                    key={n}
                    onClick={() => setAmount(n)}
                    className={`py-2 rounded-lg text-xs font-bold transition-all border
                      ${amount === n
                        ? "bg-emerald-500/20 border-emerald-500 text-emerald-400"
                        : "bg-white/5 border-white/10 text-white/50 hover:border-white/20"
                      }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="relative">
                <input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.0"
                  className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-white/30 transition-colors pr-20"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 text-xs">{asset}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep(2)} className="text-xs text-white/20 hover:text-white/50 transition-colors">
                  ← Back
                </button>
                <button
                  onClick={() => { if (amount && parseFloat(amount) > 0) setStep(4); }}
                  disabled={!amount || parseFloat(amount) <= 0}
                  className="flex-1 bg-white hover:bg-white/90 disabled:opacity-30 text-black text-xs font-bold py-2.5 rounded-xl transition-colors"
                >
                  Continue →
                </button>
              </div>
            </>
          )}

          {/* Step 4: Send */}
          {step === 4 && (
            <>
              {/* Summary */}
              <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-2">
                {[
                  ["From",   selectedChain?.name || ""],
                  ["Asset",  asset],
                  ["Amount", `${amount} ${asset}`],
                  ["To",     "wallet-core.omnivault.testnet"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-white/30">{k}</span>
                    <span className="text-white font-medium">{v}</span>
                  </div>
                ))}
              </div>

              {/* NEAR flow */}
              {chain === "near" && (
                <>
                  <p className="text-xs text-white/30 text-center">
                    Your NEAR wallet will prompt you to confirm
                  </p>
                  {error && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs text-red-400">
                      {error}
                    </div>
                  )}
                  <button
                    onClick={depositNear}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black font-bold py-3.5 rounded-xl transition-colors"
                  >
                    {loading
                      ? <><Loader2 size={16} className="animate-spin" /> Confirming...</>
                      : <><Zap size={16} fill="black" /> Deposit {amount} NEAR</>
                    }
                  </button>
                </>
              )}

              {/* EVM flow (Ethereum / Polygon) */}
              {(chain === "ethereum" || chain === "base") && (
                <>
                  {/* Derived address */}
                  <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4">
                    <p className="text-xs text-white/30 mb-2">
                      Send {asset} to this OmniVault address on {selectedChain?.name}
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs text-emerald-400 flex-1 break-all">
                       {derivedAddress || "Loading...."}
                      </code>
                      <button onClick={copyAddress} className="text-white/30 hover:text-white/60 transition-colors shrink-0">
                        {copied ? <CheckCircle2 size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      </button>
                    </div>
                    <p className="text-xs text-white/20 mt-2">
                      This address is derived from your NEAR account via MPC chain signatures
                    </p>
                  </div>

                  {/* MetaMask connect */}
                  {!evmConnected ? (
                    <button
                      onClick={connectMetaMask}
                      className="w-full flex items-center justify-center gap-2 bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/30 text-orange-400 text-xs font-bold py-3 rounded-xl transition-colors"
                    >
                      Connect MetaMask to send
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3">
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span className="text-xs text-white/50 flex-1 truncate">{evmAddress}</span>
                      <span className="text-xs text-emerald-400">Connected</span>
                    </div>
                  )}

                  {error && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs text-red-400">
                      {error}
                    </div>
                  )}

                  {evmConnected && (
                    <button
                      onClick={sendFromMetaMask}
                      disabled={loading}
                      className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black font-bold py-3.5 rounded-xl transition-colors"
                    >
                      {loading
                        ? <><Loader2 size={16} className="animate-spin" /> Sending...</>
                        : <><Zap size={16} fill="black" /> Send {amount} {asset}</>
                      }
                    </button>
                  )}

                  <p className="text-xs text-white/20 text-center leading-relaxed">
                    Chain abstracted via NEAR MPC · No manual bridging needed
                  </p>
                </>
              )}

              <button onClick={() => setStep(3)} className="text-xs text-white/20 hover:text-white/50 transition-colors">
                ← Back
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}