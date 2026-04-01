// ============================================================
// OmniVault — vault_core contract (v2)
//
// This is NOT a yield pool. It is a routing layer.
// Users make 4 conscious choices here:
//   1. Amount  — how much to commit from wallet_core
//   2. Network — which chain to farm on (Ethereum now)
//   3. Type    — what kind of yield (Lending now)
//   4. Protocol— which protocol (Aave now)
//
// Then vault_core hands off to chain_bridge to execute.
// Funds flow: wallet_core → vault_core → chain_bridge
//           → Ethereum Aave → aUSDC position
// Return:    Aave → chain_bridge → vault_core → wallet_core
// ============================================================

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, near_bindgen, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
};
use serde::Deserialize;
use serde::Serialize;

type Balance = u128;

// ---------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------
#[derive(BorshStorageKey, near_sdk::borsh::BorshSerialize)]
pub enum StorageKey {
    Positions,
    UserPositionIds,
}

// ---------------------------------------------------------------
// Network — supported target chains for yield farming
// Open architecture: add more chains post-hackathon
// ---------------------------------------------------------------
#[derive(
    near_sdk::borsh::BorshDeserialize,
    near_sdk::borsh::BorshSerialize,
    Serialize,
    Deserialize,
    Clone,
    PartialEq,
    Debug,
    schemars::JsonSchema,
)]
pub enum Network {
    Ethereum, // supported now
    Base,     // coming soon
    Arbitrum, // coming soon
}

// ---------------------------------------------------------------
// YieldType — category of yield strategy
// Open architecture: add more types post-hackathon
// ---------------------------------------------------------------
#[derive(
    near_sdk::borsh::BorshDeserialize,
    near_sdk::borsh::BorshSerialize,
    Serialize,
    Deserialize,
    Clone,
    PartialEq,
    Debug,
    schemars::JsonSchema,
)]
pub enum YieldType {
    Lending, // supported now (Aave)
    LpDex,   // coming soon (Uniswap, Curve)
    Staking, // coming soon
}

// ---------------------------------------------------------------
// Protocol — specific protocol to use
// Open architecture: add more protocols post-hackathon
// ---------------------------------------------------------------
#[derive(
    near_sdk::borsh::BorshDeserialize,
    near_sdk::borsh::BorshSerialize,
    Serialize,
    Deserialize,
    Clone,
    PartialEq,
    Debug,
    schemars::JsonSchema,
)]
pub enum Protocol {
    Aave,     // supported now
    Compound, // coming soon
    Uniswap,  // coming soon
    Curve,    // coming soon
}

// ---------------------------------------------------------------
// PositionStatus — lifecycle of a yield position
// ---------------------------------------------------------------
#[derive(
    near_sdk::borsh::BorshDeserialize,
    near_sdk::borsh::BorshSerialize,
    Serialize,
    Deserialize,
    Clone,
    PartialEq,
)]
pub enum PositionStatus {
    Bridging,  // funds in transit via chain_bridge
    Active,    // funds deployed in yield protocol
    Redeeming, // user requested withdrawal, funds returning
    Closed,    // position fully withdrawn back to wallet_core
}

// ---------------------------------------------------------------
// YieldPosition — one user's active yield farming position
// Created when user commits funds through vault_core
// ---------------------------------------------------------------
#[derive(
    near_sdk::borsh::BorshDeserialize,
    near_sdk::borsh::BorshSerialize,
    Serialize,
    Deserialize,
    Clone,
)]
pub struct YieldPosition {
    pub id: String,
    pub user: AccountId,
    pub amount: Balance,       // original amount committed (yoctoNEAR equiv)
    pub origin_chain: String,  // where funds came from e.g. "polygon"
    pub origin_asset: String,  // original asset e.g. "USDC"
    pub network: Network,      // target chain e.g. Ethereum
    pub yield_type: YieldType, // e.g. Lending
    pub protocol: Protocol,    // e.g. Aave
    pub status: PositionStatus,
    pub yield_token_amount: Balance, // aUSDC balance (grows over time)
    pub created_at: u64,
    pub updated_at: u64,
}

// ---------------------------------------------------------------
// Main contract struct
// ---------------------------------------------------------------
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct VaultCore {
    pub owner: AccountId,

    // wallet_core address — only this can call open_position
    pub wallet_contract: AccountId,

    // chain_bridge address — vault_core calls this to execute
    pub bridge_contract: AccountId,

    // all yield positions keyed by position id
    pub positions: LookupMap<String, YieldPosition>,

    // maps user -> list of their position ids
    pub user_position_ids: LookupMap<AccountId, Vec<String>>,

    // position counter for unique ids
    pub position_counter: u64,
}

#[near_bindgen]
impl VaultCore {
    // -----------------------------------------------------------
    // INIT
    // -----------------------------------------------------------
    #[init]
    pub fn new(owner: AccountId, wallet_contract: AccountId, bridge_contract: AccountId) -> Self {
        Self {
            owner,
            wallet_contract,
            bridge_contract,
            positions: LookupMap::new(StorageKey::Positions),
            user_position_ids: LookupMap::new(StorageKey::UserPositionIds),
            position_counter: 0,
        }
    }

    // -----------------------------------------------------------
    // OPEN POSITION — the main entry point
    //
    // Called by wallet_core when user commits funds.
    // This is where the 4 user choices are recorded.
    // Then chain_bridge is called to execute the cross-chain move.
    //
    // For hackathon: only Ethereum + Lending + Aave is valid.
    // Architecture is open — add more combinations post-hackathon.
    // -----------------------------------------------------------
    #[payable]
    pub fn open_position(
        &mut self,
        user: AccountId,
        origin_chain: String, // e.g. "polygon"
        origin_asset: String, // e.g. "USDC"
        network: Network,
        yield_type: YieldType,
        protocol: Protocol,
    ) -> String {
        // Only wallet_core can open positions on behalf of users
        assert_eq!(
            env::predecessor_account_id(),
            self.wallet_contract,
            "Only wallet_core can open positions"
        );

        let amount = env::attached_deposit().as_yoctonear();
        assert!(amount > 0, "Amount must be greater than zero");

        // Validate supported combinations
        // Open architecture: just add more arms here post-hackathon
        self.assert_supported(&network, &yield_type, &protocol);

        // Generate unique position id
        self.position_counter += 1;
        let position_id = format!("pos-{}-{}", user, self.position_counter);

        let position = YieldPosition {
            id: position_id.clone(),
            user: user.clone(),
            amount,
            origin_chain,
            origin_asset,
            network: network.clone(),
            yield_type,
            protocol: protocol.clone(),
            status: PositionStatus::Bridging,
            yield_token_amount: 0,
            created_at: env::block_timestamp(),
            updated_at: env::block_timestamp(),
        };

        // Store position
        self.positions.insert(position_id.clone(), position);

        // Track user's position ids
        let mut ids = self
            .user_position_ids
            .get(&user)
            .cloned()
            .unwrap_or_default();
        ids.push(position_id.clone());
        self.user_position_ids.insert(user.clone(), ids);

        env::log_str(&format!(
            "Position opened: {} committed {} for {:?} on {:?}",
            user, amount, protocol, network
        ));

        // Hand off to chain_bridge to execute the cross-chain move
        // chain_bridge will:
        //   1. Bridge funds from origin chain to Ethereum
        //   2. Deposit into Aave
        //   3. Call back position_active() when done
        let _ = Promise::new(self.bridge_contract.clone())
            .function_call(
                "execute_yield_entry".to_string(),
                format!(
                    r#"{{"position_id":"{}","user":"{}","amount":"{}","network":"Ethereum","protocol":"Aave"}}"#,
                    position_id, user, amount
                ).into_bytes(),
                NearToken::from_yoctonear(amount),
                Gas::from_tgas(200),
            );

        position_id
    }

    // -----------------------------------------------------------
    // POSITION ACTIVE — callback from chain_bridge
    // Called when funds have been successfully deposited into Aave.
    // Updates position status and records aUSDC amount received.
    // -----------------------------------------------------------
    pub fn position_active(&mut self, position_id: String, yield_token_amount: U128) {
        assert_eq!(
            env::predecessor_account_id(),
            self.bridge_contract,
            "Only chain_bridge can call position_active"
        );

        let mut position = self
            .positions
            .get(&position_id)
            .cloned()
            .expect("Position not found");

        position.status = PositionStatus::Active;
        position.yield_token_amount = yield_token_amount.0;
        position.updated_at = env::block_timestamp();

        self.positions.insert(position_id.clone(), position);

        env::log_str(&format!(
            "Position active: {} — {} aUSDC received",
            position_id, yield_token_amount.0
        ));
    }

    // -----------------------------------------------------------
    // CLOSE POSITION — user requests withdrawal
    //
    // Can only close an Active position.
    // Triggers chain_bridge to:
    //   1. Redeem aUSDC → USDC on Ethereum
    //   2. Bridge USDC back to origin chain
    //   3. Call receive_from_vault() on wallet_core
    // -----------------------------------------------------------
    pub fn close_position(&mut self, position_id: String) -> Promise {
        let caller = env::predecessor_account_id();

        let mut position = self
            .positions
            .get(&position_id)
            .cloned()
            .expect("Position not found");

        // Only the position owner or wallet_core can close
        assert!(
            caller == position.user || caller == self.wallet_contract,
            "Unauthorized"
        );
        assert!(
            position.status == PositionStatus::Active,
            "Position must be active to close"
        );

        position.status = PositionStatus::Redeeming;
        position.updated_at = env::block_timestamp();
        self.positions.insert(position_id.clone(), position.clone());

        env::log_str(&format!("Closing position: {}", position_id));

        // Tell chain_bridge to pull funds back
        // chain_bridge will:
        //   1. Redeem aUSDC → USDC on Ethereum
        //   2. Bridge back to origin chain (e.g. Polygon)
        //   3. Call wallet_core.receive_from_vault()
        Promise::new(self.bridge_contract.clone()).function_call(
            "execute_yield_exit".to_string(),
            format!(
                r#"{{"position_id":"{}","user":"{}","origin_chain":"{}","origin_asset":"{}"}}"#,
                position_id, position.user, position.origin_chain, position.origin_asset,
            )
            .into_bytes(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(30),
        )
    }

    // -----------------------------------------------------------
    // POSITION CLOSED — callback from chain_bridge
    // Called when funds have landed back in wallet_core.
    // Marks position as fully closed.
    // -----------------------------------------------------------
    pub fn position_closed(&mut self, position_id: String) {
        assert_eq!(
            env::predecessor_account_id(),
            self.bridge_contract,
            "Only chain_bridge can call position_closed"
        );

        let mut position = self
            .positions
            .get(&position_id)
            .cloned()
            .expect("Position not found");

        position.status = PositionStatus::Closed;
        position.updated_at = env::block_timestamp();
        self.positions.insert(position_id.clone(), position);

        env::log_str(&format!("Position closed: {}", position_id));
    }

    // -----------------------------------------------------------
    // UPDATE YIELD TOKEN AMOUNT
    // Called periodically by chain_bridge to sync aUSDC balance.
    // This is how the frontend shows growing yield in real time.
    // -----------------------------------------------------------
    pub fn update_yield_amount(&mut self, position_id: String, new_amount: U128) {
        assert_eq!(
            env::predecessor_account_id(),
            self.bridge_contract,
            "Only chain_bridge can update yield amounts"
        );

        let mut position = self
            .positions
            .get(&position_id)
            .cloned()
            .expect("Position not found");

        position.yield_token_amount = new_amount.0;
        position.updated_at = env::block_timestamp();
        self.positions.insert(position_id.clone(), position);
    }

    // -----------------------------------------------------------
    // SUPPORTED COMBINATIONS — validation gate
    //
    // This is the open architecture hook.
    // For hackathon: only Ethereum + Lending + Aave.
    // Post-hackathon: add more arms to each match.
    // -----------------------------------------------------------
    fn assert_supported(&self, network: &Network, yield_type: &YieldType, protocol: &Protocol) {
        assert!(
            matches!(network, Network::Ethereum),
            "Only Ethereum is supported at this time"
        );
        assert!(
            matches!(yield_type, YieldType::Lending),
            "Only Lending is supported at this time"
        );
        assert!(
            matches!(protocol, Protocol::Aave),
            "Only Aave is supported at this time"
        );
    }

    // -----------------------------------------------------------
    // VIEW FUNCTIONS
    // -----------------------------------------------------------

    pub fn get_position(
        &self,
        position_id: String,
    ) -> Option<(
        String, // id
        String, // user
        U128,   // amount
        String, // origin_chain
        String, // origin_asset
        String, // network
        String, // yield_type
        String, // protocol
        String, // status
        U128,   // yield_token_amount
        u64,    // created_at
    )> {
        self.positions.get(&position_id).map(|p| {
            (
                p.id.clone(),
                p.user.to_string(),
                U128(p.amount),
                p.origin_chain.clone(),
                p.origin_asset.clone(),
                format!("{:?}", p.network),
                format!("{:?}", p.yield_type),
                format!("{:?}", p.protocol),
                match p.status {
                    PositionStatus::Bridging => "bridging".to_string(),
                    PositionStatus::Active => "active".to_string(),
                    PositionStatus::Redeeming => "redeeming".to_string(),
                    PositionStatus::Closed => "closed".to_string(),
                },
                U128(p.yield_token_amount),
                p.created_at,
            )
        })
    }

    // Get all positions for a user — used by frontend dashboard
    pub fn get_user_positions(
        &self,
        user: AccountId,
    ) -> Vec<(String, U128, String, String, String, U128, String)> {
        let ids = self
            .user_position_ids
            .get(&user)
            .cloned()
            .unwrap_or_default();

        ids.iter()
            .filter_map(|id| self.positions.get(id))
            .map(|p| {
                (
                    p.id.clone(),
                    U128(p.amount),
                    format!("{:?}", p.protocol),
                    format!("{:?}", p.network),
                    match p.status {
                        PositionStatus::Bridging => "bridging".to_string(),
                        PositionStatus::Active => "active".to_string(),
                        PositionStatus::Redeeming => "redeeming".to_string(),
                        PositionStatus::Closed => "closed".to_string(),
                    },
                    U128(p.yield_token_amount),
                    p.origin_asset.clone(),
                )
            })
            .collect()
    }

    // What networks, types and protocols are currently supported?
    // Frontend uses this to show available options
    pub fn get_supported_options(
        &self,
    ) -> (
        Vec<String>, // networks
        Vec<String>, // yield types
        Vec<String>, // protocols
    ) {
        (
            vec!["Ethereum".to_string()],
            vec!["Lending".to_string()],
            vec!["Aave".to_string()],
        )
    }

    // What's coming soon — for frontend "coming soon" badges
    pub fn get_coming_soon(
        &self,
    ) -> (
        Vec<String>, // networks
        Vec<String>, // yield types
        Vec<String>, // protocols
    ) {
        (
            vec![
                "Base".to_string(),
                "Arbitrum".to_string(),
                "Solana".to_string(),
            ],
            vec!["LP/DEX".to_string(), "Staking".to_string()],
            vec![
                "Compound".to_string(),
                "Uniswap".to_string(),
                "Curve".to_string(),
            ],
        )
    }

    pub fn get_position_count(&self, user: AccountId) -> u32 {
        self.user_position_ids
            .get(&user)
            .map(|ids| ids.len() as u32)
            .unwrap_or(0)
    }
}
