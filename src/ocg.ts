import {
  Amount,
  type CoinInfo,
  type PhantomTypeArgument,
} from '@kunalabs-io/kai'
import Decimal from 'decimal.js'
import { DirectedGraph } from 'graphology'
import { hasCycle, topologicalSort } from 'graphology-dag'

export interface CoinAsset {
  kind: 'coin'
  coin: CoinInfo<PhantomTypeArgument>
  amount: bigint
}

export interface LPAsset {
  kind: 'lp'
  coinA: CoinInfo<PhantomTypeArgument>
  coinB: CoinInfo<PhantomTypeArgument>
  amountA: bigint
  amountB: bigint
}

export type Asset = CoinAsset | LPAsset

export interface Obligation {
  from: string // entity id (debtor)
  to: string // entity id (creditor)
  asset: Asset
}

export type EntityType =
  | 'sav-depositors'
  | 'sav'
  | 'supply-pool-strategy'
  | 'supply-pool'
  | 'position'
  | 'lp-user'

export interface Entity {
  id: string
  type: EntityType
  name: string
  holdings: Asset[]
  obligations: Obligation[]
}

export interface AssetBalance {
  coinType: string
  amount: number
}

/**
 * Detailed information about a specific shortfall in a particular coin type.
 */
export interface ShortfallDetail {
  /** The coin type of the shortfall (e.g., "0x2::sui::SUI") */
  coinType: string
  /** Amount in human-readable units (e.g., 10.5 SUI) */
  amount: number
  /** USD value of the shortfall */
  usdValue: number
  /** Entity ID that originally caused this shortfall */
  causedBy: string
}

/**
 * Represents shortfalls between two entities, aggregated by the creditor.
 */
export interface EntityShortfall {
  /** Entity ID this entity owes to */
  owesTo: string
  /** Detailed shortfalls by coin type */
  shortfalls: ShortfallDetail[]
  /** Total USD value of all shortfalls to this creditor */
  totalUsdValue: number
}

/**
 * Complete result of the solvency analysis across all entities.
 */
export interface SolvencyResult {
  /** Whether the overall system is solvent (no entities have shortfalls) */
  isSolvent: boolean
  /** List of entity IDs that are insolvent */
  insolventEntities: string[]
  /** Detailed analysis results for each entity */
  details: {
    /** Unique identifier for the entity */
    entityId: string
    /** Type of the entity */
    entityType: EntityType
    /** Human-readable name of the entity */
    entityName: string
    /** All assets available to the entity (holdings + incoming obligations) */
    totalAssets: AssetBalance[]
    /** All obligations the entity must fulfill */
    totalLiabilities: AssetBalance[]
    /** Total value of assets in USD */
    totalAssetsUsd: number
    /** Total value of liabilities in USD */
    totalLiabilitiesUsd: number
    /** Direct shortfall amount in USD (before considering propagated shortfalls) */
    shortfallUsd: number
    /** USD value of assets that were swapped to meet obligations */
    swapUsedUsd: number
    /** Assets that were used for swapped repayments */
    swappedRepayments: AssetBalance[]
    /** Shortfalls by coin type - tracks specific coin amounts that cannot be covered */
    shortfallsByCoin: Record<string, number>
    /** Shortfalls this entity received from entities that owe it money */
    shortfallsReceived: EntityShortfall[]
    /** Shortfalls this entity caused to entities it owes money to */
    shortfallsCaused: EntityShortfall[]
  }[]
}

interface ObligationDetail {
  to: string
  coinType: string
  amount: Amount
  usdValue: Decimal
}

interface EntitySolvencyData {
  entityId: string
  entityType: EntityType
  entityName: string
  totalAssets: AssetBalance[]
  totalLiabilities: AssetBalance[]
  totalAssetsUsd: number
  totalLiabilitiesUsd: number
  shortfallUsd: number
  swapUsedUsd: number
  swappedRepayments: AssetBalance[]
  shortfallsByCoin: Map<string, number>
  shortfallsReceived: EntityShortfall[]
  shortfallsCaused: EntityShortfall[]
}

function propagateShortfalls(
  entityData: Map<string, EntitySolvencyData>,
  entities: Map<string, Entity>,
  priceMap: Map<string, Decimal>
): void {
  // Build dependency graph using graphology
  const graph = new DirectedGraph()

  // Add all entity nodes
  for (const entity of entities.values()) {
    graph.addNode(entity.id)
  }

  // Add edges for obligations (debtor -> creditor)
  for (const entity of entities.values()) {
    for (const obligation of entity.obligations) {
      // Only add edge if both nodes exist and edge doesn't already exist
      if (graph.hasNode(entity.id) && graph.hasNode(obligation.to)) {
        if (!graph.hasEdge(entity.id, obligation.to)) {
          graph.addEdge(entity.id, obligation.to)
        }
      }
    }
  }

  // Check for cycles using graphology-dag
  if (hasCycle(graph)) {
    throw new Error(
      'Dependency graph contains cycles. Shortfall propagation requires a DAG (Directed Acyclic Graph). ' +
        'Please resolve circular dependencies between entities before proceeding.'
    )
  }

  // Get topological ordering using graphology-dag
  const processingOrder = topologicalSort(graph)

  // Process entities in topological order (creditors before debtors)
  for (const entityId of processingOrder) {
    propagateEntityShortfalls(entityId, entityData, entities, priceMap)
  }
}

function propagateEntityShortfalls(
  entityId: string,
  entityData: Map<string, EntitySolvencyData>,
  entities: Map<string, Entity>,
  priceMap: Map<string, Decimal>
): void {
  const entity = entities.get(entityId)
  const data = entityData.get(entityId)
  if (!entity || !data) return

  // Only propagate direct shortfalls - received shortfalls are already accounted for in the basic calculation
  const totalShortfallsByCoin = new Map<string, number>(data.shortfallsByCoin)

  if (totalShortfallsByCoin.size > 0) {
    // Group obligations by creditor and coin type
    const obligationsByCreditor = new Map<string, Map<string, number>>()

    for (const obligation of entity.obligations) {
      if (obligation.asset.kind === 'coin') {
        const creditorId = obligation.to
        const coinType = obligation.asset.coin.typeName
        const amount = obligation.asset.coin
          .newAmount(obligation.asset.amount)
          .toNumber()

        if (!obligationsByCreditor.has(creditorId)) {
          obligationsByCreditor.set(creditorId, new Map())
        }
        const creditorObligations = obligationsByCreditor.get(creditorId)
        if (creditorObligations) {
          creditorObligations.set(
            coinType,
            (creditorObligations.get(coinType) ?? 0) + amount
          )
        }
      } else {
        // Handle LP assets
        const creditorId = obligation.to
        const coinAType = obligation.asset.coinA.typeName
        const coinBType = obligation.asset.coinB.typeName
        const amountA = obligation.asset.coinA
          .newAmount(obligation.asset.amountA)
          .toNumber()
        const amountB = obligation.asset.coinB
          .newAmount(obligation.asset.amountB)
          .toNumber()

        if (!obligationsByCreditor.has(creditorId)) {
          obligationsByCreditor.set(creditorId, new Map())
        }
        const creditorObligations = obligationsByCreditor.get(creditorId)
        if (creditorObligations) {
          creditorObligations.set(
            coinAType,
            (creditorObligations.get(coinAType) ?? 0) + amountA
          )
          creditorObligations.set(
            coinBType,
            (creditorObligations.get(coinBType) ?? 0) + amountB
          )
        }
      }
    }

    // For each coin type with shortfall, distribute pro-rata to creditors
    for (const [coinType, shortfallAmount] of totalShortfallsByCoin) {
      const totalObligationsForCoin = Array.from(
        obligationsByCreditor.values()
      ).reduce((sum, creditorObs) => sum + (creditorObs.get(coinType) ?? 0), 0)

      if (totalObligationsForCoin > 0) {
        const price = priceMap.get(coinType)
        if (!price) continue
        const shortfallUsdValue = shortfallAmount * price.toNumber()

        for (const [creditorId, creditorObligations] of obligationsByCreditor) {
          const creditorObligationAmount =
            creditorObligations.get(coinType) ?? 0
          if (creditorObligationAmount > 0) {
            const proportion =
              creditorObligationAmount / totalObligationsForCoin
            const creditorShortfall = shortfallAmount * proportion
            const creditorShortfallUsd = shortfallUsdValue * proportion

            // Add to creditor's received shortfalls
            const creditorData = entityData.get(creditorId)
            if (!creditorData) continue
            const existingShortfall = creditorData.shortfallsReceived.find(
              s => s.owesTo === entityId
            )

            if (existingShortfall) {
              const existingDetail = existingShortfall.shortfalls.find(
                d => d.coinType === coinType
              )
              if (existingDetail) {
                existingDetail.amount += creditorShortfall
                existingDetail.usdValue += creditorShortfallUsd
              } else {
                existingShortfall.shortfalls.push({
                  coinType,
                  amount: creditorShortfall,
                  usdValue: creditorShortfallUsd,
                  causedBy: entityId,
                })
              }
              existingShortfall.totalUsdValue += creditorShortfallUsd
            } else {
              creditorData.shortfallsReceived.push({
                owesTo: entityId,
                shortfalls: [
                  {
                    coinType,
                    amount: creditorShortfall,
                    usdValue: creditorShortfallUsd,
                    causedBy: entityId,
                  },
                ],
                totalUsdValue: creditorShortfallUsd,
              })
            }

            // Add to this entity's caused shortfalls
            const existingCaused = data.shortfallsCaused.find(
              s => s.owesTo === creditorId
            )
            if (existingCaused) {
              const existingDetail = existingCaused.shortfalls.find(
                d => d.coinType === coinType
              )
              if (existingDetail) {
                existingDetail.amount += creditorShortfall
                existingDetail.usdValue += creditorShortfallUsd
              } else {
                existingCaused.shortfalls.push({
                  coinType,
                  amount: creditorShortfall,
                  usdValue: creditorShortfallUsd,
                  causedBy: entityId,
                })
              }
              existingCaused.totalUsdValue += creditorShortfallUsd
            } else {
              data.shortfallsCaused.push({
                owesTo: creditorId,
                shortfalls: [
                  {
                    coinType,
                    amount: creditorShortfall,
                    usdValue: creditorShortfallUsd,
                    causedBy: entityId,
                  },
                ],
                totalUsdValue: creditorShortfallUsd,
              })
            }

            // Update creditor's shortfalls by coin ONLY if the creditor has outgoing obligations
            // Entities with no outgoing obligations cannot be insolvent due to received shortfalls
            if (creditorData.totalLiabilities.length > 0) {
              const creditorCurrentShortfall =
                creditorData.shortfallsByCoin.get(coinType) ?? 0
              creditorData.shortfallsByCoin.set(
                coinType,
                creditorCurrentShortfall + creditorShortfall
              )
            }
          }
        }
      }
    }
  }
}

/**
 * Performs comprehensive solvency analysis across multiple interconnected entities.
 *
 * This function evaluates whether entities can meet their financial obligations using
 * available assets, tracks shortfalls, and propagates shortfalls through dependency
 * networks using a mathematically sound approach.
 *
 * ## Algorithm Overview:
 * 1. **Direct Asset Matching**: Match assets to obligations of the same coin type
 * 2. **Pro-Rata Distribution**: Distribute remaining assets proportionally across shortfalls
 * 3. **Shortfall Propagation**: Cascade shortfalls through the dependency graph using DAG topology
 * 4. **Detailed Tracking**: Record shortfalls by coin type and track causation chains
 *
 * ## Key Features:
 * - High-precision calculations using Decimal.js
 * - DAG validation to ensure deterministic results
 * - Pro-rata distribution for fair asset allocation
 * - Comprehensive shortfall tracking and attribution
 *
 * @param entities Map of entity ID to Entity data containing holdings and obligations
 * @param priceMap Map of coin type to USD price (as Decimal for precision)
 * @returns SolvencyResult containing overall system health and detailed per-entity analysis
 *
 * @throws Error if dependency graph contains cycles
 * @throws Error if price data is missing for any coin type
 *
 * @example
 * ```typescript
 * const entities = new Map()
 * entities.set('pool1', {
 *   id: 'pool1',
 *   holdings: [{ coin: SUI, amount: 1000n }],
 *   obligations: [{ to: 'user1', asset: { coin: SUI, amount: 500n } }]
 * })
 *
 * const priceMap = new Map()
 * priceMap.set(SUI.typeName, new Decimal(2.5))
 *
 * const result = checkEntitySolvency(entities, priceMap)
 * console.log('System solvent:', result.isSolvent)
 * ```
 */
export function checkEntitySolvency(
  entities: Map<string, Entity>,
  priceMap: Map<string, Decimal>
): SolvencyResult {
  const insolventEntities: string[] = []
  const entityData = new Map<string, EntitySolvencyData>()

  // First pass: calculate basic solvency for each entity
  for (const entity of entities.values()) {
    // Aggregate total assets by coin (holdings + incoming obligations)
    const totalAssets = new Map<string, Amount>()

    // Holdings
    for (const holding of entity.holdings) {
      if (holding.kind === 'coin') {
        const prev = totalAssets.get(holding.coin.typeName)?.int ?? 0n
        totalAssets.set(
          holding.coin.typeName,
          holding.coin.newAmount(prev + holding.amount)
        )
      } else {
        const prevA = totalAssets.get(holding.coinA.typeName)?.int ?? 0n
        const prevB = totalAssets.get(holding.coinB.typeName)?.int ?? 0n
        totalAssets.set(
          holding.coinA.typeName,
          holding.coinA.newAmount(prevA + holding.amountA)
        )
        totalAssets.set(
          holding.coinB.typeName,
          holding.coinB.newAmount(prevB + holding.amountB)
        )
      }
    }

    // Incoming obligations (others owing to this entity)
    for (const other of entities.values()) {
      for (const ob of other.obligations) {
        if (ob.to !== entity.id) continue
        if (ob.asset.kind === 'coin') {
          const prev = totalAssets.get(ob.asset.coin.typeName)?.int ?? 0n
          totalAssets.set(
            ob.asset.coin.typeName,
            ob.asset.coin.newAmount(prev + ob.asset.amount)
          )
        } else {
          const prevA = totalAssets.get(ob.asset.coinA.typeName)?.int ?? 0n
          const prevB = totalAssets.get(ob.asset.coinB.typeName)?.int ?? 0n
          totalAssets.set(
            ob.asset.coinA.typeName,
            ob.asset.coinA.newAmount(prevA + ob.asset.amountA)
          )
          totalAssets.set(
            ob.asset.coinB.typeName,
            ob.asset.coinB.newAmount(prevB + ob.asset.amountB)
          )
        }
      }
    }

    // Flatten outgoing obligations into per-coin lines with USD value
    const obligations: ObligationDetail[] = []
    for (const ob of entity.obligations) {
      if (ob.asset.kind === 'coin') {
        const price = priceMap.get(ob.asset.coin.typeName)
        if (!price) {
          throw new Error(
            `Price not found for coin type: "${ob.asset.coin.typeName}"`
          )
        }
        const amount = ob.asset.coin.newAmount(ob.asset.amount)
        obligations.push({
          to: ob.to,
          coinType: ob.asset.coin.typeName,
          amount,
          usdValue: new Decimal(amount.toNumber()).mul(price),
        })
      } else {
        const priceA = priceMap.get(ob.asset.coinA.typeName)
        const priceB = priceMap.get(ob.asset.coinB.typeName)
        if (!priceA || !priceB) {
          throw new Error('Price not found for LP asset coins')
        }
        const amountA = ob.asset.coinA.newAmount(ob.asset.amountA)
        const amountB = ob.asset.coinB.newAmount(ob.asset.amountB)
        obligations.push({
          to: ob.to,
          coinType: ob.asset.coinA.typeName,
          amount: amountA,
          usdValue: new Decimal(amountA.toNumber()).mul(priceA),
        })
        obligations.push({
          to: ob.to,
          coinType: ob.asset.coinB.typeName,
          amount: amountB,
          usdValue: new Decimal(amountB.toNumber()).mul(priceB),
        })
      }
    }

    // Totals in USD
    let totalAssetsUsd = new Decimal(0)
    let totalLiabilitiesUsd = new Decimal(0)

    for (const [coinType, amount] of totalAssets) {
      const price = priceMap.get(coinType)
      if (!price) {
        throw new Error(`Price not found for coin type: "${coinType}"`)
      }
      totalAssetsUsd = totalAssetsUsd.plus(amount.toDecimal().mul(price))
    }

    for (const ob of obligations) {
      totalLiabilitiesUsd = totalLiabilitiesUsd.plus(ob.usdValue)
    }

    // Step 1: Direct same-coin netting
    const remainingByCoin = new Map<string, bigint>()
    for (const [coinType, amount] of totalAssets) {
      remainingByCoin.set(coinType, amount.int)
    }
    let remainingLiabilitiesUsd = new Decimal(0)
    const shortfallUsdByCoin = new Map<string, Decimal>()

    // Group obligations by coin to avoid order dependence and cover pro‑rata within each coin
    const obligationsByCoin = obligations.reduce((acc, ob) => {
      const list = acc.get(ob.coinType)
      if (list) list.push(ob)
      else acc.set(ob.coinType, [ob])
      return acc
    }, new Map<string, ObligationDetail[]>())

    for (const [coinType, obs] of obligationsByCoin) {
      const available = remainingByCoin.get(coinType) ?? 0n
      const totalObInt = obs.reduce((sum, o) => sum + o.amount.int, 0n)

      if (available >= totalObInt) {
        const rest = available - totalObInt
        if (rest > 0n) remainingByCoin.set(coinType, rest)
        else remainingByCoin.delete(coinType)
      } else {
        // Not enough of this coin: compute uncovered USD once (order‑independent)
        const price = priceMap.get(coinType)
        if (!price) {
          throw new Error(`Price not found for coin type: "${coinType}"`)
        }
        const short = totalObInt - available
        // Convert shortfall from raw int to decimal-adjusted amount
        // Find the obligation to get the proper decimals
        const obligation = obligations.find(ob => ob.coinType === coinType)
        if (obligation) {
          const shortfallAmount = Amount.fromInt(
            short,
            obligation.amount.decimals
          )
          const usdShort = shortfallAmount.toDecimal().mul(price)
          remainingLiabilitiesUsd = remainingLiabilitiesUsd.plus(usdShort)
          shortfallUsdByCoin.set(coinType, usdShort)
        }
        remainingByCoin.delete(coinType)
      }
    }

    // Step 2: Use remaining assets to cover shortfalls via swaps
    let swapUsedUsd = new Decimal(0)
    const swappedRepaymentsList: AssetBalance[] = []

    if (remainingLiabilitiesUsd.gt(0) && remainingByCoin.size > 0) {
      // Calculate total USD value of remaining assets
      let remainingAssetsUsd = new Decimal(0)
      for (const [coinType, amount] of remainingByCoin) {
        const price = priceMap.get(coinType)
        if (!price) {
          throw new Error(`Price not found for coin type: "${coinType}"`)
        }
        // Convert raw int to decimal-adjusted amount
        // We need to find the coin info to get the proper decimals
        const assetAmount = totalAssets.get(coinType)
        if (assetAmount) {
          const amountObj = Amount.fromInt(amount, assetAmount.decimals)
          remainingAssetsUsd = remainingAssetsUsd.plus(
            new Decimal(amountObj.toNumber()).mul(price)
          )
        }
      }

      // Use as much as possible to cover shortfalls
      swapUsedUsd = Decimal.min(remainingAssetsUsd, remainingLiabilitiesUsd)

      if (swapUsedUsd.gt(0) && shortfallUsdByCoin.size > 0) {
        // Calculate total shortfall to determine proportions
        const totalShortfallUsd = Array.from(
          shortfallUsdByCoin.values()
        ).reduce((sum, shortfall) => sum.plus(shortfall), new Decimal(0))

        // Distribute swap USD proportionally across shortfall coins
        for (const [coinType, coinShortfallUsd] of shortfallUsdByCoin) {
          const proportion = coinShortfallUsd.div(totalShortfallUsd)
          const allocatedUsd = swapUsedUsd.mul(proportion)

          const price = priceMap.get(coinType)
          if (!price) {
            throw new Error(`Price not found for coin type: "${coinType}"`)
          }

          const repaidAmount = allocatedUsd.div(price).toNumber()
          swappedRepaymentsList.push({
            coinType,
            amount: repaidAmount,
          })
        }
      }

      // Reduce remaining liabilities by what we could cover
      remainingLiabilitiesUsd = remainingLiabilitiesUsd.minus(swapUsedUsd)
    }

    // Calculate final shortfall: remaining liabilities after all swaps
    const finalShortfallUsd = Decimal.max(remainingLiabilitiesUsd, 0)
    const isEntitySolvent = finalShortfallUsd.lte(0)
    if (!isEntitySolvent) insolventEntities.push(entity.id)

    // Build details
    const totalAssetsList: AssetBalance[] = Array.from(
      totalAssets.entries()
    ).map(([coinType, amount]) => ({ coinType, amount: amount.toNumber() }))

    const totalLiabilitiesList: AssetBalance[] = Array.from(
      obligations
        .reduce((acc, ob) => {
          const ex = acc.get(ob.coinType)
          if (ex)
            acc.set(ob.coinType, {
              coinType: ob.coinType,
              amount: ex.amount + ob.amount.toNumber(),
            })
          else
            acc.set(ob.coinType, {
              coinType: ob.coinType,
              amount: ob.amount.toNumber(),
            })
          return acc
        }, new Map<string, AssetBalance>())
        .values()
    )

    // Create shortfalls by coin map from the final remaining shortfalls after swaps
    const shortfallsByCoinMap = new Map<string, number>()

    // Only include shortfalls that remain after swaps
    if (finalShortfallUsd.gt(0) && shortfallUsdByCoin.size > 0) {
      // Calculate total shortfall to determine proportions
      const totalShortfallUsd = Array.from(shortfallUsdByCoin.values()).reduce(
        (sum, shortfall) => sum.plus(shortfall),
        new Decimal(0)
      )

      // Distribute remaining shortfall proportionally across coin types
      for (const [coinType, coinShortfallUsd] of shortfallUsdByCoin) {
        const proportion = coinShortfallUsd.div(totalShortfallUsd)
        const remainingShortfallUsd = finalShortfallUsd.mul(proportion)

        const price = priceMap.get(coinType)
        if (price) {
          const remainingShortfallAmount = remainingShortfallUsd
            .div(price)
            .toNumber()
          if (remainingShortfallAmount > 0) {
            shortfallsByCoinMap.set(coinType, remainingShortfallAmount)
          }
        }
      }
    }

    // Store entity data for shortfall propagation
    entityData.set(entity.id, {
      entityId: entity.id,
      entityType: entity.type,
      entityName: entity.name,
      totalAssets: totalAssetsList,
      totalLiabilities: totalLiabilitiesList,
      totalAssetsUsd: totalAssetsUsd.toNumber(),
      totalLiabilitiesUsd: totalLiabilitiesUsd.toNumber(),
      shortfallUsd: finalShortfallUsd.toNumber(),
      swapUsedUsd: swapUsedUsd.toNumber(),
      swappedRepayments: swappedRepaymentsList,
      shortfallsByCoin: shortfallsByCoinMap,
      shortfallsReceived: [],
      shortfallsCaused: [],
    })

    if (!isEntitySolvent) insolventEntities.push(entity.id)
  }

  // Second pass: propagate shortfalls up the dependency graph
  propagateShortfalls(entityData, entities, priceMap)

  // Third pass: recalculate insolvency after shortfall propagation
  const finalInsolventEntities: string[] = []
  for (const data of entityData.values()) {
    // An entity is insolvent ONLY if it has direct shortfalls (can't meet its own obligations)
    // OR if it has outgoing obligations and has received shortfalls that prevent it from paying
    const hasDirectShortfall =
      data.shortfallsByCoin.size > 0 || data.shortfallUsd > 0
    const hasOutgoingObligations = data.totalLiabilities.length > 0
    const hasReceivedShortfalls = data.shortfallsReceived.length > 0

    // Only insolvent if:
    // 1. Has direct shortfall (classic insolvency), OR
    // 2. Has outgoing obligations AND received shortfalls (can't pay due to not receiving expected payments)
    if (
      hasDirectShortfall ||
      (hasOutgoingObligations && hasReceivedShortfalls)
    ) {
      finalInsolventEntities.push(data.entityId)
    }
  }

  // Convert to final result format
  const details: SolvencyResult['details'] = Array.from(
    entityData.values()
  ).map(data => ({
    entityId: data.entityId,
    entityType: data.entityType,
    entityName: data.entityName,
    totalAssets: data.totalAssets,
    totalLiabilities: data.totalLiabilities,
    totalAssetsUsd: data.totalAssetsUsd,
    totalLiabilitiesUsd: data.totalLiabilitiesUsd,
    shortfallUsd: data.shortfallUsd,
    swapUsedUsd: data.swapUsedUsd,
    swappedRepayments: data.swappedRepayments,
    shortfallsByCoin: Object.fromEntries(data.shortfallsByCoin),
    shortfallsReceived: data.shortfallsReceived,
    shortfallsCaused: data.shortfallsCaused,
  }))

  return {
    isSolvent: finalInsolventEntities.length === 0,
    insolventEntities: finalInsolventEntities,
    details,
  }
}
