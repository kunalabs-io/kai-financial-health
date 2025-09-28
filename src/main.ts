import { Command } from 'commander'
import {
  LiqudationBackendClient,
  getVaultDataBatch,
  VAULTS,
  type VaultInfo,
  type PhantomTypeArgument,
  SUPPLY_POOL_STRATEGY_INFOS,
  SUPPLY_POOL_INFOS,
  type SupplyPoolInfo,
} from '@kunalabs-io/kai'
import { SuiClient } from '@mysten/sui/client'
import { checkEntitySolvency, type Entity } from './ocg'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import {
  fetchUsdPrice,
  getAllClmmPools,
  getAllPositions,
  getAllSupplyPools,
  getPositionAssetAmounts,
} from './util'

const program = new Command()

interface RunServiceOptions {
  rpcUrl: string
  kaiApiUrl: string
  minSystemShortfall: number
  minEntityShortfall: number
}

program
  .requiredOption(
    '--rpc-url <string>',
    'Sui RPC URL',
    'https://fullnode.mainnet.sui.io:443'
  )
  .requiredOption(
    '--kai-api-url <string>',
    'Kai API URL',
    'https://api.kai.finance'
  )
  .option(
    '--min-system-shortfall <number>',
    'Minimum system shortfall (USD) before detailed analysis',
    parseInt,
    1000
  )
  .option(
    '--min-entity-shortfall <number>',
    'Minimum entity shortfall (USD) to display in results',
    parseInt,
    0
  )
  .action(async (options: RunServiceOptions) => {
    const liquidationBackendClient = new LiqudationBackendClient(
      options.kaiApiUrl
    )

    const suiClient = new SuiClient({
      url: options.rpcUrl,
    })

    const entities = new Map<string, Entity>()

    // SAV
    console.log('Loading SAVs...')
    const vaultNames = Object.keys(VAULTS)
    const vaultInfos = Object.values(VAULTS) as VaultInfo<
      PhantomTypeArgument,
      PhantomTypeArgument
    >[]
    const vaultDatas = await getVaultDataBatch(
      suiClient,
      vaultInfos.map(v => v.id)
    )

    for (const [vaultName, vaultInfo, vaultData] of vaultNames.map(
      (v, i) => [v, vaultInfos[i], vaultDatas[i]] as const
    )) {
      if (entities.has(vaultInfo.id)) {
        throw new Error(`Vault ${vaultInfo.id} already in entities`)
      }
      const savUsers: Entity = {
        id: `sav-users-${vaultInfo.id}`,
        type: 'sav-depositors',
        name: `${vaultName} SAV depositors`,
        holdings: [],
        obligations: [],
      }
      entities.set(savUsers.id, savUsers)

      const freeBalance = vaultData.freeBalance.value
      let liabilities = 0n
      for (const strategyState of vaultData.strategies.contents) {
        liabilities += strategyState.value.borrowed
      }

      const entity: Entity = {
        id: vaultInfo.id,
        type: 'sav',
        name: `${vaultName} SAV`,
        holdings: [
          {
            kind: 'coin',
            coin: vaultInfo.T,
            amount: freeBalance,
          },
        ],
        obligations: [
          {
            from: vaultInfo.id,
            to: savUsers.id,
            asset: {
              kind: 'coin',
              coin: vaultInfo.T,
              amount: freeBalance + liabilities,
            },
          },
        ],
      }
      entities.set(entity.id, entity)
    }

    // Supply pool strategies
    console.log('Loading supply pool strategies...')
    const supplyPoolStrategyDatas = (
      await suiClient.multiGetObjects({
        ids: Object.values(SUPPLY_POOL_STRATEGY_INFOS).map(s => s.id),
        options: {
          showContent: true,
        },
      })
    ).map(o => {
      if (o.data?.content?.dataType !== 'moveObject') {
        throw new Error(`Supply pool strategy data is not a move object`)
      }
      return o.data.content.fields as {
        id: { id: string }
        vault_access: {
          fields: { id: { id: string } }
        }
        shares: string
        collected_profit_t: string
      }
    })
    const supplyPoolStrategies = Object.entries(SUPPLY_POOL_STRATEGY_INFOS).map(
      ([name, info]) => {
        const data = supplyPoolStrategyDatas.find(s => s.id.id === info.id)
        if (!data) {
          throw new Error(`Supply pool strategy data not found for ${info.id}`)
        }
        return {
          id: info.id,
          name,
          info,
          data,
        }
      }
    )

    for (const strategy of supplyPoolStrategies) {
      if (entities.has(strategy.id)) {
        throw new Error(
          `Supply pool strategy ${strategy.id} already in entities`
        )
      }

      if (entities.has(strategy.id)) {
        throw new Error(
          `Supply pool strategy ${strategy.id} already in entities`
        )
      }
      const vaultData = vaultDatas.find(v => v.id === strategy.info.vault.id)
      if (!vaultData) {
        throw new Error(
          `Vault data not found for supply pool strategy ${strategy.id}`
        )
      }
      const vaultKey = normalizeSuiAddress(
        strategy.data.vault_access.fields.id.id
      )
      const vaultStrategyState = vaultData.strategies.contents.find(
        s => normalizeSuiAddress(s.key) === vaultKey
      )
      if (!vaultStrategyState) {
        throw new Error(
          `Vault strategy state not found for supply pool strategy ${strategy.id}`
        )
      }

      const entity: Entity = {
        id: strategy.id,
        type: 'supply-pool-strategy',
        name: `${strategy.name} supply pool strategy`,
        holdings: [
          {
            kind: 'coin',
            coin: strategy.info.T,
            amount: BigInt(strategy.data.collected_profit_t),
          },
        ],
        obligations: [
          {
            from: strategy.id,
            to: strategy.info.vault.id,
            asset: {
              kind: 'coin',
              coin: strategy.info.T,
              amount: BigInt(vaultStrategyState.value.borrowed),
            },
          },
        ],
      }
      entities.set(entity.id, entity)
    }

    const allCoinTypes = Array.from(
      new Set(
        Array.from(entities.values()).flatMap(e => [
          ...e.holdings.flatMap(h =>
            h.kind === 'coin'
              ? [h.coin.typeName]
              : [h.coinA.typeName, h.coinB.typeName]
          ),
          ...e.obligations.flatMap(o =>
            o.asset.kind === 'coin'
              ? [o.asset.coin.typeName]
              : [o.asset.coinA.typeName, o.asset.coinB.typeName]
          ),
        ])
      )
    )

    // Supply pools
    console.log('Loading supply pools...')
    const supplyPools = await getAllSupplyPools(suiClient)
    for (const supplyPool of supplyPools) {
      if (entities.has(supplyPool.id)) {
        throw new Error(`Supply pool ${supplyPool.id} already in entities`)
      }

      const [name, _] = Object.entries(SUPPLY_POOL_INFOS).find(
        s => s[1].id === supplyPool.id
      ) as [string, SupplyPoolInfo<PhantomTypeArgument, PhantomTypeArgument>]
      if (!name) {
        throw new Error(`Supply pool info not found for ${supplyPool.id}`)
      }

      const strategy = supplyPoolStrategies.find(
        s => s.info.ST.typeName === supplyPool.ST.typeName
      )
      if (!strategy) {
        throw new Error(
          `Supply pool strategy not found for supply pool ${supplyPool.id}`
        )
      }
      const stShares = BigInt(strategy.data.shares)
      const stSharesX64 = stShares * (1n << 64n)
      const registry = supplyPool.data.supplyEquity.registry
      const valueX64 =
        (registry.underlyingValueX64 * stSharesX64) / registry.supplyX64
      const value = valueX64 / (1n << 64n)

      const entity: Entity = {
        id: supplyPool.id,
        type: 'supply-pool',
        name: `${name} supply pool`,
        holdings: [
          {
            kind: 'coin',
            coin: supplyPool.T,
            amount: supplyPool.data.availableBalance.value,
          },
        ],
        obligations: [
          {
            from: supplyPool.id,
            to: strategy.id,
            asset: {
              kind: 'coin',
              coin: supplyPool.T,
              amount: value,
            },
          },
        ],
      }
      entities.set(entity.id, entity)
    }

    // Positions
    console.log('Loading LP positions...')
    const positions = await getAllPositions(suiClient, liquidationBackendClient)
    const clmmPools = await getAllClmmPools(suiClient)
    for (const position of positions) {
      if (entities.has(position.id)) {
        throw new Error(`Position ${position.id} already in entities`)
      }

      const amounts = getPositionAssetAmounts(position, supplyPools, clmmPools)

      const entity: Entity = {
        id: position.id,
        type: 'position',
        name: `Position ${position.configInfo.name}`,
        holdings: [
          {
            kind: 'lp',
            coinA: position.X,
            coinB: position.Y,
            amountA: amounts.x.int,
            amountB: amounts.y.int,
          },
          {
            kind: 'coin',
            coin: position.X,
            amount: amounts.cx.int,
          },
          {
            kind: 'coin',
            coin: position.Y,
            amount: amounts.cy.int,
          },
        ],
        obligations: [
          {
            from: position.id,
            to: position.configInfo.supplyPoolXInfo.id,
            asset: {
              kind: 'coin',
              coin: position.X,
              amount: amounts.dx.int,
            },
          },
          {
            from: position.id,
            to: position.configInfo.supplyPoolYInfo.id,
            asset: {
              kind: 'coin',
              coin: position.Y,
              amount: amounts.dy.int,
            },
          },
        ],
      }
      entities.set(entity.id, entity)
    }

    const usdPrices = await Promise.all(allCoinTypes.map(fetchUsdPrice))
    const priceMap = new Map(allCoinTypes.map((c, i) => [c, usdPrices[i]]))

    console.log('Checking solvency...')
    const solvencyResult = checkEntitySolvency(entities, priceMap)

    // Analyze shortfalls for SAVs and positions
    console.log('\n=== SHORTFALL ANALYSIS ===')

    // Calculate total system shortfall first
    const totalSystemShortfall = solvencyResult.details.reduce(
      (sum, detail) => sum + detail.shortfallUsd,
      0
    )

    // Analyze SAVs in shortfall
    console.log('\n--- SAVs in Shortfall ---')
    const savShortfalls = solvencyResult.details.filter(
      detail =>
        detail.entityType === 'sav' &&
        detail.shortfallsCaused.length > 0 &&
        detail.shortfallsCaused.reduce(
          (sum, shortfall) => sum + shortfall.totalUsdValue,
          0
        ) >= options.minEntityShortfall
    )

    if (savShortfalls.length === 0) {
      console.log('No SAVs in shortfall above threshold')
    } else {
      savShortfalls.forEach(detail => {
        const totalCaused = detail.shortfallsCaused.reduce(
          (sum, shortfall) => sum + shortfall.totalUsdValue,
          0
        )
        console.log(`\nSAV: ${detail.entityName} (${detail.entityId})`)
        console.log(`    Total shortfall USD: $${totalCaused.toFixed(2)}`)
      })
    }

    // Analyze Positions in shortfall
    console.log('\n--- Positions in Shortfall ---')
    const positionShortfalls = solvencyResult.details.filter(
      detail =>
        detail.entityType === 'position' &&
        detail.shortfallsCaused.length > 0 &&
        detail.shortfallsCaused.reduce(
          (sum, shortfall) => sum + shortfall.totalUsdValue,
          0
        ) >= options.minEntityShortfall
    )

    if (positionShortfalls.length === 0) {
      console.log('No Positions in shortfall above threshold')
    } else {
      positionShortfalls.forEach(detail => {
        const totalCaused = detail.shortfallsCaused.reduce(
          (sum, shortfall) => sum + shortfall.totalUsdValue,
          0
        )
        console.log(`\nPosition: ${detail.entityName} (${detail.entityId})`)
        console.log(`    Total shortfall USD: $${totalCaused.toFixed(2)}`)
      })
    }

    // Summary
    console.log('\n--- Summary ---')
    console.log(
      `Total entities in shortfall: ${solvencyResult.insolventEntities.length}`
    )
    console.log(`SAVs in shortfall above threshold: ${savShortfalls.length}`)
    console.log(
      `Positions in shortfall above threshold: ${positionShortfalls.length}`
    )
    console.log(
      `Total system shortfall USD: $${totalSystemShortfall.toFixed(2)}`
    )
    console.log(`Solvency threshold USD: $${options.minSystemShortfall}`)
    console.log()
    console.log(
      `Overall system solvent: ${totalSystemShortfall < options.minSystemShortfall ? 'YES' : 'NO'}`
    )
    console.log()
  })

program.parse(process.argv)
