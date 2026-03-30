"use client";

import { useState, useRef, useEffect } from "react";
import { ArrowRight, Zap, Shield, Globe, ChevronRight } from "lucide-react";
import { useWallet } from "@/lib/walletContext";

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-colors">
      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center mb-4">{icon}</div>
      <h3 className="text-sm font-bold text-white mb-2">{title}</h3>
      <p className="text-xs text-white/40 leading-relaxed">{desc}</p>
    </div>
  );
}

function FlowStep({ n, label, sub, last }: { n: number; label: string; sub: string; last?: boolean }) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-xs font-bold text-emerald-400 shrink-0">{n}</div>
        {!last && <div className="w-px h-12 bg-white/5 mt-2" />}
      </div>
      <div className="pt-1">
        <p className="text-sm font-bold text-white mb-1">{label}</p>
        <p className="text-xs text-white/30">{sub}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const { signIn, signOut, isConnected, accountId } = useWallet();
  const hasRedirected = useRef(true);

  // Only redirect when wallet JUST connected (not on page load)
  const [initialLoad, setInitialLoad] = useState(true);

  useEffect(() => {
    // Give the page a moment to register as "initial load"
    const timer = setTimeout(() => setInitialLoad(false), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Only redirect if wallet connected AFTER page loaded (not already connected)
    if (isConnected && !initialLoad && !hasRedirected.current) {
      hasRedirected.current = true;
      window.location.href = "/dashboard";
    }
  }, [isConnected, initialLoad]);

  const handleConnect = () => {
    if (isConnected) {
      window.location.href = "/dashboard";
      return;
    }
    signIn();
  };

  return (
    <div className="min-h-screen bg-[#080808] text-white font-mono overflow-x-hidden">
      <div className="fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Nav */}
      <nav className="relative border-b border-white/5 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-emerald-500 flex items-center justify-center">
            <Zap size={14} className="text-black" fill="black" />
          </div>
          <span className="text-sm font-bold tracking-widest">OMNIVAULT</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="#how" className="text-xs text-white/40 hover:text-white transition-colors">How it works</a>
          <a href="#features" className="text-xs text-white/40 hover:text-white transition-colors">Features</a>
          {isConnected ? (
            <div className="flex items-center gap-2">
              <div
                onClick={handleConnect}
                className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 cursor-pointer hover:border-white/20 transition-colors"
              >
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs text-white/70">{accountId}</span>
              </div>
              <button
                onClick={signOut}
                className="text-xs text-white/20 hover:text-white/50 transition-colors"
              >
                disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={handleConnect}
              className="flex items-center gap-2 bg-white hover:bg-white/90 text-black text-xs font-bold px-4 py-2 rounded-lg transition-colors"
            >
              Connect Wallet <ArrowRight size={12} />
            </button>
          )}
        </div>
      </nav>

      {/* Hero */}
      <div className="relative max-w-4xl mx-auto px-8 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5 mb-8">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-emerald-400 font-medium">Built on NEAR Protocol · Chain Abstraction</span>
        </div>
        <h1 className="text-5xl font-black leading-tight mb-6 tracking-tight">
          Earn yield across<br />
          <span className="text-emerald-400">any chain.</span><br />
          From one account.
        </h1>
        <p className="text-white/40 text-base leading-relaxed max-w-xl mx-auto mb-10">
          Deposit USDC on Polygon. Earn yield on Ethereum via Aave.
          No bridging. No network switching. No gas headaches.
          OmniVault abstracts the chain so you do not have to think about it.
        </p>
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={handleConnect}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold px-8 py-3.5 rounded-xl transition-colors"
          >
            {isConnected ? <>Go to App <ArrowRight size={16} /></> : <>Launch App <ArrowRight size={16} /></>}
          </button>
          <a href="#how" className="flex items-center gap-2 text-white/40 hover:text-white text-sm transition-colors">
            How it works <ChevronRight size={14} />
          </a>
        </div>
        <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto mt-16">
          {[["8.2%","Est. APY on Aave"],["1","Account for all chains"],["0","Bridges to manage"]].map(([val, label]) => (
            <div key={label} className="bg-white/[0.03] border border-white/5 rounded-xl p-4">
              <p className="text-2xl font-black text-white mb-1">{val}</p>
              <p className="text-xs text-white/30">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div id="how" className="relative max-w-4xl mx-auto px-8 py-20 border-t border-white/5">
        <div className="grid grid-cols-2 gap-16 items-start">
          <div>
            <p className="text-xs text-white/30 tracking-widest uppercase mb-3">How it works</p>
            <h2 className="text-3xl font-black mb-4">One deposit.<br /><span className="text-emerald-400">All chains.</span></h2>
            <p className="text-sm text-white/40 leading-relaxed">
              NEAR Protocol chain signatures let your single NEAR account control assets on any blockchain.
              OmniVault uses this to move your funds to where yield is best automatically.
            </p>
          </div>
          <div className="space-y-0">
            <FlowStep n={1} label="Deposit from any chain" sub="Send USDC from Polygon, Ethereum, or anywhere. Funds land in your OmniVault wallet." />
            <FlowStep n={2} label="Choose your yield strategy" sub="Pick network, type, and protocol. Today: Ethereum + Lending + Aave." />
            <FlowStep n={3} label="OmniVault bridges automatically" sub="NEAR chain signatures move funds cross-chain. No wallet switching needed." />
            <FlowStep n={4} label="Earn yield, withdraw anytime" sub="aUSDC accrues yield. Redeem back to USDC on your original chain." last />
          </div>
        </div>
      </div>

      {/* Features */}
      <div id="features" className="relative max-w-4xl mx-auto px-8 py-20 border-t border-white/5">
        <p className="text-xs text-white/30 tracking-widest uppercase mb-3">Features</p>
        <h2 className="text-3xl font-black mb-10">Chain abstraction,<br /><span className="text-emerald-400">not complexity.</span></h2>
        <div className="grid grid-cols-3 gap-4">
          <FeatureCard icon={<Globe size={16} className="text-emerald-400" />} title="Chain agnostic" desc="Deposit from any chain. Withdraw to any chain. OmniVault handles the routing invisibly." />
          <FeatureCard icon={<Shield size={16} className="text-blue-400" />} title="MPC security" desc="NEAR multi-party computation signs cross-chain transactions. No single key ever exposed." />
          <FeatureCard icon={<Zap size={16} className="text-amber-400" />} title="Best yield routing" desc="Funds go to the highest-performing strategy. Ethereum + Aave today, more chains soon." />
        </div>
      </div>

      {/* Supported */}
      <div className="relative max-w-4xl mx-auto px-8 py-16 border-t border-white/5">
        <p className="text-xs text-white/30 tracking-widest uppercase mb-8 text-center">Supported now · More coming soon</p>
        <div className="flex items-center justify-center gap-6 flex-wrap">
          {[
            { name: "NEAR",     color: "text-white",      live: true  },
            { name: "Ethereum", color: "text-blue-400",   live: true  },
            { name: "Base",  color: "text-purple-400", live: true  },
            { name: "Aave",     color: "text-pink-400",   live: true  },
            { name: "Polygon",     color: "text-blue-300",   live: false },
            { name: "Arbitrum", color: "text-sky-400",    live: false },
            { name: "Solana",   color: "text-green-400",  live: false },
            { name: "Compound", color: "text-teal-400",   live: false },
          ].map(({ name, color, live }) => (
            <div key={name} className={`flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-medium ${live ? "border-white/10 bg-white/[0.03] text-white" : "border-white/5 bg-transparent text-white/20"}`}>
              <span className={live ? color : ""}>{name}</span>
              {!live && <span className="text-white/15">soon</span>}
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="relative max-w-4xl mx-auto px-8 py-20 border-t border-white/5 text-center">
        <h2 className="text-3xl font-black mb-4">Ready to earn<br /><span className="text-emerald-400">without the complexity?</span></h2>
        <p className="text-white/40 text-sm mb-8 max-w-md mx-auto">
          Connect your NEAR wallet and start earning yield across chains in under 2 minutes.
        </p>
        <button
          onClick={handleConnect}
          className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold px-10 py-4 rounded-xl transition-colors"
        >
          {isConnected ? <>Go to Dashboard <ArrowRight size={16} /></> : <>Get Started <ArrowRight size={16} /></>}
        </button>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 px-8 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-emerald-500 flex items-center justify-center">
            <Zap size={10} className="text-black" fill="black" />
          </div>
          <span className="text-xs text-white/30">OMNIVAULT</span>
        </div>
        <p className="text-xs text-white/20">Built on NEAR Protocol · Chain abstraction powered by MPC</p>
      </footer>
    </div>
  );
}