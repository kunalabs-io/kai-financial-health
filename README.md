# Kai Financial Health Monitor

A solvency analysis tool for the Kai Finance protocol that checks the financial health of SAVs (single-asset vaults), supply pools, and LP positions.

## What it does

This tool analyzes whether Kai Finance entities can meet their financial obligations by:

1. **Loading all entities**: SAVs, supply pool strategies, supply pools, and LP positions
2. **Checking solvency**: Can each entity pay what it owes using available assets?
3. **Tracking shortfalls**: When entities can't pay, it tracks how shortfalls propagate through the system
4. **Reporting results**: Shows which entities are in shortfall and by how much

## Installation

```bash
pnpm install
pnpm build
```

## Usage

Run the solvency check:

```bash
node dist/main.js --min-entity-shortfall 1
```

### Options

- `--rpc-url`: Sui RPC URL (default: https://fullnode.mainnet.sui.io:443)
- `--kai-api-url`: Kai API URL (default: https://api.kai.finance)
- `--min-system-shortfall`: Minimum system shortfall threshold in USD (default: 1000)
- `--min-entity-shortfall`: Minimum entity shortfall to display in results (default: 0)

## Example Output

```
Loading SAVs...
Loading supply pool strategies...
Loading supply pools...
Loading LP positions...
Checking solvency...

=== SHORTFALL ANALYSIS ===

--- SAVs in Shortfall ---

SAV: wUSDT SAV (0x0fce8baed43faadf6831cd27e5b3a32a11d2a05b3cd1ed36c7c09c5f7bcb4ef4)
    Total shortfall USD: $156.18

SAV: DEEP SAV (0x6e58792dccbaa1d1d708d9a847a7c5b3f90c7878d1b76fd79afa48d31063bca6)
    Total shortfall USD: $58.70

--- Positions in Shortfall ---

Position: Position Cetus wUSDT/wUSDC (0x767200048971371106f7aebe187231315e54289e4b50044df51543432991463d)
    Total shortfall USD: $147.92

Position: Position Cetus USDC/wUSDT (0x82ac1657ecb974dc3925d85b9ab1830da792089571f5c8b2a8026d56d58c026a)
    Total shortfall USD: $8.26

Position: Position Cetus DEEP/SUI (0xe3dbce5f88da833d23f06ae472deab21dbcc456b1849f04594fb944feaf2c2d6)
    Total shortfall USD: $58.70

--- Summary ---
Total entities in shortfall: 5
SAVs in shortfall above threshold: 2
Positions in shortfall above threshold: 3
Total system shortfall USD: $214.88
Solvency threshold USD: $1000

Overall system solvent: YES
```

## How it works

The tool models Kai Finance as a network of entities with assets and obligations:

- **SAVs**: Single-asset vaults that hold user deposits and owe money back to depositors
- **Supply Pool Strategies**: Borrow from SAVs and invest in supply pools
- **Supply Pools**: Provide liquidity to LP positions and owe returns to strategies
- **LP Positions**: Borrow from supply pools to create leveraged LP positions on DEXs

When an entity can't meet its obligations, the shortfall propagates up the chain, potentially affecting other entities that depend on those payments.

## Key Features

- **Real-time data**: Fetches current state from Sui blockchain and Kai API
- **Shortfall propagation**: Tracks how insolvency cascades through the system
- **Configurable thresholds**: Set minimum shortfall amounts to focus on significant issues

## Documentation

- **[Detailed Solvency Check Documentation](./SOLVENCY_CHECK.md)**: Complete technical documentation
- **[Algorithm Flow Diagram](./ALGORITHM_FLOW.md)**: Visual overview of the algorithm phases
