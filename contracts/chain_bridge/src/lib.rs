// ============================================================
// OmniVault — chain_bridge contract (v2)
//
// This is the invisible layer. Users never interact with it.
// It handles two bridge points:
//
//   Bridge point 1 — wallet_core ↔ any external chain
//     Any chain in:  MetaMask (Polygon) → wallet_core
//     Any chain out: wallet_core → user's origin chain
//
//   Bridge point 2 — wallet_core ↔ Ethereum (Aave)
//     Entry: wallet_core funds → Ethereum → Aave deposit → aUSDC
//     Exit:  aUSDC redeem → USDC Ethereum → bridge → origin chain
//
// How NEAR chain signatures work here:
//   1. vault_core calls execute_yield_entry() with position details
//   2. chain_bridge calls v1.signer MPC to sign an Ethereum tx
//   3. MPC nodes jointly sign (no single key ever exposed)
//   4. Signed tx is broadcast to Ethereum
//   5. Aave receives USDC, mints aUSDC to our derived address
//   6. chain_bridge calls vault_core.position_active() to confirm
//
// For hackathon: MPC signing is simulated.
// Architecture and all function signatures are production-ready.
// ============================================================

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, near_bindgen, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
};
use serde::{Deserialize, Serialize};

type Balance = u128;

// ---------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------
#[derive(BorshStorageKey, near_sdk::borsh::BorshSerialize)]
pub enum StorageKey {
    YieldTransfers,
    WalletTransfers,
}

// ---------------------------------------------------------------
// TransferStatus — lifecycle of any cross-chain transfer
// ---------------------------------------------------------------
#[derive(
    near_sdk::borsh::BorshDeserialize,
    near_sdk::borsh::BorshSerialize,
    Serialize,
    Deserialize,
    Clone,
    PartialEq,
)]
pub enum TransferStatus {
    Pending,   // submitted, waiting for MPC signature
    Signed,    // MPC signed, tx ready to broadcast
    Confirmed, // confirmed on target chain
    Failed,    // something went wrong
}

// ---------------------------------------------------------------
// YieldTransfer — tracks one yield entry or exit in flight
// Created by execute_yield_entry, closed by execute_yield_exit
// ---------------------------------------------------------------
#[derive(
    near_sdk::borsh::BorshDeserialize,
    near_sdk::borsh::BorshSerialize,
    Serialize,
    Deserialize,
    Clone,
)]
pub struct YieldTransfer {
    pub position_id: String,
    pub user: AccountId,
    pub amount: Balance,
    pub origin_chain: String,        // e.g. "base"
    pub origin_asset: String,        // e.g. "USDC"
    pub target_address: String,      // derived Ethereum address
    pub yield_token_amount: Balance, // aUSDC received
    pub status: TransferStatus,
    pub created_at: u64,
}

// ---------------------------------------------------------------
// WalletTransfer — tracks wallet_core ↔ external chain transfers
// Bridge point 1: funds coming in or going out of the system
// ---------------------------------------------------------------
#[derive(
    near_sdk::borsh::BorshDeserialize,
    near_sdk::borsh::BorshSerialize,
    Serialize,
    Deserialize,
    Clone,
)]
pub struct WalletTransfer {
    pub id: String,
    pub user: AccountId,
    pub amount: Balance,
    pub external_chain: String,   // e.g. "polygon", "ethereum"
    pub external_address: String, // user's external wallet address
    pub direction: String,        // "inbound" or "outbound"
    pub status: TransferStatus,
    pub created_at: u64,
}

// ---------------------------------------------------------------
// Main contract struct
// ---------------------------------------------------------------
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ChainBridge {
    pub owner: AccountId,

    // vault_core calls execute_yield_entry / execute_yield_exit
    pub vault_contract: AccountId,

    // wallet_core receives funds back after yield exit
    pub wallet_contract: AccountId,

    // NEAR MPC signer — "v1.signer" mainnet / "v1.signer.testnet"
    pub mpc_contract: AccountId,

    // yield transfers: position_id -> YieldTransfer
    pub yield_transfers: LookupMap<String, YieldTransfer>,

    // wallet transfers: transfer_id -> WalletTransfer
    pub wallet_transfers: LookupMap<String, WalletTransfer>,

    // counters for unique ids
    pub path_counter: u64,
    pub wallet_transfer_counter: u64,
}

#[near_bindgen]
impl ChainBridge {
    // -----------------------------------------------------------
    // INIT
    // -----------------------------------------------------------
    #[init]
    pub fn new(
        owner: AccountId,
        vault_contract: AccountId,
        wallet_contract: AccountId,
        mpc_contract: AccountId,
    ) -> Self {
        Self {
            owner,
            vault_contract,
            wallet_contract,
            mpc_contract,
            yield_transfers: LookupMap::new(StorageKey::YieldTransfers),
            wallet_transfers: LookupMap::new(StorageKey::WalletTransfers),
            path_counter: 0,
            wallet_transfer_counter: 0,
        }
    }

    // -----------------------------------------------------------
    // BRIDGE POINT 1 — INBOUND
    // register_inbound_transfer()
    //
    // Called when funds arrive from an external chain into
    // wallet_core. In production this is triggered by a relayer
    // watching the derived address on the external chain.
    //
    // Flow:
    //   External wallet (Polygon) sends USDC to derived address
    //   → Relayer detects it
    //   → Calls this function
    //   → chain_bridge credits wallet_core
    // -----------------------------------------------------------
    #[payable]
    pub fn register_inbound_transfer(
        &mut self,
        user: AccountId,
        external_chain: String,
        asset: String,
        external_address: String,
        amount: U128,
    ) -> String {
        // In production: only authorized relayers can call this
        // For hackathon: owner calls it to simulate inbound
        let caller = env::predecessor_account_id();
        assert!(
            caller == self.owner || caller == self.wallet_contract,
            "Unauthorized"
        );

        self.wallet_transfer_counter += 1;
        let transfer_id = format!("wt-in-{}-{}", user, self.wallet_transfer_counter);

        let transfer = WalletTransfer {
            id: transfer_id.clone(),
            user: user.clone(),
            amount: amount.0,
            external_chain: external_chain.clone(),
            external_address,
            direction: "inbound".to_string(),
            status: TransferStatus::Confirmed,
            created_at: env::block_timestamp(),
        };

        self.wallet_transfers.insert(transfer_id.clone(), transfer);

        env::log_str(&format!(
            "Inbound transfer registered: {} received {} from external chain",
            user, amount.0
        ));

        // Credit wallet_core with the inbound funds
        let chain = external_chain.clone();
        let _ = Promise::new(self.wallet_contract.clone()).function_call(
            "register_inbound_transfer".to_string(),
            format!(
                r#"{{"user":"{}","external_chain":"{}","asset":"{}","amount":"{}"}}"#,
                user, chain, asset, amount.0
            )
            .into_bytes(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(10),
        );

        transfer_id
    }

    // -----------------------------------------------------------
    // BRIDGE POINT 1 — OUTBOUND
    // send_to_external_chain()
    //
    // Called by wallet_core when user withdraws to external chain.
    // Signs a transaction on the target chain using MPC,
    // sending funds to the user's external wallet address.
    // -----------------------------------------------------------
    pub fn send_to_external_chain(
        &mut self,
        user: AccountId,
        external_chain: String,
        external_address: String,
        amount: U128,
    ) -> String {
        assert_eq!(
            env::predecessor_account_id(),
            self.wallet_contract,
            "Only wallet_core can call send_to_external_chain"
        );

        self.wallet_transfer_counter += 1;
        let transfer_id = format!("wt-out-{}-{}", user, self.wallet_transfer_counter);

        // Derive the signing path for this user + chain
        self.path_counter += 1;
        let path = format!("{}-{}", external_chain, self.path_counter);

        // Derive address for signing
        let derived = self.derive_address(&user, &external_chain, &path);

        let transfer = WalletTransfer {
            id: transfer_id.clone(),
            user: user.clone(),
            amount: amount.0,
            external_chain: external_chain.clone(),
            external_address: external_address.clone(),
            direction: "outbound".to_string(),
            status: TransferStatus::Pending,
            created_at: env::block_timestamp(),
        };

        self.wallet_transfers
            .insert(transfer_id.clone(), transfer.clone());

        env::log_str(&format!(
            "Outbound transfer: {} → {} on {} via {}",
            amount.0, external_address, external_chain, derived
        ));

        // In production: call MPC to sign tx on target chain
        // self.call_mpc_signer(payload, path, domain_id)
        // For hackathon: simulate the signing
        self.simulate_sign_and_confirm_wallet(&transfer_id);

        transfer_id
    }

    // -----------------------------------------------------------
    // BRIDGE POINT 2 — YIELD ENTRY
    // execute_yield_entry()
    //
    // Called by vault_core when user opens a yield position.
    // Moves funds from wallet_core → Ethereum → Aave.
    //
    // Production flow:
    //   1. Derive Ethereum address for this user + position
    //   2. Call MPC v1.signer to sign Ethereum bridge tx
    //   3. Broadcast signed tx — funds move to Ethereum
    //   4. Sign Aave deposit() tx on Ethereum
    //   5. Aave mints aUSDC to derived address
    //   6. Call vault_core.position_active() with aUSDC amount
    //
    // Hackathon flow:
    //   Steps 2-5 are simulated.
    //   position_active() is called with a simulated aUSDC amount.
    // -----------------------------------------------------------
    #[payable]
    pub fn execute_yield_entry(
        &mut self,
        position_id: String,
        user: AccountId,
        amount: U128,
        network: String,
        protocol: String,
    ) {
        assert_eq!(
            env::predecessor_account_id(),
            self.vault_contract,
            "Only vault_core can call execute_yield_entry"
        );

        let amount_u128 = amount.0;
        assert!(amount_u128 > 0, "Amount must be greater than zero");

        // Derive a unique Ethereum address for this position
        self.path_counter += 1;
        let path = format!("ethereum-{}", self.path_counter);
        let target_address = self.derive_address(&user, "ethereum", &path);

        let transfer = YieldTransfer {
            position_id: position_id.clone(),
            user: user.clone(),
            amount: amount_u128,
            origin_chain: "near".to_string(),
            origin_asset: "USDC".to_string(),
            target_address: target_address.clone(),
            yield_token_amount: 0,
            status: TransferStatus::Pending,
            created_at: env::block_timestamp(),
        };

        self.yield_transfers.insert(position_id.clone(), transfer);

        env::log_str(&format!(
            "Yield entry: {} → Ethereum {} on {} via {}",
            amount_u128, protocol, network, target_address
        ));

        // In production: MPC signs bridge tx + Aave deposit tx
        // For hackathon: simulate aUSDC receipt
        // aUSDC amount ≈ USDC amount (1:1 minus small fee)
        let simulated_ausdc = (amount_u128 * 99) / 100;

        // Update transfer record
        if let Some(mut t) = self.yield_transfers.get(&position_id).cloned() {
            t.status = TransferStatus::Confirmed;
            t.yield_token_amount = simulated_ausdc;
            self.yield_transfers.insert(position_id.clone(), t);
        }

        // Notify vault_core that position is now active
        let _ = Promise::new(self.vault_contract.clone()).function_call(
            "position_active".to_string(),
            format!(
                r#"{{"position_id":"{}","yield_token_amount":"{}"}}"#,
                position_id, simulated_ausdc
            )
            .into_bytes(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(10),
        );
    }

    // -----------------------------------------------------------
    // BRIDGE POINT 2 — YIELD EXIT
    // execute_yield_exit()
    //
    // Called by vault_core when user closes a yield position.
    // Moves funds from Aave → Ethereum → origin chain → wallet_core
    //
    // Production flow:
    //   1. Sign Aave withdraw() tx — redeem aUSDC → USDC
    //   2. Sign bridge tx — USDC Ethereum → USDC origin chain
    //   3. Funds arrive at derived address on origin chain
    //   4. Relayer detects arrival
    //   5. Call wallet_core.receive_from_vault() with amount + yield
    //
    // Hackathon flow:
    //   Steps 1-4 are simulated.
    //   receive_from_vault() called with original + simulated yield.
    // -----------------------------------------------------------
    pub fn execute_yield_exit(
        &mut self,
        position_id: String,
        user: AccountId,
        origin_chain: String,
        _origin_asset: String,
    ) {
        assert_eq!(
            env::predecessor_account_id(),
            self.vault_contract,
            "Only vault_core can call execute_yield_exit"
        );

        let transfer = self
            .yield_transfers
            .get(&position_id)
            .cloned()
            .expect("Yield transfer not found");

        assert!(
            transfer.status == TransferStatus::Confirmed,
            "Transfer must be confirmed before exit"
        );

        // Calculate return amount: aUSDC + accrued yield
        // In production: read actual aUSDC balance from Ethereum
        // For hackathon: simulate 5% yield on top of aUSDC amount
        let yield_amount = (transfer.yield_token_amount * 5) / 100;
        let total_return = transfer.yield_token_amount + yield_amount;

        env::log_str(&format!(
            "Yield exit: position {} returning {} to {} on {}",
            position_id, total_return, user, origin_chain
        ));

        // Mark transfer as complete
        if let Some(mut t) = self.yield_transfers.get(&position_id).cloned() {
            t.status = TransferStatus::Confirmed;
            self.yield_transfers.insert(position_id.clone(), t);
        }

        // In production: MPC signs Aave withdraw + bridge tx
        // For hackathon: send funds directly back to wallet_core
        // Then notify vault_core position is closed
        let _ = Promise::new(self.wallet_contract.clone()).function_call(
            "receive_from_vault".to_string(),
            format!(r#"{{"user":"{}","amount":"{}"}}"#, user, total_return).into_bytes(),
            NearToken::from_yoctonear(total_return),
            Gas::from_tgas(10),
        );

        let _ = Promise::new(self.vault_contract.clone()).function_call(
            "position_closed".to_string(),
            format!(r#"{{"position_id":"{}"}}"#, position_id).into_bytes(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(10),
        );
    }

    // -----------------------------------------------------------
    // DERIVE ADDRESS
    // Deterministically derives a target chain address from
    // NEAR account + chain + path using sha256.
    //
    // Production: calls v1.signer to get derived public key,
    // converts to chain-specific address format.
    // Hackathon: simulates a realistic-looking address.
    // -----------------------------------------------------------
    fn derive_address(&self, user: &AccountId, chain: &str, path: &str) -> String {
        let seed = format!("{}{}{}", user, chain, path);
        let hash = env::sha256(seed.as_bytes());
        let hex: String = hash[..20].iter().map(|b| format!("{:02x}", b)).collect();

        match chain {
            "ethereum" | "base" | "arbitrum" => format!("0x{}", hex),
            "bitcoin" => format!("bc1q{}", &hex[..20]),
            "solana" => format!("So{}", &hex[..32]),
            _ => format!("0x{}", hex),
        }
    }

    // -----------------------------------------------------------
    // SIMULATE SIGN AND CONFIRM — hackathon demo only
    // Instantly marks a wallet transfer as confirmed.
    // In production: MPC signs async, relayer confirms on-chain.
    // -----------------------------------------------------------
    fn simulate_sign_and_confirm_wallet(&mut self, transfer_id: &str) {
        if let Some(mut t) = self.wallet_transfers.get(transfer_id).cloned() {
            t.status = TransferStatus::Confirmed;
            self.wallet_transfers.insert(transfer_id.to_string(), t);
        }
    }

    // -----------------------------------------------------------
    // VIEW FUNCTIONS
    // -----------------------------------------------------------

    pub fn get_yield_transfer(
        &self,
        position_id: String,
    ) -> Option<(String, String, U128, String, U128, String)> {
        self.yield_transfers.get(&position_id).map(|t| {
            (
                t.position_id.clone(),
                t.user.to_string(),
                U128(t.amount),
                t.target_address.clone(),
                U128(t.yield_token_amount),
                match t.status {
                    TransferStatus::Pending => "pending".to_string(),
                    TransferStatus::Signed => "signed".to_string(),
                    TransferStatus::Confirmed => "confirmed".to_string(),
                    TransferStatus::Failed => "failed".to_string(),
                },
            )
        })
    }

    pub fn get_wallet_transfer(
        &self,
        transfer_id: String,
    ) -> Option<(String, String, U128, String, String, String)> {
        self.wallet_transfers.get(&transfer_id).map(|t| {
            (
                t.id.clone(),
                t.user.to_string(),
                U128(t.amount),
                t.external_chain.clone(),
                t.direction.clone(),
                match t.status {
                    TransferStatus::Pending => "pending".to_string(),
                    TransferStatus::Signed => "signed".to_string(),
                    TransferStatus::Confirmed => "confirmed".to_string(),
                    TransferStatus::Failed => "failed".to_string(),
                },
            )
        })
    }

    pub fn get_mpc_contract(&self) -> AccountId {
        self.mpc_contract.clone()
    }

    pub fn get_vault_contract(&self) -> AccountId {
        self.vault_contract.clone()
    }

    pub fn get_wallet_contract(&self) -> AccountId {
        self.wallet_contract.clone()
    }

    // Public view — frontend calls this to get user's derived address
    // In production: replaced by real MPC v1.signer derivation
    // also called by the relayer. relayer fetches for users from wallet core and calls derived_address from chain bridge,
    // uses this both to listen for both transfer event and corresponding user deposits
    // after relayer fetches for this information both user and derived address, it is cached for optimizations.
    pub fn get_derived_address(&self, user: AccountId, chain: String) -> String {
        let path = format!("{}-1", chain);
        self.derive_address(&user, &chain, &path)
    }
}
