// ============================================================
// OmniVault — wallet_core contract (v2)
//
// Multi-asset custodial wallet.
// Tracks balances per user per asset:
//   NEAR, ETH_SEPOLIA, USDC_SEPOLIA, ETH_BASE, USDC_BASE
//
// All funds enter and exit OmniVault through here.
// ============================================================

use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::{LookupMap, UnorderedSet};
use near_sdk::{
    env, near, near_bindgen, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
};

type Balance = u128;

// ---------------------------------------------------------------
// Supported assets
// ---------------------------------------------------------------
pub const ASSET_NEAR: &str = "NEAR";
pub const ASSET_ETH_SEP: &str = "ETH_SEPOLIA";
pub const ASSET_USDC_SEP: &str = "USDC_SEPOLIA";
pub const ASSET_ETH_BASE: &str = "ETH_BASE";
pub const ASSET_USDC_BASE: &str = "USDC_BASE";

pub const SUPPORTED_ASSETS: [&str; 5] = [
    ASSET_NEAR,
    ASSET_ETH_SEP,
    ASSET_USDC_SEP,
    ASSET_ETH_BASE,
    ASSET_USDC_BASE,
];

// ---------------------------------------------------------------
// AssetBalance — one asset entry for a user
// ---------------------------------------------------------------
#[derive(
    near_sdk::borsh::BorshDeserialize,
    near_sdk::borsh::BorshSerialize,
    Serialize,
    Deserialize,
    Clone,
)]
pub struct AssetBalance {
    pub asset: String,
    pub amount: Balance,
    pub chain: String, // e.g. "near", "ethereum", "base"
}

// ---------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------
#[derive(BorshStorageKey, near_sdk::borsh::BorshSerialize)]
pub enum StorageKey {
    // user -> Vec<AssetBalance>
    Balances,
    // user -> how much is in vault per asset
    VaultDeposits,

    Users,
    VerifiedUsers,
    Nullifiers,
}

// ---------------------------------------------------------------
// Main contract
// ---------------------------------------------------------------
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct WalletCore {
    pub owner: AccountId,
    pub vault_contract: AccountId,
    pub bridge_contract: AccountId,

    // user -> list of asset balances
    pub balances: LookupMap<AccountId, Vec<AssetBalance>>,

    // user -> list of vault deposits per asset
    pub vault_deposits: LookupMap<AccountId, Vec<AssetBalance>>,

    pub users: UnorderedSet<AccountId>,
    pub verified_users: LookupMap<AccountId, bool>,
    pub used_nullifiers: UnorderedSet<String>,
}

#[near_bindgen]
impl WalletCore {
    #[init]
    pub fn new(owner: AccountId, vault_contract: AccountId, bridge_contract: AccountId) -> Self {
        Self {
            owner,
            vault_contract,
            bridge_contract,
            balances: LookupMap::new(StorageKey::Balances),
            vault_deposits: LookupMap::new(StorageKey::VaultDeposits),
            users: UnorderedSet::new(StorageKey::Users),
            verified_users: LookupMap::new(StorageKey::VerifiedUsers),
            used_nullifiers: UnorderedSet::new(StorageKey::Nullifiers),
        }
    }

    // our backend will call verify_user
    pub fn verify_user(&mut self, user: AccountId, nullifier_hash: String) {
        let caller = env::predecessor_account_id();

        // Only backend or owner can verify
        assert!(caller == self.owner, "Only backend/owner can verify users");

        // Prevent reuse of nullifier (one human = one account)
        assert!(
            !self.used_nullifiers.contains(&nullifier_hash),
            "Nullifier already used"
        );

        self.used_nullifiers.insert(nullifier_hash);
        self.verified_users.insert(user.clone(), true);

        // Register user
        self.users.insert(user.clone());

        env::log_str(&format!("User {} verified via World ID", user));
    }

    // -----------------------------------------------------------
    // DEPOSIT NEAR — user sends NEAR directly
    // -----------------------------------------------------------
    #[payable]
    pub fn deposit(&mut self) {
        let user = env::predecessor_account_id();

        // ✅ Enforce World ID verification
        let is_verified = self.verified_users.get(&user).copied().unwrap_or(false);
        assert!(is_verified, "User must verify with World ID first");

        let amount = env::attached_deposit().as_yoctonear();
        assert!(amount > 0, "Deposit must be greater than zero");

        self.credit_asset(&user, ASSET_NEAR, "near", amount);

        // Register user if not already
        self.users.insert(user.clone());

        env::log_str(&format!("NEAR deposit: {} for {}", amount, user));
    }

    // -----------------------------------------------------------
    // CREDIT ASSET — called by chain_bridge when external
    // funds arrive at a derived address and are detected
    // by the relayer.
    //
    // asset:  "NEAR" | "ETH_SEPOLIA" | "USDC_SEPOLIA" |
    //         "ETH_BASE" | "USDC_BASE"
    // amount: raw amount in smallest unit
    //         NEAR: yoctoNEAR
    //         ETH:  wei (10^18)
    //         USDC: micro (10^6)
    // -----------------------------------------------------------
    fn credit_asset(&mut self, user: &AccountId, asset: &str, chain: &str, amount: Balance) {
        let mut balances = self.balances.get(user).cloned().unwrap_or_default();

        if let Some(entry) = balances.iter_mut().find(|b| b.asset == asset) {
            entry.amount += amount;
        } else {
            balances.push(AssetBalance {
                asset: asset.to_string(),
                amount,
                chain: chain.to_string(),
            });
        }

        self.balances.insert(user.clone(), balances);
    }

    // -----------------------------------------------------------
    // REGISTER INBOUND TRANSFER
    // Called by chain_bridge (or owner for demo) when external
    // funds arrive at a derived address.
    // -----------------------------------------------------------
    #[payable]
    pub fn register_inbound_transfer(
        &mut self,
        user: AccountId,
        external_chain: String,
        asset: String,
        amount: U128,
    ) {
        let caller = env::predecessor_account_id();
        let relayer: AccountId = "relayer.omnivault.testnet".parse().unwrap();

        assert!(
            caller == self.owner || caller == self.bridge_contract || caller == relayer,
            "Unauthorized"
        );

        // ✅ Enforce World ID here too
        let is_verified = self.verified_users.get(&user).copied().unwrap_or(false);
        assert!(is_verified, "User must verify with World ID first");

        let asset_key = Self::resolve_asset_key(&external_chain, &asset);

        self.credit_asset(&user, &asset_key, &external_chain, amount.0);

        self.users.insert(user.clone());

        env::log_str(&format!(
            "Inbound: {} {} on {} credited to {}",
            amount.0, asset, external_chain, user
        ));
    }
    // -----------------------------------------------------------
    // OPEN YIELD POSITION
    // User moves funds from wallet into vault for yield farming.
    // -----------------------------------------------------------
    #[payable]
    pub fn open_yield_position(
        &mut self,
        amount: U128,
        origin_chain: String,
        origin_asset: String,
        network: String,
        yield_type: String,
        protocol: String,
    ) -> Promise {
        let user = env::predecessor_account_id();
        let amount_u128 = amount.0;
        let asset_key = Self::resolve_asset_key(&origin_chain, &origin_asset);

        // Check balance
        let bal = self.get_asset_balance(user.clone(), asset_key.clone()).0;
        assert!(amount_u128 > 0, "Amount must be greater than zero");
        assert!(amount_u128 <= bal, "Insufficient balance");

        // Deduct from wallet
        self.deduct_asset(&user, &asset_key, amount_u128);

        // Track in vault deposits
        self.credit_vault_deposit(&user, &asset_key, &origin_chain, amount_u128);

        env::log_str(&format!(
            "Opening yield position: {} {} → {} on {}",
            amount_u128, asset_key, protocol, network
        ));

        Promise::new(self.vault_contract.clone())
            .function_call(
                "open_position".to_string(),
                format!(
                    r#"{{"user":"{}","origin_chain":"{}","origin_asset":"{}","network":"{}", "yield_type":"{}","protocol":"{}"}}"#,
                    user, origin_chain, origin_asset, network, yield_type, protocol
                ).into_bytes(),
                NearToken::from_yoctonear(amount_u128),
                Gas::from_tgas(50),
            )
    }

    // -----------------------------------------------------------
    // CLOSE YIELD POSITION
    // -----------------------------------------------------------
    pub fn close_yield_position(&mut self, position_id: String) -> Promise {
        let _user = env::predecessor_account_id();
        Promise::new(self.vault_contract.clone()).function_call(
            "close_position".to_string(),
            format!(r#"{{"position_id":"{}"}}"#, position_id).into_bytes(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(50),
        )
    }

    // -----------------------------------------------------------
    // RECEIVE FROM VAULT
    // Called by chain_bridge when yield exit completes.
    // Funds return here with original asset + yield.
    // -----------------------------------------------------------
    #[payable]
    pub fn receive_from_vault(&mut self, user: AccountId, amount: U128) {
        let caller = env::predecessor_account_id();
        assert!(
            caller == self.vault_contract || caller == self.bridge_contract,
            "Only vault_core or chain_bridge can call receive_from_vault"
        );

        let amount_u128 = amount.0;
        let attached = env::attached_deposit().as_yoctonear();
        assert_eq!(attached, amount_u128, "Attached deposit mismatch");

        // Return as NEAR for now — in production convert back to origin asset
        self.credit_asset(&user, ASSET_NEAR, "near", amount_u128);

        // Clear vault deposit tracking
        self.vault_deposits.remove(&user);

        env::log_str(&format!("Received {} from vault for {}", amount_u128, user));
    }

    // -----------------------------------------------------------
    // WITHDRAW NEAR
    // -----------------------------------------------------------
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        let user = env::predecessor_account_id();
        let amount_u128 = amount.0;
        let bal = self
            .get_asset_balance(user.clone(), ASSET_NEAR.to_string())
            .0;

        assert!(amount_u128 > 0, "Amount must be greater than zero");
        assert!(amount_u128 <= bal, "Insufficient NEAR balance");

        self.deduct_asset(&user, ASSET_NEAR, amount_u128);

        Promise::new(user).transfer(NearToken::from_yoctonear(amount_u128))
    }

    // -----------------------------------------------------------
    // WITHDRAW TO EXTERNAL CHAIN
    // -----------------------------------------------------------
    pub fn withdraw_to_chain(
        &mut self,
        amount: U128,
        asset: String,
        external_chain: String,
        external_address: String,
    ) -> Promise {
        let user = env::predecessor_account_id();
        let amount_u128 = amount.0;
        let asset_key = Self::resolve_asset_key(&external_chain, &asset);
        let bal = self.get_asset_balance(user.clone(), asset_key.clone()).0;

        assert!(amount_u128 > 0, "Amount must be greater than zero");
        assert!(amount_u128 <= bal, "Insufficient balance");

        self.deduct_asset(&user, &asset_key, amount_u128);

        Promise::new(self.bridge_contract.clone()).function_call(
            "send_to_external_chain".to_string(),
            format!(
                r#"{{"user":"{}","external_chain":"{}","external_address":"{}","amount":"{}"}}"#,
                user, external_chain, external_address, amount_u128
            )
            .into_bytes(),
            NearToken::from_yoctonear(amount_u128),
            Gas::from_tgas(30),
        )
    }

    // -----------------------------------------------------------
    // INTERNAL HELPERS
    // -----------------------------------------------------------

    fn deduct_asset(&mut self, user: &AccountId, asset: &str, amount: Balance) {
        let mut balances = self.balances.get(user).cloned().unwrap_or_default();
        if let Some(entry) = balances.iter_mut().find(|b| b.asset == asset) {
            assert!(entry.amount >= amount, "Insufficient balance");
            entry.amount -= amount;
        }
        self.balances.insert(user.clone(), balances);
    }

    fn credit_vault_deposit(
        &mut self,
        user: &AccountId,
        asset: &str,
        chain: &str,
        amount: Balance,
    ) {
        let mut deposits = self.vault_deposits.get(user).cloned().unwrap_or_default();

        if let Some(entry) = deposits.iter_mut().find(|b| b.asset == asset) {
            entry.amount += amount;
        } else {
            deposits.push(AssetBalance {
                asset: asset.to_string(),
                amount,
                chain: chain.to_string(),
            });
        }

        self.vault_deposits.insert(user.clone(), deposits);
    }

    // Map (chain, asset_name) → internal asset key
    fn resolve_asset_key(chain: &str, asset: &str) -> String {
        match (chain, asset) {
            ("near", "NEAR") => ASSET_NEAR.to_string(),
            ("ethereum", "ETH") => ASSET_ETH_SEP.to_string(),
            ("ethereum", "USDC") => ASSET_USDC_SEP.to_string(),
            ("base", "ETH") => ASSET_ETH_BASE.to_string(),
            ("base", "USDC") => ASSET_USDC_BASE.to_string(),
            // Fallback: chain_ASSET
            _ => format!("{}_{}", chain.to_uppercase(), asset.to_uppercase()),
        }
    }

    // -----------------------------------------------------------
    // VIEW FUNCTIONS
    // -----------------------------------------------------------

    // Get balance of a specific asset for a user
    pub fn get_asset_balance(&self, account_id: AccountId, asset: String) -> U128 {
        let balances = self.balances.get(&account_id).cloned().unwrap_or_default();

        U128(
            balances
                .iter()
                .find(|b| b.asset == asset)
                .map(|b| b.amount)
                .unwrap_or(0),
        )
    }

    // Get all asset balances for a user
    pub fn get_all_balances(&self, account_id: AccountId) -> Vec<(String, U128, String)> {
        let balances = self.balances.get(&account_id).cloned().unwrap_or_default();

        // Return all supported assets, zero if not present
        SUPPORTED_ASSETS
            .iter()
            .map(|asset| {
                let entry = balances.iter().find(|b| b.asset == *asset);
                let amount = entry.map(|b| b.amount).unwrap_or(0);
                let chain = entry.map(|b| b.chain.clone()).unwrap_or_default();
                (asset.to_string(), U128(amount), chain)
            })
            .collect()
    }

    // Get all vault deposits for a user
    pub fn get_vault_deposits(&self, account_id: AccountId) -> Vec<(String, U128)> {
        let deposits = self
            .vault_deposits
            .get(&account_id)
            .cloned()
            .unwrap_or_default();

        deposits
            .iter()
            .map(|b| (b.asset.clone(), U128(b.amount)))
            .collect()
    }

    // Legacy: get NEAR wallet balance (backward compat)
    pub fn get_wallet_balance(&self, account_id: AccountId) -> U128 {
        self.get_asset_balance(account_id, ASSET_NEAR.to_string())
    }

    // Legacy: get vault deposit total in NEAR (backward compat)
    pub fn get_vault_deposit(&self, account_id: AccountId) -> U128 {
        let deposits = self
            .vault_deposits
            .get(&account_id)
            .cloned()
            .unwrap_or_default();
        U128(deposits.iter().map(|b| b.amount).sum())
    }

    pub fn get_vault_contract(&self) -> AccountId {
        self.vault_contract.clone()
    }

    pub fn get_bridge_contract(&self) -> AccountId {
        self.bridge_contract.clone()
    }

    pub fn get_all_users(&self) -> Vec<AccountId> {
        self.users.iter().cloned().collect()
    }

    pub fn is_user_verified(&self, user: AccountId) -> bool {
        self.verified_users.get(&user).copied().unwrap_or(false)
    }
}
