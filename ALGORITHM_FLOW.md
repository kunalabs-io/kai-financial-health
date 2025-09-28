# Kai Finance Solvency Check Algorithm Flow

## Visual Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                KAI FINANCE SOLVENCY CHECK ALGORITHM             │
└─────────────────────────────────────────────────────────────────┘

Inputs
┌─────────────────────────────┐    ┌─────────────────────────────┐
│ KAI ENTITIES                │    │ PRICE DATA                  │
│ • SAVs (single‑asset)       │    │ • token → USD price         │
│ • Supply Pool Strategies    │    └─────────────────────────────┘
│ • Supply Pools              │
│ • LP Positions              │
└─────────────────────────────┘

Dependency graph (obligations flow)
┌──────────────┐    ┌──────────────┐    ┌───────────┐    ┌──────┐
│ LP Position  │ →  │ Supply Pool  │ →  │ Strategy  │ →  │ SAV  │
└──────────────┘    └──────────────┘    └───────────┘    └──────┘

┌───────────────────────────────────────────────────────────────┐
│                      PHASE 1: DIRECT MATCHING                 │
│                                                               │
│  For each Kai Finance entity:                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│  │ SAV holds   │    │ SAV owes    │    │   Result    │        │
│  │ 1000 USDC   │ ─→ │  800 USDC   │ ─→ │ 200 USDC    │        │
│  │  500 SUI    │    │  300 SUI    │    │ 200 SUI     │        │
│  └─────────────┘    └─────────────┘    │ (remaining) │        │
│                                        └─────────────┘        │
└───────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────┐
│                   PHASE 2: PRO-RATA DISTRIBUTION              │
│                                                               │
│  Remaining obligations: $500 (200 SUI) + $200 (USDC need)     │
│  Remaining assets: $700 (200 SUI) + $200 (USDC available)     │
│                                                               │
│  Since $700 > $500: ✅ Fully solvent                          │
│                                                               │
│  If $400 < $500: ❌ Would have shortfall                      │
│  Distribution: Pro-rata by USD value                          │
│  • SUI obligation: $500/$700 = 71.4% of remaining assets      │
│  • USDC obligation: $200/$700 = 28.6% of remaining assets     │
└───────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────┐
│                  PHASE 3: SHORTFALL PROPAGATION               │
│                                                               │
│           LP Position (owes $1000 USDC)                       │
│                    │ shortfall: $400                          │
│                    ▼                                          │
│           Supply Pool (expects $1000, gets $600)              │
│                    │ shortfall: $400                          │
│                    ▼                                          │
│           Strategy (expects $800, gets $400)                  │
│                    │ shortfall: $400                          │
│                    ▼                                          │
│           SAV (expects $600, gets $200)                       │
│                    │ shortfall: $400                          │
│                                                               │
│  Pro-rata distribution if multiple creditors:                 │
│  Strategy owes $600 to SAV-A, $400 to SAV-B                   │
│  $400 shortfall → SAV-A gets: $600/$1000 × $400 = $240        │
│                   SAV-B gets: $400/$1000 × $400 = $160        │
└───────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────┐
│                         RESULT COMPILATION                    │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                    SolvencyResult                       │  │
│  │                                                         │  │
│  │ isSolvent: false                                        │  │
│  │ insolventEntities: ["LP-Position-1", "Supply-Pool-1",   │  │
│  │                     "Strategy-1", "SAV-USDC"]           │  │
│  │                                                         │  │
│  │ details: [                                              │  │
│  │   {                                                     │  │
│  │     entityId: "LP-Position-1",                          │  │
│  │     entityType: "position",                             │  │
│  │     shortfallUsd: 400,                                  │  │
│  │     shortfallsByCoin: { "USDC": 400 },                  │  │
│  │     shortfallsCaused: [                                 │  │
│  │       { owesTo: "Supply-Pool-1", totalUsdValue: 400 }   │  │
│  │     ]                                                   │  │
│  │   },                                                    │  │
│  │   { ... Supply Pool details ... },                      │  │
│  │   { ... Strategy details ... },                         │  │
│  │   { ... SAV details ... }                               │  │
│  │ ]                                                       │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

## Kai Finance Entity Flow

```
┌───────────────────────────────────────────────────────────────┐
│                    KAI FINANCE ENTITY CHAIN                   │
│                                                               │
│  Users deposit funds into SAVs                                │
│           │                                                   │
│           ▼                                                   │
│  ┌─────────────────┐                                          │
│  │   SAVs          │  Single‑asset vaults (USDC, SUI, USDT)   │
│  │ (USDC, SUI,     │  Assets: Free balance                    │
│  │  USDT, etc.)    │  Obligations: Owe depositors             │
│  └─────────────────┘                                          │
│           │                                                   │
│           ▼                                                   │
│  ┌─────────────────┐                                          │
│  │   Strategies    │  Borrow from SAVs, invest in pools       │
│  │ (Supply Pool    │  Assets: Collected profits               │
│  │  Strategies)    │  Obligations: Repay SAVs                 │
│  └─────────────────┘                                          │
│           │                                                   │
│           ▼                                                   │
│  ┌─────────────────┐                                          │
│  │  Supply Pools   │  Provide liquidity to LP positions       │
│  │ (USDC, SUI,     │  Assets: Available balance               │
│  │  USDT, etc.)    │  Obligations: Provide returns            │
│  └─────────────────┘                                          │
│           │                                                   │
│           ▼                                                   │
│  ┌─────────────────┐                                          │
│  │  LP Positions   │  Borrow from pools to create leveraged   │
│  │ (Cetus, Turbos, │  LP on DEXes; assets: LP tokens +        │
│  │  DeepBook, etc.)│  collateral; obligations: repay pools    │
│  └─────────────────┘                                          │
└───────────────────────────────────────────────────────────────┘
```

## Key Algorithm Properties

### 1. **Kai Finance Specific**

- Models the actual Kai Finance protocol architecture
- Handles SAVs, strategies, supply pools, and LP positions
- Uses real Kai Finance token types and addresses

### 2. **Deterministic Processing**

- Uses DAG (Directed Acyclic Graph) validation
- Topological sorting ensures consistent results
- No dependency on processing order

### 3. **Mathematical Precision**

- Decimal.js prevents floating-point errors
- Handles Kai Finance token decimals correctly (SUI: 9, USDC: 6, USDT: 6)
- Preserves precision in complex calculations

### 4. **Fair Distribution**

- Pro-rata allocation based on obligation size
- Proportional shortfall distribution
- No preference to processing order

### 5. **Comprehensive Tracking**

- Tracks shortfalls by individual coin types
- Records causation chains (which entity caused what)
- Maintains audit trail for all transactions

## Real-World Example

```
Kai Finance System State:
├── SAV-USDC: Holds 1M USDC, owes 1M USDC to depositors
├── Strategy-USDC: Borrowed 800K USDC from SAV, owes 800K USDC
├── Supply-Pool-USDC: Holds 600K USDC, owes 600K USDC to strategy
└── LP-Position-1: Borrowed 500K USDC from pool, owes 500K USDC

If LP Position becomes underwater and can only repay 200K USDC:
1. Supply Pool receives 200K instead of 500K → 300K shortfall
2. Strategy receives 200K instead of 600K → 400K shortfall
3. SAV receives 200K instead of 800K → 600K shortfall
4. SAV can only pay 400K to depositors → 600K shortfall to users
```

This shows how a single LP position default can cascade through the entire Kai Finance system, affecting user deposits.
