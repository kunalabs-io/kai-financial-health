import {
  ClmmPool,
  type CoinInfo,
  type LiqudationBackendClient,
  type PhantomTypeArgument,
  Position,
  POSITION_CONFIG_INFOS,
  PositionConfig,
  type PositionConfigInfo,
  type StructClass,
  SUPPLY_POOL_INFOS,
  SupplyPool,
  type TypeArgument,
  USDC,
} from '@kunalabs-io/kai'
import { type SuiClient, type SuiObjectData } from '@mysten/sui/client'
import { fromBase64, normalizeStructTag } from '@mysten/sui/utils'
import Decimal from 'decimal.js'

const PRICES_API = 'https://prices.7k.ag'

interface TokenPrice {
  price: number | null
  lastUpdated: number
}

export async function fetchUsdPrice(coinType: string): Promise<Decimal> {
  if (coinType === USDC.typeName) {
    return new Decimal(1)
  }

  const response = await fetch(
    `${PRICES_API}/price?ids=${coinType}&vsCoin=${USDC.typeName}`
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch price: ${response.status}`)
  }

  const data = (await response.json()) as Record<string, TokenPrice | undefined>
  const tokenPrice = data[normalizeStructTag(coinType)]

  if (!tokenPrice?.price) {
    throw new Error(`Price not found for coin type: "${coinType}"`)
  }

  return new Decimal(tokenPrice.price)
}

/// Generic function for batched object fetching and deserialization.
async function getBatchedObjects<T>(
  suiClient: SuiClient,
  ids: string[],
  deserializer: (data: SuiObjectData) => T,
  batchSize = 50
): Promise<T[]> {
  const results: T[] = []

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize)
    const batchRes = await suiClient.multiGetObjects({
      ids: batch,
      options: {
        showBcs: true,
      },
    })

    for (const obj of batchRes) {
      if (!obj.data) {
        throw new Error(`No data found in response for ${ids[i]}`)
      }
      results.push(deserializer(obj.data))
    }
  }

  return results
}

export async function getAllPositions(
  suiClient: SuiClient,
  backendClient: LiqudationBackendClient
): Promise<Position<PhantomTypeArgument, PhantomTypeArgument, TypeArgument>[]> {
  const ids = await backendClient.getExistingPositions()

  return getBatchedObjects(suiClient, ids, data =>
    Position.fromSuiObjectData(data)
  )
}

export async function getAllPositionConfigs(
  suiClient: SuiClient
): Promise<
  PositionConfig<PhantomTypeArgument, PhantomTypeArgument, TypeArgument>[]
> {
  const ids = POSITION_CONFIG_INFOS.map(p => p.configId)

  return getBatchedObjects(suiClient, ids, data => {
    const config = PositionConfig.fromSuiObjectData(data)
    if (!config) {
      throw new Error(`No config found for ${data.objectId}`)
    }
    return config
  })
}

export async function getAllSupplyPools(
  suiClient: SuiClient
): Promise<SupplyPool<PhantomTypeArgument, PhantomTypeArgument>[]> {
  const ids = Object.values(SUPPLY_POOL_INFOS).map(p => p.id)

  return getBatchedObjects(suiClient, ids, data => {
    if (data.bcs?.dataType !== 'moveObject') {
      throw new Error(`SupplyPool data is not a move object`)
    }
    return SupplyPool.fromBcs(
      fromBase64(data.bcs.bcsBytes),
      data.bcs.type
    ) as SupplyPool<PhantomTypeArgument, PhantomTypeArgument>
  })
}

export async function getAllClmmPools(suiClient: SuiClient) {
  const poolInfosMap = POSITION_CONFIG_INFOS.reduce((map, c) => {
    if (!map.has(c.poolObjectId)) {
      map.set(c.poolObjectId, {
        poolId: c.poolObjectId,
        poolReified: c.poolReified,
        X: c.X,
        Y: c.Y,
      })
    }
    return map
  }, new Map()) as Map<
    string,
    {
      poolId: string
      poolReified: PositionConfigInfo<
        PhantomTypeArgument,
        PhantomTypeArgument,
        TypeArgument
      >['poolReified']
      X: CoinInfo<PhantomTypeArgument>
      Y: CoinInfo<PhantomTypeArgument>
    }
  >

  const poolIds = Array.from(poolInfosMap.keys())

  return getBatchedObjects(suiClient, poolIds, data => {
    const info = poolInfosMap.get(data.objectId)
    if (!info) {
      throw new Error(`Pool reified not found for ${data.objectId}`)
    }
    const poolData = info.poolReified.fromSuiObjectData(data)
    return new ClmmPool({
      reified: info.poolReified,
      X: info.X,
      Y: info.Y,
      data: poolData,
    })
  })
}

export function getPositionAssetAmounts(
  position: Position<PhantomTypeArgument, PhantomTypeArgument, TypeArgument>,
  allSupplyPools: SupplyPool<PhantomTypeArgument, PhantomTypeArgument>[],
  allClmmPools: ClmmPool<
    StructClass,
    never,
    PhantomTypeArgument,
    PhantomTypeArgument
  >[]
) {
  const supplyPoolX = allSupplyPools.find(
    s => s.id === position.configInfo.supplyPoolXInfo.id
  )
  const supplyPoolY = allSupplyPools.find(
    s => s.id === position.configInfo.supplyPoolYInfo.id
  )
  if (!supplyPoolX || !supplyPoolY) {
    throw new Error(`Supply pool not found for position ${position.id}`)
  }

  const pool = allClmmPools.find(p => p.id === position.configInfo.poolObjectId)
  if (!pool) {
    throw new Error(`Pool not found for position ${position.id}`)
  }

  const { x, y } = position.calcLpAmounts(pool.currentPrice())
  const { x: dx, y: dy } = position.calcDebtAmounts({
    supplyPoolX,
    supplyPoolY,
  })

  return {
    x,
    y,
    cx: position.colX,
    cy: position.colY,
    dx,
    dy,
  }
}
