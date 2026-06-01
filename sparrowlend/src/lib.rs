#![cfg_attr(not(feature = "std"), no_std, no_main)]
#![allow(clippy::arithmetic_side_effects)]
#![allow(clippy::cast_possible_truncation)]

#[ink::contract]
mod sparrowlend {
    use ink::storage::Mapping;
    use scale::{Decode, Encode};

    const PRECISION: u128 = 1_000_000_000;

    #[derive(Encode, Decode, Clone)]
    #[cfg_attr(
        feature = "std",
        derive(scale_info::TypeInfo, ink::storage::traits::StorageLayout)
    )]
    pub struct FixedDeposit {
        pub principal:           Balance,
        pub guaranteed_rate_bps: u32,
        pub deposit_block:       u32,
        pub unlock_block:        u32,
        pub early_penalty_bps:   u32,
        pub is_active:           bool,
    }

    #[ink(storage)]
    pub struct Sparrowlend {
        fixed_pool_balance: Balance,
        pool_balance:   Balance,
        total_borrowed: Balance,
        total_shares:     Balance,
        reward_per_share: u128,
        reward_debt:      Mapping<AccountId, u128>,
        pending_yield:    Mapping<AccountId, Balance>,
        lender_shares:    Mapping<AccountId, Balance>,
        fixed_deposits: Mapping<AccountId, FixedDeposit>,
        protocol_reserve:    Balance,
        bad_debt:            Balance,
        accumulated_funding: Balance,
        admin:               AccountId,
        margin_contract:     Option<AccountId>,
        base_rate:           u32,
        rate_at_optimal:     u32,
        rate_at_max:         u32,
        optimal_utilization: u32,
        reserve_factor:      u32,
        early_penalty_bps:   u32,
        blocks_per_year: u128,
    }

    #[ink(event)] 
    pub struct Deposited {
        #[ink(topic)] 
        pub lender: AccountId,
        pub amount: Balance, 
        pub shares_minted: Balance,
    }
    
    #[ink(event)] 
    pub struct Withdrawn {
        #[ink(topic)] 
        pub lender: AccountId,
        pub shares_burned: Balance, 
        pub amount: Balance, 
        pub yield_harvested: Balance,
    }
    
    #[ink(event)] 
    pub struct YieldHarvested {
        #[ink(topic)] 
        pub lender: AccountId, 
        pub amount: Balance,
    }
    
    #[ink(event)] 
    pub struct FixedDeposited {
        #[ink(topic)] 
        pub lender: AccountId,
        pub amount: Balance, 
        pub guaranteed_rate_bps: u32, 
        pub unlock_block: u32,
    }
    
    #[ink(event)] 
    pub struct FixedWithdrawn {
        #[ink(topic)] 
        pub lender: AccountId,
        pub principal: Balance, 
        pub interest_earned: Balance, 
        pub penalty: Balance,
    }
    
    #[ink(event)] 
    pub struct FundingReceived {
        pub principal: Balance, 
        pub interest: Balance,
        pub lender_share: Balance, 
        pub protocol_share: Balance,
    }
    
    #[ink(event)] 
    pub struct BadDebtRecorded {
        pub amount: Balance, 
        pub covered_by_reserve: Balance,
    }
    
    #[ink(event)] 
    pub struct MarginContractSet { 
        pub margin: AccountId 
    }

    impl Sparrowlend {
        #[ink(constructor)]
        pub fn new() -> Self {
            Self {
                fixed_pool_balance: 0,
                pool_balance: 0,
                total_borrowed: 0,
                total_shares: 0,
                reward_per_share: 0,
                reward_debt: Mapping::default(),
                pending_yield: Mapping::default(),
                lender_shares: Mapping::default(),
                fixed_deposits: Mapping::default(),
                protocol_reserve: 0,
                bad_debt: 0,
                accumulated_funding: 0,
                admin: Self::env().caller(),
                margin_contract: None,
                base_rate: 200,
                rate_at_optimal: 800,
                rate_at_max: 3000,
                optimal_utilization: 80,
                reserve_factor: 10,
                early_penalty_bps: 1000,
                blocks_per_year: 2_628_000,
            }
        }
        
        // ── Admin ─────────────────────────────────────────────────────────────

        #[ink(message)]
        pub fn set_margin_contract(&mut self, margin: AccountId) {
            assert_eq!(self.env().caller(), self.admin, "Only admin");
            self.margin_contract = Some(margin);
            self.env().emit_event(MarginContractSet { margin });
        }

        #[ink(message)]
        pub fn set_early_penalty(&mut self, penalty_bps: u32) {
            assert_eq!(self.env().caller(), self.admin, "Only admin");
            assert!(penalty_bps <= 5000, "Max penalty 50%");
            self.early_penalty_bps = penalty_bps;
        }

        #[ink(message)]
        pub fn withdraw_reserve(&mut self) {
            assert_eq!(self.env().caller(), self.admin, "Only admin");
            let amount = self.protocol_reserve;
            assert!(amount > 0, "No reserve");
            self.protocol_reserve = 0;
            self.env().transfer(self.admin, amount).expect("Transfer failed");
        }

        // ── Variable Deposits ─────────────────────────────────────────────────

        #[ink(message, payable)]
        pub fn deposit(&mut self) {
            let caller = self.env().caller();
            let amount = self.env().transferred_value();
            assert!(amount > 0, "Must deposit > 0");

            self.settle_yield(caller);

            let shares  = self.amount_to_shares(amount);
            let current = self.lender_shares.get(caller).unwrap_or(0);
            self.lender_shares.insert(caller, &(current + shares));
            self.total_shares += shares;
            self.pool_balance += amount;

            let new_debt = (current + shares) as u128
                * self.reward_per_share / PRECISION;
            self.reward_debt.insert(caller, &new_debt);

            self.env().emit_event(Deposited {
                lender: caller, amount, shares_minted: shares,
            });
        }

        #[ink(message)]
        pub fn withdraw(&mut self, shares: Balance) {
            let caller = self.env().caller();
            let owned  = self.lender_shares.get(caller).unwrap_or(0);
            assert!(owned >= shares, "Insufficient shares");
            assert!(self.total_shares > 0, "No shares exist");

            self.settle_yield(caller);

            let amount = self.shares_to_amount(shares);
            assert!(self.pool_balance >= amount, "Insufficient liquidity");

            self.lender_shares.insert(caller, &(owned - shares));
            self.total_shares -= shares;
            self.pool_balance -= amount;

            let new_debt = (owned - shares) as u128
                * self.reward_per_share / PRECISION;
            self.reward_debt.insert(caller, &new_debt);

            let yield_amt = self.pending_yield.get(caller).unwrap_or(0);
            self.pending_yield.insert(caller, &0);

            assert!(
                self.pool_balance >= yield_amt || yield_amt == 0,
                "Yield temporarily unavailable"
            );
            self.pool_balance = self.pool_balance.saturating_sub(yield_amt);

            self.env().transfer(caller, amount + yield_amt)
                .expect("Transfer failed");

            self.env().emit_event(Withdrawn {
                lender: caller, shares_burned: shares,
                amount, yield_harvested: yield_amt,
            });
        }

        #[ink(message)]
        pub fn harvest_yield(&mut self) {
            let caller    = self.env().caller();
            self.settle_yield(caller);
            let yield_amt = self.pending_yield.get(caller).unwrap_or(0);
            assert!(yield_amt > 0, "No yield to harvest");
            self.pending_yield.insert(caller, &0);
            self.pool_balance = self.pool_balance.saturating_sub(yield_amt);
            self.env().transfer(caller, yield_amt).expect("Transfer failed");
            self.env().emit_event(YieldHarvested { lender: caller, amount: yield_amt });
        }

        // ── Fixed Deposits ────────────────────────────────────────────────────

        #[ink(message, payable)]
        pub fn deposit_fixed(&mut self, lock_blocks: u32) {
            let caller = self.env().caller();
            let amount = self.env().transferred_value();
            assert!(amount > 0, "Must deposit > 0");
            assert!(lock_blocks >= 200, "Min lock: 200 blocks");
            assert!(
                !self.fixed_deposits.get(caller)
                    .map(|d| d.is_active)
                    .unwrap_or(false),
                "Active fixed deposit exists"
            );

            let rate         = self.get_current_borrow_rate();
            let unlock_block = self.env().block_number() + lock_blocks;
            self.fixed_pool_balance += amount;

            self.fixed_deposits.insert(caller, &FixedDeposit {
                principal: amount,
                guaranteed_rate_bps: rate,
                deposit_block: self.env().block_number(),
                unlock_block,
                early_penalty_bps: self.early_penalty_bps,
                is_active: true,
            });

            self.env().emit_event(FixedDeposited {
                lender: caller, amount,
                guaranteed_rate_bps: rate, unlock_block,
            });
        }

        #[ink(message)]
        pub fn withdraw_fixed(&mut self) {
            let caller  = self.env().caller();
            let deposit = self.fixed_deposits.get(caller)
                .expect("No fixed deposit");
            assert!(deposit.is_active, "Already withdrawn");
        
            let current_block = self.env().block_number();
            let is_early      = current_block < deposit.unlock_block;
        
            let elapsed = current_block
                .min(deposit.unlock_block)
                .saturating_sub(deposit.deposit_block) as u128;
            let interest = deposit.principal
                * deposit.guaranteed_rate_bps as u128
                * elapsed
                / (10_000 * self.blocks_per_year);
        
            let (net_interest, penalty) = if is_early {
                let penalty_amt  = interest * deposit.early_penalty_bps as u128 / 10_000;
                self.protocol_reserve   += penalty_amt;
                self.fixed_pool_balance -= penalty_amt;
                (interest.saturating_sub(penalty_amt), penalty_amt)
            } else {
                (interest, 0)
            };
        
            // Principal comes from the ring-fenced fixed pool,
            // interest comes from pool_balance (funded by margin repayments).
            assert!(self.fixed_pool_balance >= deposit.principal, "Insufficient fixed liquidity");
            assert!(self.pool_balance >= net_interest, "Insufficient liquidity for interest");
        
            self.fixed_pool_balance -= deposit.principal;
            self.pool_balance        = self.pool_balance.saturating_sub(net_interest);
        
            let payout = deposit.principal + net_interest;
        
            let mut d   = deposit;
            d.is_active = false;
            self.fixed_deposits.insert(caller, &d);
        
            self.env().transfer(caller, payout).expect("Transfer failed");
        
            self.env().emit_event(FixedWithdrawn {
                lender:          caller,
                principal:       d.principal,
                interest_earned: net_interest,
                penalty,
            });
        }

        // ── Margin Contract Interface ─────────────────────────────────────────

        #[ink(message)]
        pub fn borrow_for(&mut self, amount: Balance) -> bool {
            self.assert_margin_caller();
            assert!(self.pool_balance >= amount, "Insufficient liquidity");
            self.pool_balance   -= amount;
            self.total_borrowed += amount;
            self.env().transfer(self.env().caller(), amount)
                .expect("Transfer failed");
            true
        }

        #[ink(message, payable)]
        pub fn repay_for(&mut self, principal: Balance) -> bool {
            self.assert_margin_caller();
            let paid     = self.env().transferred_value();
            assert!(paid >= principal, "Underpayment");

            let interest = paid.saturating_sub(principal);
            let (lender_share, protocol_share) = self.split_interest(interest);

            self.total_borrowed   = self.total_borrowed.saturating_sub(principal);
            self.protocol_reserve += protocol_share;
            self.pool_balance     += principal;
            self.accumulated_funding += interest;

            self.distribute_yield(lender_share);

            self.env().emit_event(FundingReceived {
                principal, interest, lender_share, protocol_share,
            });
            true
        }

        #[ink(message)]
        pub fn cover_bad_debt(&mut self, shortfall: Balance) -> bool {
            self.assert_margin_caller();
            assert!(shortfall > 0, "Shortfall must be > 0");

            let covered = shortfall.min(self.protocol_reserve);
            self.protocol_reserve = self.protocol_reserve.saturating_sub(covered);
            let uncovered = shortfall.saturating_sub(covered);
            self.bad_debt     += uncovered;
            self.total_borrowed = self.total_borrowed.saturating_sub(shortfall);

            self.env().emit_event(BadDebtRecorded {
                amount: shortfall, covered_by_reserve: covered,
            });
            true
        }

        // ── View Functions ────────────────────────────────────────────────────

        #[ink(message)]
        pub fn get_fixed_pool_balance(&self) -> Balance { self.fixed_pool_balance }

        #[ink(message)]
        pub fn get_current_borrow_rate(&self) -> u32 {
            let util = self.get_utilization_pct();
            let opt  = self.optimal_utilization as u128;
            if util == 0 { return self.base_rate; }
            if util <= opt {
                let slope = (self.rate_at_optimal - self.base_rate) as u128;
                (self.base_rate as u128 + slope * util / opt) as u32
            } else {
                let excess    = util - opt;
                let remaining = 100u128.saturating_sub(opt).max(1);
                let slope     = (self.rate_at_max - self.rate_at_optimal) as u128;
                (self.rate_at_optimal as u128 + slope * excess / remaining) as u32
            }
        }

        #[ink(message)]
        pub fn get_pool_stats(&self) -> (Balance, Balance, u32, u32, u32, u128) {
            let tvl         = self.pool_balance + self.total_borrowed;
            let util        = self.get_utilization_pct() as u32;
            let borrow_rate = self.get_current_borrow_rate();
            let supply_apy  = borrow_rate as u128
                * util as u128
                * (100 - self.reserve_factor as u128)
                / 10_000;
            (
                self.get_available_liquidity(),
                tvl, util, borrow_rate,
                supply_apy as u32,
                self.reward_per_share,
            )
        }

        #[ink(message)]
        pub fn get_lender_position(&self, lender: AccountId) -> (Balance, Balance, Balance) {
            let shares  = self.lender_shares.get(lender).unwrap_or(0);
            let pot_val = if self.total_shares == 0 { 0 }
                else { self.shares_to_amount(shares) };
            let pending = self.calc_pending_yield(lender);
            (shares, pot_val, pending)
        }

        #[ink(message)]
        pub fn get_fixed_deposit(&self, lender: AccountId)
            -> Option<(Balance, u32, u32, Balance, bool)>
        {
            self.fixed_deposits.get(lender).map(|d| {
                let elapsed = self.env().block_number()
                    .min(d.unlock_block)
                    .saturating_sub(d.deposit_block) as u128;
                let interest = d.principal
                    * d.guaranteed_rate_bps as u128
                    * elapsed
                    / (10_000 * self.blocks_per_year);
                (d.principal, d.guaranteed_rate_bps, d.unlock_block, interest, d.is_active)
            })
        }

        #[ink(message)]
        pub fn get_available_liquidity(&self) -> Balance {
            self.pool_balance.saturating_sub(self.protocol_reserve)
        }

        #[ink(message)]
        pub fn get_protocol_reserve(&self)    -> Balance { self.protocol_reserve }
        #[ink(message)]
        pub fn get_bad_debt(&self)            -> Balance { self.bad_debt }
        #[ink(message)]
        pub fn get_accumulated_funding(&self) -> Balance { self.accumulated_funding }

        // ── Internal ──────────────────────────────────────────────────────────

        fn distribute_yield(&mut self, lender_interest: Balance) {
            if lender_interest == 0 { return; }
            if self.total_shares == 0 {
                self.protocol_reserve += lender_interest;
                return;
            }
            let inc = lender_interest as u128 * PRECISION / self.total_shares as u128;
            self.reward_per_share += inc;
            self.pool_balance     += lender_interest;
        }

        fn settle_yield(&mut self, lender: AccountId) {
            let shares = self.lender_shares.get(lender).unwrap_or(0);
            if shares == 0 { return; }
            let pending = self.calc_pending_yield(lender);
            if pending > 0 {
                let cur = self.pending_yield.get(lender).unwrap_or(0);
                self.pending_yield.insert(lender, &(cur + pending));
            }
            let new_debt = shares as u128 * self.reward_per_share / PRECISION;
            self.reward_debt.insert(lender, &new_debt);
        }

        fn calc_pending_yield(&self, lender: AccountId) -> Balance {
            let shares = self.lender_shares.get(lender).unwrap_or(0);
            if shares == 0 { return 0; }
            let accrued = shares as u128 * self.reward_per_share / PRECISION;
            let debt    = self.reward_debt.get(lender).unwrap_or(0);
            accrued.saturating_sub(debt) as Balance
        }

        fn get_utilization_pct(&self) -> u128 {
            let total = self.pool_balance + self.total_borrowed;
            if total == 0 { return 0; }
            self.total_borrowed as u128 * 100 / total as u128
        }

        fn total_assets(&self) -> Balance {
            self.pool_balance + self.total_borrowed
        }

        fn amount_to_shares(&self, amount: Balance) -> Balance {
            let assets = self.total_assets();
            if self.total_shares == 0 || assets == 0 { amount }
            else { amount * self.total_shares / assets }
        }

        fn shares_to_amount(&self, shares: Balance) -> Balance {
            if self.total_shares == 0 { return 0; }
            shares * self.total_assets() / self.total_shares
        }

        fn split_interest(&self, interest: Balance) -> (Balance, Balance) {
            let proto = interest * self.reserve_factor as u128 / 100;
            (interest.saturating_sub(proto), proto)
        }

        fn assert_margin_caller(&self) {
            assert!(
                self.margin_contract == Some(self.env().caller()),
                "Not authorized margin contract"
            );
        }
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    #[cfg(test)]
    mod sparrowlend_tests {
        use super::*;

        fn alice() -> AccountId {
            ink::env::test::default_accounts::<ink::env::DefaultEnvironment>().alice
        }
        fn bob() -> AccountId {
            ink::env::test::default_accounts::<ink::env::DefaultEnvironment>().bob
        }
        fn charlie() -> AccountId {
            ink::env::test::default_accounts::<ink::env::DefaultEnvironment>().charlie
        }
        fn set_caller(a: AccountId) {
            ink::env::test::set_caller::<ink::env::DefaultEnvironment>(a);
        }
        fn set_value(v: Balance) {
            ink::env::test::set_value_transferred::<ink::env::DefaultEnvironment>(v);
        }
        fn set_block(n: u32) {
            ink::env::test::set_block_number::<ink::env::DefaultEnvironment>(n);
        }
        fn new_contract() -> Sparrowlend {
            set_caller(alice());
            Sparrowlend::new()
        }

        #[ink::test]
        fn test_initial_state() {
            let c = new_contract();
            assert_eq!(c.pool_balance, 0);
            assert_eq!(c.total_borrowed, 0);
            assert_eq!(c.total_shares, 0);
            assert_eq!(c.base_rate, 200);
            assert_eq!(c.reserve_factor, 10);
            assert_eq!(c.protocol_reserve, 0);
            assert_eq!(c.reward_per_share, 0);
            assert_eq!(c.bad_debt, 0);
            assert_eq!(c.accumulated_funding, 0);
        }

        #[ink::test]
        fn test_borrow_rate_at_zero_utilization() {
            let c = new_contract();
            assert_eq!(c.get_current_borrow_rate(), 200);
        }

        #[ink::test]
        fn test_borrow_rate_at_optimal_utilization() {
            let mut c = new_contract();
            c.pool_balance   = 20;
            c.total_borrowed = 80;
            assert_eq!(c.get_current_borrow_rate(), 800);
        }

        #[ink::test]
        fn test_borrow_rate_below_optimal() {
            let mut c = new_contract();
            c.pool_balance   = 60;
            c.total_borrowed = 40;
            let rate = c.get_current_borrow_rate();
            assert!(rate > 200 && rate < 800, "got {}", rate);
        }

        #[ink::test]
        fn test_borrow_rate_above_optimal() {
            let mut c = new_contract();
            c.pool_balance   = 10;
            c.total_borrowed = 90;
            let rate = c.get_current_borrow_rate();
            assert!(rate > 800 && rate <= 3000, "got {}", rate);
        }

        #[ink::test]
        fn test_borrow_rate_at_100_utilization() {
            let mut c = new_contract();
            c.pool_balance   = 0;
            c.total_borrowed = 100;
            assert_eq!(c.get_current_borrow_rate(), 3000);
        }

        #[ink::test]
        fn test_rate_monotonically_increasing() {
            let mut c = new_contract();
            let mut prev = 0u32;
            for util in [0u128, 20, 40, 60, 80, 90, 95, 100] {
                c.pool_balance   = 100 - util;
                c.total_borrowed = util;
                let rate = c.get_current_borrow_rate();
                assert!(rate >= prev, "util={}% rate={} prev={}", util, rate, prev);
                prev = rate;
            }
        }

        #[ink::test]
        fn test_deposit_mints_shares_1_to_1() {
            let mut c = new_contract();
            set_caller(alice());
            set_value(1000);
            c.deposit();
            assert_eq!(c.total_shares, 1000);
            assert_eq!(c.pool_balance, 1000);
            let (shares, val, _) = c.get_lender_position(alice());
            assert_eq!(shares, 1000);
            assert_eq!(val, 1000);
        }

        #[ink::test]
        fn test_second_deposit_proportional_shares() {
            let mut c = new_contract();
            set_caller(alice());
            set_value(1000);
            c.deposit();
            c.pool_balance += 1000; // simulate pool appreciation
            set_caller(bob());
            set_value(1000);
            c.deposit();
            let (bob_shares, _, _) = c.get_lender_position(bob());
            assert_eq!(bob_shares, 500);
        }

        #[ink::test]
        fn test_withdraw_returns_correct_amount() {
            let mut c = new_contract();
            set_caller(alice());
            set_value(1000);
            c.deposit();
            c.withdraw(1000);
            assert_eq!(c.total_shares, 0);
            assert_eq!(c.pool_balance, 0);
        }

        #[ink::test]
        #[should_panic(expected = "Insufficient shares")]
        fn test_withdraw_more_than_owned_panics() {
            let mut c = new_contract();
            set_caller(alice());
            set_value(500);
            c.deposit();
            c.withdraw(1000);
        }

        #[ink::test]
        fn test_reward_per_share_increases_on_distribute() {
            let mut c = new_contract();
            set_caller(alice());
            set_value(1000);
            c.deposit();
            let before = c.reward_per_share;
            c.distribute_yield(100);
            assert!(c.reward_per_share > before);
        }

        #[ink::test]
        fn test_two_lenders_split_yield_proportionally() {
            let mut c = new_contract();
            set_caller(alice());
            set_value(1000);
            c.deposit();
            set_caller(bob());
            set_value(1000);
            c.deposit();
            c.distribute_yield(200);
            let ap = c.calc_pending_yield(alice());
            let bp = c.calc_pending_yield(bob());
            assert_eq!(ap, bp);
            assert!(ap > 0);
        }

        #[ink::test]
        fn test_late_depositor_does_not_earn_past_yield() {
            let mut c = new_contract();
            set_caller(alice());
            set_value(1000);
            c.deposit();
            c.distribute_yield(500);
            set_caller(bob());
            set_value(1000);
            c.deposit();
            c.distribute_yield(200);
            assert!(c.calc_pending_yield(alice()) > c.calc_pending_yield(bob()));
        }

        #[ink::test]
        fn test_no_lenders_yield_goes_to_reserve() {
            let mut c = new_contract();
            c.distribute_yield(500);
            assert_eq!(c.protocol_reserve, 500);
        }

        #[ink::test]
        fn test_repay_for_distributes_yield_via_masterchef() {
            let mut c = new_contract();
            c.margin_contract = Some(alice());
            set_caller(alice());
            set_value(10_000);
            c.deposit();
            let rps_before = c.reward_per_share;
            set_value(1100); // 1000 principal + 100 interest
            c.repay_for(1000);
            assert!(c.reward_per_share > rps_before,
                "repay_for must increment reward_per_share");
        }

        #[ink::test]
        fn test_repay_for_tracks_accumulated_funding() {
            let mut c = new_contract();
            c.margin_contract = Some(alice());
            set_caller(alice());
            set_value(10_000);
            c.deposit();
            set_value(1100);
            c.repay_for(1000);
            assert_eq!(c.accumulated_funding, 100);
        }

        #[ink::test]
        fn test_interest_split_10_percent_reserve() {
            let c = new_contract();
            let (lender, protocol) = c.split_interest(1000);
            assert_eq!(protocol, 100);
            assert_eq!(lender, 900);
        }

        #[ink::test]
        fn test_interest_split_zero() {
            let c = new_contract();
            let (lender, protocol) = c.split_interest(0);
            assert_eq!(protocol, 0);
            assert_eq!(lender, 0);
        }

        #[ink::test]
        fn test_fixed_deposit_records_correct_state() {
            let mut c = new_contract();
            set_caller(alice());
            set_value(1000);
            set_block(0);
            c.deposit_fixed(500);
            let (principal, _rate, unlock, _interest, active) =
                c.get_fixed_deposit(alice()).unwrap();
            assert_eq!(principal, 1000);
            assert_eq!(unlock, 500);
            assert!(active);
        }

        #[ink::test]
        #[should_panic(expected = "Still locked")]
        fn test_fixed_withdraw_before_unlock_panics() {
            let mut c = new_contract();
            set_caller(alice());
            set_value(1000);
            set_block(0);
            c.deposit_fixed(500);
            set_block(200);
            c.withdraw_fixed();
        }

        #[ink::test]
        fn test_fixed_withdraw_at_maturity_succeeds() {
            let mut c = new_contract();
            set_caller(alice());
            set_value(1000);
            set_block(0);
            c.deposit_fixed(500);          
            c.pool_balance += 2000;       
            set_block(500);
            c.withdraw_fixed();
            let (_, _, _, _, active) = c.get_fixed_deposit(alice()).unwrap();
            assert!(!active);
        }

        #[ink::test]
        fn test_early_fixed_withdrawal_charges_penalty() {
            let mut c = new_contract();
            set_caller(alice());
            set_value(1000);
            set_block(0);
            c.deposit_fixed(1000);       
            c.pool_balance += 2000;       
            set_block(500);
            let reserve_before = c.protocol_reserve;
            c.withdraw_fixed();
            assert!(c.protocol_reserve >= reserve_before);
        }

        #[ink::test]
        #[should_panic(expected = "Min lock: 200 blocks")]
        fn test_fixed_deposit_min_lock_enforced() {
            let mut c = new_contract();
            set_caller(alice());
            set_value(1000);
            c.deposit_fixed(50);
        }

        #[ink::test]
        #[should_panic(expected = "Active fixed deposit exists")]
        fn test_cannot_open_two_fixed_deposits() {
            let mut c = new_contract();
            set_caller(alice());
            set_value(1000);
            c.deposit_fixed(500);
            set_value(500);
            c.deposit_fixed(500);
        }

        #[ink::test]
        fn test_pool_stats_empty() {
            let c = new_contract();
            let (avail, tvl, util, rate, apy, rps) = c.get_pool_stats();
            assert_eq!(avail, 0);
            assert_eq!(tvl, 0);
            assert_eq!(util, 0);
            assert_eq!(rate, 200);
            assert_eq!(apy, 0);
            assert_eq!(rps, 0);
        }

        #[ink::test]
        fn test_pool_stats_with_borrows() {
            let mut c = new_contract();
            c.pool_balance   = 20;
            c.total_borrowed = 80;
            let (_, tvl, util, rate, _, _) = c.get_pool_stats();
            assert_eq!(tvl, 100);
            assert_eq!(util, 80);
            assert_eq!(rate, 800);
        }

        #[ink::test]
        fn test_available_liquidity_excludes_reserve() {
            let mut c = new_contract();
            c.pool_balance     = 1000;
            c.protocol_reserve = 100;
            assert_eq!(c.get_available_liquidity(), 900);
        }

        #[ink::test]
        fn test_cover_bad_debt_uses_reserve_first() {
            let mut c = new_contract();
            c.margin_contract  = Some(alice());
            c.protocol_reserve = 500;
            c.total_borrowed   = 1000;
            set_caller(alice());
            c.cover_bad_debt(300);
            assert_eq!(c.protocol_reserve, 200);
            assert_eq!(c.bad_debt, 0);
        }

        #[ink::test]
        fn test_cover_bad_debt_records_uncovered_portion() {
            let mut c = new_contract();
            c.margin_contract  = Some(alice());
            c.protocol_reserve = 100;
            c.total_borrowed   = 1000;
            set_caller(alice());
            c.cover_bad_debt(500);
            assert_eq!(c.protocol_reserve, 0);
            assert_eq!(c.bad_debt, 400);
        }

        #[ink::test]
        #[should_panic(expected = "Only admin")]
        fn test_non_admin_cannot_set_margin_contract() {
            let mut c = new_contract();
            set_caller(bob());
            c.set_margin_contract(charlie());
        }

        #[ink::test]
        fn test_admin_sets_margin_contract() {
            let mut c = new_contract();
            set_caller(alice());
            c.set_margin_contract(bob());
            assert_eq!(c.margin_contract, Some(bob()));
        }

        #[ink::test]
        #[should_panic(expected = "Only admin")]
        fn test_non_admin_cannot_withdraw_reserve() {
            let mut c = new_contract();
            c.protocol_reserve = 100;
            set_caller(bob());
            c.withdraw_reserve();
        }
    }
}