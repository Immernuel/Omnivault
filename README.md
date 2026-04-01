# OmniVault

**Cross-chain yield farming from a single NEAR account — no bridges, no wallets, just World ID.**

Live demo: [defi-vault-eta.vercel.app](https://defi-vault-eta.vercel.app)

---

## What is OmniVault?

OmniVault is a chain abstraction yield vault built on NEAR Protocol. Users deposit NEAR, get verified as real humans via World ID, and their funds are automatically deployed to Aave V3 on Ethereum Sepolia to earn aUSDC yield — all from a single NEAR account with no bridging UI, no MetaMask, and no gas management on Ethereum.

Under the hood, OmniVault uses NEAR's MPC chain signatures (`v1.signer-prod.testnet`) to sign Ethereum transactions on behalf of the user's derived EVM address. No private keys are ever exposed. No bridges. No wrapped tokens.

---

## How It Works

```
User (World ID verified)
  → Deposit NEAR into wallet_core
  → Open yield position
  → vault_core routes to chain_bridge
  → chain_bridge requests MPC signature from v1.signer-prod.testnet
  → NEAR MPC nodes jointly sign Ethereum tx
  → Relayer broadcasts signed tx to Ethereum Sepolia
  → Funds deployed to Aave V3 → earns aUSDC yield
  → All tracked on-chain from one NEAR account
```

---

## Architecture

### Smart Contracts (NEAR Testnet — Rust)

| Contract | Address | Role |
|---|---|---|
| `wallet_core` | `wallet-core.omnivault.testnet` | Custodial multi-asset wallet with World ID gating |
| `vault_core` | `vault-core.omnivault.testnet` | Yield position routing and tracking |
| `chain_bridge` | `chain-bridge.omnivault.testnet` | MPC signing coordinator and cross-chain bridge |

### Frontend
- Next.js 14 + TypeScript, deployed on Vercel
- NEAR Wallet Selector for wallet connection
- World ID MiniKit (`@worldcoin/minikit-js`) for human verification
- Real-time dashboard with on-chain position tracking

### Relayer
- Node.js + TypeScript
- Watches Sepolia USDC transfers and registers inbound deposits
- MPC signer calls `v1.signer-prod.testnet` directly with 300 Tgas

---

## Key Features

- **World ID Gating** — Only verified humans can open yield positions, preventing sybil attacks and bot farming
- **NEAR Chain Signatures** — Real MPC signing: NEAR nodes jointly sign Ethereum transactions without ever exposing a private key
- **Multi-Asset Wallet** — Supports NEAR, ETH, USDC across Ethereum Sepolia and Base
- **Chain Abstraction** — Users interact only with NEAR; all cross-chain complexity is invisible
- **Live Dashboard** — Real-time position tracking with Etherscan and NEAR Explorer proof links

---

## Tech Stack

- **Blockchain**: NEAR Protocol, Ethereum Sepolia
- **Smart Contracts**: Rust, NEAR SDK 5.5, `omni-transaction` crate
- **MPC**: NEAR Chain Signatures (`v1.signer-prod.testnet`)
- **Yield**: Aave V3 on Sepolia
- **Frontend**: Next.js, TypeScript, Tailwind CSS, Vercel
- **Identity**: World ID / Worldcoin MiniKit
- **Relayer**: Node.js, ethers.js, `@near-js` SDK

---

## Project Structure

```
omnivault/
├── contracts/
│   ├── wallet_core/       # Multi-asset wallet + World ID
│   ├── vault_core/        # Yield routing
│   └── chain_bridge/      # MPC signing + cross-chain
├── apps/
│   └── web/               # Next.js frontend (Vercel)
│       ├── app/
│       │   ├── dashboard/ # Portfolio dashboard
│       │   └── vault/     # Yield position management
│       └── lib/
│           ├── contracts.ts     # Contract interactions
│           ├── useVaultData.ts  # Data fetching hook
│           └── useWorldId.ts    # World ID hook
└── relayer/               # USDC transfer watcher + MPC signer
    └── src/
        ├── relayer.ts     # Sepolia USDC event listener
        ├── mpc_signer.ts  # Direct MPC signing
        └── near.ts        # NEAR account setup
```

---

## Contract Addresses (NEAR Testnet)

```
wallet-core.omnivault.testnet
vault-core.omnivault.testnet
chain-bridge.omnivault.testnet
```

---

## Local Development

### Prerequisites
- Rust + `cargo-near`
- Node.js 18+
- NEAR CLI

### Build and Deploy Contracts

```bash
# Build
cd contracts/wallet_core && cargo near build non-reproducible-wasm
cd contracts/vault_core && cargo near build non-reproducible-wasm
cd contracts/chain_bridge && cargo near build non-reproducible-wasm

# Deploy (from repo root)
near contract deploy wallet-core.omnivault.testnet \
  use-file target/near/wallet_core/wallet_core.wasm \
  without-init-call network-config testnet sign-with-legacy-keychain send

# Initialize
near contract call-function as-transaction wallet-core.omnivault.testnet new \
  json-args '{"owner":"omnivault.testnet","vault_contract":"vault-core.omnivault.testnet","bridge_contract":"chain-bridge.omnivault.testnet"}' \
  prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
  sign-as omnivault.testnet network-config testnet sign-with-legacy-keychain send
```

### Run Frontend

```bash
cd apps/web
cp .env.example .env.local
# Fill in WORLD_APP_ID, NEAR_OWNER_ACCOUNT, NEAR_OWNER_PRIVATE_KEY
npm install && npm run dev
```

### Run Relayer

```bash
cd relayer
cp .env.example .env
# Fill in NEAR_ACCOUNT, NEAR_PRIVATE_KEY, SEPOLIA_RPC, CHAIN_BRIDGE
npm install && npm run dev
```

### Sign a Yield Position (MPC)

```bash
cd relayer
npm run sign <position_id>
# e.g. npm run sign pos-profemm.testnet-2
```

---

## Environment Variables

### Frontend (apps/web/.env.local)

```
WORLD_APP_ID=app_...
NEAR_OWNER_ACCOUNT=omnivault.testnet
NEAR_OWNER_PRIVATE_KEY=ed25519:...
NEXT_PUBLIC_ALLOW_DEV_BYPASS=true
```

### Relayer (relayer/.env)

```
NEAR_ACCOUNT=relayer.omnivault.testnet
NEAR_PRIVATE_KEY=ed25519:...
SEPOLIA_RPC=https://...
CHAIN_BRIDGE=chain-bridge.omnivault.testnet
WALLET_CORE=wallet-core.omnivault.testnet
```

---

## Hackathon

Built for the **NEAR Protocol Hackathon** and **World: World Build 3 — The Human-Centric App Challenge**.

OmniVault demonstrates that chain abstraction is not just a concept — it is a working primitive. A user can earn yield on Ethereum without knowing Ethereum exists.

---

## License

MIT
