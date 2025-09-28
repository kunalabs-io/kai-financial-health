# Kai Finance Solvency Check Documentation

## Overview

The Kai Finance solvency check analyzes the financial health of the protocol by examining whether SAVs (single-asset vaults), supply pool strategies, supply pools, and LP positions can meet their obligations. It tracks how shortfalls propagate through the system when entities cannot pay what they owe.

## Kai Finance Entity Types

### SAVs (Savings Accounts)

- **Purpose**: Single-asset vaults that hold user deposits and earn yield
- **Assets**: Free balance of the underlying token (e.g., USDC, SUI, USDT)
- **Obligations**: Owe depositors their principal + accrued interest
- **Risk**: If strategies fail, SAVs may not have enough assets to pay depositors

### Supply Pool Strategies

- **Purpose**: Borrow from SAVs and invest in supply pools
- **Assets**: Collected profits from supply pool investments
- **Obligations**: Must repay borrowed amounts to SAVs
- **Risk**: If supply pools underperform, strategies can't repay SAVs

### Supply Pools

- **Purpose**: Provide liquidity to LP positions and earn fees
- **Assets**: Available balance of the underlying token
- **Obligations**: Must provide returns to supply pool strategies
- **Risk**: If LP positions default, supply pools lose liquidity

### LP Positions

- **Purpose**: Borrow from supply pools to create leveraged LP positions on DEXs
- **Assets**: LP tokens + any uninvested collateral
- **Obligations**: Must repay borrowed amounts to supply pools
- **Risk**: If DEX prices move unfavorably, leveraged positions may become underwater

## Algorithm Overview

The solvency check operates in three phases:

### Phase 1: Direct Asset Matching

For each entity, match assets directly to obligations of the same coin type:

```
SAV holds 1000 USDC, owes 800 USDC to depositors
→ 200 USDC remaining, 0 USDC obligation
```

### Phase 2: Pro-Rata Asset Distribution

Use remaining assets to cover remaining obligations via swaps:

```
Entity has 200 USDC remaining, owes 100 SUI (worth $200)
→ Can swap USDC to SUI to fully cover obligation
```

### Phase 3: Shortfall Propagation

When entities can't meet obligations, shortfalls cascade up the chain:

```
LP Position defaults → Supply Pool loses liquidity → Strategy can't repay SAV → SAV can't pay depositors
```

## Usage Example

```typescript
import { checkEntitySolvency } from './src/ocg'
import { fetchUsdPrice } from './src/util'

// Build price map for all Kai Finance tokens
const priceMap = new Map<string, Decimal>()
priceMap.set(SUI.typeName, await fetchUsdPrice(SUI.typeName))
priceMap.set(USDC.typeName, await fetchUsdPrice(USDC.typeName))
priceMap.set(USDT.typeName, await fetchUsdPrice(USDT.typeName))

// Define Kai Finance entities
const entities = new Map<string, Entity>()
entities.set('sav-usdc', {
  id: 'sav-usdc',
  type: 'sav',
  name: 'USDC SAV',
  holdings: [
    { kind: 'coin', coin: USDC, amount: 1000000n }, // 1M USDC
  ],
  obligations: [
    {
      from: 'sav-usdc',
      to: 'sav-users-usdc',
      asset: { kind: 'coin', coin: USDC, amount: 1000000n },
    },
  ],
})

// Perform solvency check
const result = checkEntitySolvency(entities, priceMap)

// Analyze results
console.log('System is solvent:', result.isSolvent)
console.log('Insolvent entities:', result.insolventEntities)
```

## Shortfall Propagation Example

### Scenario

```
LP Position owes 1000 USDC to Supply Pool
Supply Pool owes 800 USDC to Strategy
Strategy owes 600 USDC to SAV
LP Position has only 400 USDC in assets
```

### Propagation Steps

1. **LP Position Analysis**: Has 600 USDC shortfall to Supply Pool
2. **Supply Pool Analysis**:
   - Receives 400 USDC from LP Position (instead of expected 1000 USDC)
   - Can only pay 400 USDC to Strategy (instead of 800 USDC)
   - Propagates 400 USDC shortfall to Strategy
3. **Strategy Analysis**:
   - Receives 400 USDC from Supply Pool (instead of expected 800 USDC)
   - Can only pay 400 USDC to SAV (instead of 600 USDC)
   - Propagates 200 USDC shortfall to SAV
4. **SAV Analysis**: Receives 200 USDC shortfall from Strategy

## Error Handling

### Cycle Detection

```typescript
// System throws error if dependency graph contains cycles
if (hasCycle(graph)) {
  throw new Error(
    'Dependency graph contains cycles. Shortfall propagation requires a DAG.'
  )
}
```

### Price Validation

```typescript
// Throws error if price data is missing
if (!priceMap.has(coinType)) {
  throw new Error(`Price not found for coin type: ${coinType}`)
}
```

## Running the Solvency Check

```bash
# Basic check
node dist/main.js

# With custom thresholds
node dist/main.js --min-system-shortfall 5000 --min-entity-shortfall 100

# With custom endpoints
node dist/main.js --rpc-url https://custom-sui-rpc.com --kai-api-url https://custom-kai-api.com
```

## Configuration Options

- `--rpc-url`: Sui RPC URL for blockchain data
- `--kai-api-url`: Kai API URL for price data
- `--min-system-shortfall`: Minimum system shortfall threshold in USD
- `--min-entity-shortfall`: Minimum entity shortfall to display in results

## Known Limitations

1. **Snapshot Analysis**: The analysis is based on current blockchain state and doesn't consider future obligations or dynamic market conditions.

2. **Price Accuracy**: Relies on external price feeds which may have delays or inaccuracies.

3. **Liquidation Assumptions**: Assumes LP positions can be liquidated at current market prices without slippage.
