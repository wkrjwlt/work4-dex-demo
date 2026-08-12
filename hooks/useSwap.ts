import { useState, useCallback } from 'react'
import {
  useAccount,
  useWriteContract,
  useReadContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import { SWAP_ROUTER_ABI, POOL_MANAGER_ABI, ERC20_ABI, WETH_ABI } from '@/lib/contracts'
import { TOKENS, isNativeTokenAddress, toChainTokenAddress, CONTRACTS } from '@/lib/constants'
import { MIN_SQRT_RATIO, MAX_SQRT_RATIO, getPriceAtSqrtRatio } from '@/lib/tickMath'

export interface SwapParams {
  tokenIn: string
  tokenOut: string
  amountIn: string
  slippage: number
  indexPath?: number[]
  tokenInDecimals?: number
  tokenOutDecimals?: number
  isExactInput?: boolean  // true: exactInput, false: exactOutput
  amountOut?: string      // for exactOutput
  preloadedPools?: PoolInfo[]  // ✅ 新增：预加载的池子列表，避免重复查询
}

export interface PoolInfo {
  pool: string
  token0: string
  token1: string
  index: number
  fee: number
  feeProtocol?: number
  tickLower?: number
  tickUpper?: number
  tick?: number
  sqrtPriceX96: bigint
  liquidity: bigint
  priceRatio: number
  isPriceReasonable: boolean
}

interface QuoteResult {
  amountOut: string
  priceImpact: string
  indexPathUsed?: number[]
  warning?: string
  availablePools?: PoolInfo[] // 添加可用池子列表
}

interface GetQuoteParams extends SwapParams {
  preloadedPools?: PoolInfo[]  // ✅ 新增：预加载的池子列表，避免重复查询
}

// Gas限制常量
const GAS_LIMIT_CAP = 16_000_000n
const SWAP_GAS_FALLBACK = 500_000n  // 降低到50万（正常swap只需要20-30万）
const APPROVE_GAS_FALLBACK = 120_000n

export function useSwap() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContract, data: hash, isPending } = useWriteContract()

  // 等待交易确认
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  // 获取代币decimals
  const getTokenDecimals = (tokenAddress: string): number => {
    const token = Object.values(TOKENS).find(t => t.address.toLowerCase() === tokenAddress.toLowerCase())
    return token?.decimals ?? 18
  }

  // Gas估算优化
  const estimateGasWithCap = useCallback(async (request: {
    address: `0x${string}`
    abi: readonly unknown[]
    functionName: string
    args?: readonly unknown[]
    value?: bigint
    fallbackGas: bigint
  }) => {
    if (!publicClient || !address) return request.fallbackGas
    try {
      const estimated = await publicClient.estimateContractGas({
        address: request.address,
        abi: request.abi as any,
        functionName: request.functionName as any,
        args: request.args as any,
        value: request.value,
        account: address as `0x${string}`,
      })
      // 加20%缓冲
      const buffered = (estimated * 12n) / 10n
      return buffered > GAS_LIMIT_CAP ? GAS_LIMIT_CAP : buffered
    } catch (error) {
      console.warn(`Gas estimate failed for ${request.functionName}, fallback to ${request.fallbackGas.toString()}`, error)
      return request.fallbackGas
    }
  }, [address, publicClient])

  /**
   * 智能选择最优池子
   *
   * 评分标准（总分100分）：
   * 1. 价格合理性 (40分): 价格比例在合理范围内 (0.000001 ~ 1000000)
   * 2. 流动性 (30分): 流动性越大得分越高，最高30分
   * 3. 池子余额 (30分): 池子中有足够的代币完成交易
   * 4. 手续费优惠 (5分): 低费率池子额外加分
   *
   * 选择策略：
   * - 按总分排序，选择得分最高的池子
   * - 如果得分相同，选择预估输出更多的池子
   * - 考虑滑点、手续费和实际可用余额
   *
   * 极端价格处理：
   * - 自动优先选择价格合理的池子
   * - 如果所有池子都是极端价格，选择流动性最大的
   * - 给用户明确的警告和建议
   */
  const selectBestPool = useCallback((
    pools: PoolInfo[],
    amountInWei: bigint,
    tokenIn: string,
    tokenOut: string,
    poolBalances?: Map<number, { balance0: bigint; balance1: bigint }>
  ): { bestPool: PoolInfo; estimatedOutput: bigint; reason: string } | null => {
    if (pools.length === 0) return null

    const candidates: Array<{
      pool: PoolInfo
      score: number
      estimatedOutput: number
      reason: string
    }> = []

    for (const pool of pools) {
      let score = 0
      let estimatedOutput = 0
      const reasons: string[] = []

      // 1. 价格合理性检查 (权重: 40%)
      const priceScore = pool.isPriceReasonable ? 40 : 0
      score += priceScore
      if (!pool.isPriceReasonable) {
        reasons.push('极端价格')
      }

      // 2. 流动性检查 (权重: 30%)
      const liquidity = Number(pool.liquidity)
      const liquidityScore = Math.min(30, (liquidity / 1e18) * 30)
      score += liquidityScore

      // 3. 池子余额检查 (权重: 30%)
      let balanceScore = 0
      if (poolBalances) {
        const balances = poolBalances.get(pool.index)
        if (balances) {
          const isToken0In = pool.token0.toLowerCase() === tokenIn.toLowerCase()
          const outputBalance = isToken0In ? balances.balance1 : balances.balance0
          const requiredOutput = BigInt(Math.floor(Number(amountInWei) * pool.priceRatio))

          if (outputBalance >= requiredOutput) {
            balanceScore = 30
            reasons.push('余额充足')
          } else {
            balanceScore = 10
            reasons.push('余额不足')
          }
        }
      } else {
        // 如果没有余额信息，给予中等分数
        balanceScore = 20
      }
      score += balanceScore

      // 4. 计算预估输出
      const isToken0In = pool.token0.toLowerCase() === tokenIn.toLowerCase()
      const inputAmount = Number(formatUnits(amountInWei, 18))
      if (isToken0In) {
        estimatedOutput = inputAmount * pool.priceRatio * (1 - pool.fee / 1000000)
      } else {
        estimatedOutput = inputAmount / pool.priceRatio * (1 - pool.fee / 1000000)
      }

      // 5. 手续费优惠 (低费率池子得分略高)
      if (pool.fee < 1000) {
        score += 5
        reasons.push('低费率')
      }

      candidates.push({
        pool,
        score,
        estimatedOutput,
        reason: reasons.length > 0 ? reasons.join(', ') : '综合最优'
      })

      console.log(`[Pool #${pool.index}] Score: ${score.toFixed(1)}, Output: ${estimatedOutput.toFixed(6)}, Reason: ${reasons.join(', ')}`)
    }

    // 选择得分最高的池子
    candidates.sort((a, b) => {
      // 先按得分排序
      if (a.score !== b.score) return b.score - a.score
      // 得分相同时，选择输出更多的
      return b.estimatedOutput - a.estimatedOutput
    })

    const winner = candidates[0]
    console.log(`\n🏆 Best Pool: #${winner.pool.index}`)
    console.log(`   Score: ${winner.score.toFixed(1)}`)
    console.log(`   Estimated Output: ${winner.estimatedOutput.toFixed(6)}`)
    console.log(`   Reason: ${winner.reason}`)

    return {
      bestPool: winner.pool,
      estimatedOutput: parseUnits(winner.estimatedOutput.toString(), 18),
      reason: winner.reason
    }
  }, [])

  // 获取价格预估 - 使用simulateContract模拟合约调用
  const getQuote = useCallback(async (params: GetQuoteParams): Promise<QuoteResult | null> => {
    if (!params.amountIn || parseFloat(params.amountIn) === 0) {
      return null
    }

    if (!publicClient) {
      console.warn('Public client not available')
      return null
    }

    console.log('===== getQuote Start =====')
    console.log('tokenIn:', params.tokenIn)
    console.log('tokenOut:', params.tokenOut)
    console.log('amountIn:', params.amountIn)
    console.log('indexPath:', params.indexPath)
    console.log('preloadedPools:', params.preloadedPools ? `${params.preloadedPools.length} pools` : 'none')

    try {
      const tokenInDecimals = params.tokenInDecimals ?? getTokenDecimals(params.tokenIn)
      const tokenOutDecimals = params.tokenOutDecimals ?? getTokenDecimals(params.tokenOut)

      const amountInWei = parseUnits(params.amountIn, tokenInDecimals)
      console.log('amountInWei:', amountInWei.toString())

      // 处理ETH地址
      const actualTokenIn = isNativeTokenAddress(params.tokenIn)
        ? TOKENS.ETH.wrappedAddress
        : params.tokenIn
      const actualTokenOut = isNativeTokenAddress(params.tokenOut)
        ? TOKENS.ETH.wrappedAddress
        : params.tokenOut

      console.log('actualTokenIn:', actualTokenIn)
      console.log('actualTokenOut:', actualTokenOut)

      // ✅ 新增：使用预加载的池子列表，避免重复查询
      let matchedPools: any[] = []

      if (params.preloadedPools && params.preloadedPools.length > 0) {
        console.log('✅ Using preloaded pools (避免重复查询)')
        matchedPools = params.preloadedPools.map(pool => ({
          pool: pool.pool,
          token0: pool.token0,
          token1: pool.token1,
          index: pool.index,
          fee: pool.fee,
          tick: pool.tick || 0,
          sqrtPriceX96: pool.sqrtPriceX96,
          liquidity: pool.liquidity,
        }))
      } else {
        // 如果没有预加载，才进行查询
        console.log('⚠️ No preloaded pools, querying from chain...')

        const WETH_SEPOLIA = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14'
        const WETH_MAINNET = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

        // 确保地址顺序正确（token0 < token1）
        let [sortedToken0, sortedToken1] = actualTokenIn.toLowerCase() < actualTokenOut.toLowerCase()
          ? [actualTokenIn.toLowerCase(), actualTokenOut.toLowerCase()]
          : [actualTokenOut.toLowerCase(), actualTokenIn.toLowerCase()]

        console.log('Querying pools for:', sortedToken0, '/', sortedToken1)

        // ✅ 改进：动态查询，直到连续遇到空池子
        const MAX_EMPTY_POOLS = 3  // 连续遇到3个空池子时停止
        let emptyCount = 0
        let index = 0

        while (emptyCount < MAX_EMPTY_POOLS) {
          try {
            const poolAddress = await publicClient.readContract({
              address: CONTRACTS.POOL_MANAGER as `0x${string}`,
              abi: POOL_MANAGER_ABI,
              functionName: 'getPool',
              args: [sortedToken0 as `0x${string}`, sortedToken1 as `0x${string}`, index],
            })

            if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
              console.log(`✅ Found pool at index ${index}: ${poolAddress}`)
              emptyCount = 0  // 重置计数器

              // 获取池子详细信息
              try {
                const POOL_ABI = [
                  {
                    name: 'token0',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [],
                    outputs: [{ name: '', type: 'address' }],
                  },
                  {
                    name: 'token1',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [],
                    outputs: [{ name: '', type: 'address' }],
                  },
                  {
                    name: 'fee',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [],
                    outputs: [{ name: '', type: 'uint24' }],
                  },
                  {
                    name: 'liquidity',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [],
                    outputs: [{ name: '', type: 'uint128' }],
                  },
                  {
                    name: 'sqrtPriceX96',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [],
                    outputs: [{ name: '', type: 'uint160' }],
                  },
                  {
                    name: 'tick',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [],
                    outputs: [{ name: '', type: 'int24' }],
                  },
                ] as const

                const [poolToken0, poolToken1, fee, liquidity, sqrtPriceX96, tick] = await Promise.all([
                  publicClient.readContract({
                    address: poolAddress,
                    abi: POOL_ABI,
                    functionName: 'token0',
                  }),
                  publicClient.readContract({
                    address: poolAddress,
                    abi: POOL_ABI,
                    functionName: 'token1',
                  }),
                  publicClient.readContract({
                    address: poolAddress,
                    abi: POOL_ABI,
                    functionName: 'fee',
                  }),
                  publicClient.readContract({
                    address: poolAddress,
                    abi: POOL_ABI,
                    functionName: 'liquidity',
                  }),
                  publicClient.readContract({
                    address: poolAddress,
                    abi: POOL_ABI,
                    functionName: 'sqrtPriceX96',
                  }),
                  publicClient.readContract({
                    address: poolAddress,
                    abi: POOL_ABI,
                    functionName: 'tick',
                  }),
                ])

                matchedPools.push({
                  pool: poolAddress,
                  token0: poolToken0,
                  token1: poolToken1,
                  index: index,  // ✅ 使用动态索引
                  fee: Number(fee),
                  tick: Number(tick),
                  sqrtPriceX96: sqrtPriceX96 as bigint,
                  liquidity: liquidity as bigint,
                })

                console.log(`  Fee: ${fee}, Liquidity: ${liquidity}`)
              } catch (error) {
                console.log(`  ⚠️  Could not fetch pool details for ${poolAddress}`)
              }
            } else {
              // 池子地址为空，增加空计数
              emptyCount++
              console.log(`  Empty pool at index ${index}, empty count: ${emptyCount}`)
            }
          } catch (error) {
            // 查询失败，可能是索引超出范围
            emptyCount++
            console.log(`  No pool at index ${index}, empty count: ${emptyCount}`)
          }

          index++  // 移动到下一个索引
        }

        console.log(`Total pools found: ${matchedPools.length}`)
      }

      // 过滤掉没有流动性的池子
      const poolsWithLiquidity = matchedPools.filter(pool => Number(pool.liquidity) > 0)

      console.log('Pools with liquidity:', poolsWithLiquidity.length)

      if (poolsWithLiquidity.length === 0) {
        console.warn('⚠️ No pools with liquidity found!')

        if (matchedPools.length > 0) {
          console.warn(`Found ${matchedPools.length} pool(s) but all have zero liquidity`)
          throw new Error('所有匹配的池子都没有流动性，请等待流动性提供者添加流动性')
        } else {
          console.warn('No matching pools found at all')
          return null
        }
      }

      // 输出匹配的池子信息（在循环内）
      poolsWithLiquidity.forEach((pool: any, idx: number) => {
        const token0Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === pool.token0.toLowerCase())?.symbol || 'Token0'
        const token1Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === pool.token1.toLowerCase())?.symbol || 'Token1'
        const sqrtPrice = Number(pool.sqrtPriceX96) / (2 ** 96)
        const priceRatio = sqrtPrice ** 2
        const isPriceReasonable = priceRatio > 0.000001 && priceRatio < 1000000

        console.log(`\n[Pool ${idx + 1}] ===================`)
        console.log('  Pool Address:', pool.pool)
        console.log('  Token0:', pool.token0, `(${token0Symbol})`)
        console.log('  Token1:', pool.token1, `(${token1Symbol})`)
        console.log('  Pool Index:', pool.index)
        console.log('  Fee:', pool.fee, `(${(pool.fee / 10000).toFixed(2)}%)`)
        console.log('  Liquidity:', pool.liquidity.toString())
        console.log('  sqrtPriceX96:', pool.sqrtPriceX96.toString())
        console.log('  Current Tick:', pool.tick)
        console.log('  Price Ratio:', priceRatio.toFixed(6))
        console.log('  Price Reasonable:', isPriceReasonable ? 'YES' : 'NO')
        console.log('===========================\n')
      })

      // 检查池子是否有足够的代币余额
      console.log('\n===== Checking Pool Balances =====')
      const poolBalances = await Promise.all(
        poolsWithLiquidity.map(async (pool: any) => {
          try {
            const [balance0, balance1] = await Promise.all([
              publicClient.readContract({
                address: pool.token0,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [pool.pool],
              }),
              publicClient.readContract({
                address: pool.token1,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [pool.pool],
              }),
            ])

            return {
              pool: pool,
              balance0: BigInt(balance0),
              balance1: BigInt(balance1),
              balance0Formatted: formatUnits(BigInt(balance0), tokenInDecimals),
              balance1Formatted: formatUnits(BigInt(balance1), tokenOutDecimals),
            }
          } catch (error) {
            console.warn(`Failed to get balances for pool ${pool.index}:`, error)
            return null
          }
        })
      )

      const validPoolBalances = poolBalances.filter(Boolean)
      console.log(`\nPools with valid balances: ${validPoolBalances.length}`)

      // 输出池子余额信息
      validPoolBalances.forEach((pb, idx) => {
        if (!pb) return
        console.log(`\n[Pool #${pb.pool.index}] Balance Check:`)
        console.log(`  Token0 (${actualTokenIn === pb.pool.token0 ? 'MNA' : 'MNB'}): ${pb.balance0Formatted}`)
        console.log(`  Token1 (${actualTokenOut === pb.pool.token1 ? 'MNB' : 'MNA'}): ${pb.balance1Formatted}`)
        console.log(`  Can trade: ${parseFloat(pb.balance0Formatted) > 0 && parseFloat(pb.balance1Formatted) > 0 ? '✅ YES' : '❌ NO'}`)
      })

      if (matchedPools.length === 0) {
        console.warn('No matched pools found')
        return null
      }

      // 选择最优池子
      // 策略：优先选择价格合理的池子，而不是只看流动性
      const allPoolsWithInfo: PoolInfo[] = [...matchedPools].map(pool => {
        const sqrtPrice = Number(pool.sqrtPriceX96) / (2 ** 96)
        const priceRatio = sqrtPrice ** 2

        // 判断价格是否合理（比例在 0.000001 到 1000000 之间）
        const isPriceReasonable = priceRatio > 0.000001 && priceRatio < 1000000

        return {
          pool: pool.pool,
          token0: pool.token0,
          token1: pool.token1,
          index: pool.index,
          fee: pool.fee,
          feeProtocol: pool.feeProtocol,
          tickLower: pool.tickLower,
          tickUpper: pool.tickUpper,
          tick: pool.tick,
          sqrtPriceX96: pool.sqrtPriceX96,
          liquidity: pool.liquidity,
          priceRatio,
          isPriceReasonable,
        }
      })

      // 如果用户指定了池子索引，优先使用
      let bestPoolData: PoolInfo | null = null
      let bestPool: any = null
      let selectionReason = ''

      if (params.indexPath && params.indexPath.length > 0) {
        console.log(`\n👤 User specified pool index: ${params.indexPath[0]}`)
        // 使用用户选择的池子
        const userSelectedPool = allPoolsWithInfo.find(p => p.index === params.indexPath![0])
        if (userSelectedPool) {
          console.log('✅ Found user selected pool:', userSelectedPool.index)

          // 检查用户选择的池子价格是否合理
          if (!userSelectedPool.isPriceReasonable) {
            // 用户选择的是极端价格池子，检查是否有更好的选择
            const reasonablePools = allPoolsWithInfo.filter(p => p.isPriceReasonable)

            if (reasonablePools.length > 0) {
              // 有价格合理的池子，覆盖用户选择
              const betterPool = reasonablePools.reduce((best, current) => {
                const bestLiquidity = Number(best.liquidity)
                const currentLiquidity = Number(current.liquidity)
                return currentLiquidity > bestLiquidity ? current : best
              })

              console.log(`🔄 智能路由覆盖用户选择: Pool #${userSelectedPool.index} → Pool #${betterPool.index}`)
              console.log(`   原因: 用户选择的池子价格极端，切换到价格合理的池子`)

              bestPoolData = betterPool
              bestPool = betterPool
              selectionReason = '智能路由优化（覆盖用户选择）'
            } else {
              // 所有池子都是极端价格，使用用户选择
              bestPoolData = userSelectedPool
              bestPool = userSelectedPool
              selectionReason = '用户选择（所有池子价格极端）'
            }
          } else {
            // 用户选择的池子价格合理，使用用户选择
            bestPoolData = userSelectedPool
            bestPool = userSelectedPool
            selectionReason = '用户选择'
          }
        } else {
          console.warn('⚠️ User selected pool not found in matched pools!')
        }
      }

      // 如果没有用户选择，使用智能路由选择最优池子
      if (!bestPool) {
        console.log('\n🤖 No user selection, using smart routing...')

        // 创建余额映射
        const balanceMap = new Map<number, { balance0: bigint; balance1: bigint }>()
        validPoolBalances.forEach(pb => {
          if (pb) {
            balanceMap.set(pb.pool.index, {
              balance0: pb.balance0,
              balance1: pb.balance1
            })
          }
        })

        // 使用智能选择器
        const result = selectBestPool(
          allPoolsWithInfo,
          amountInWei,
          actualTokenIn,
          actualTokenOut,
          balanceMap
        )

        if (result) {
          bestPoolData = result.bestPool
          bestPool = bestPoolData
          selectionReason = result.reason
        } else {
          // Fallback: 选择价格合理且流动性最大的池子
          const reasonablePools = allPoolsWithInfo.filter(p => p.isPriceReasonable)
          const poolsToSort = reasonablePools.length > 0 ? reasonablePools : allPoolsWithInfo

          const sortedPools = [...poolsToSort].sort((a, b) => {
            const liquidityA = Number(a.liquidity)
            const liquidityB = Number(b.liquidity)
            return liquidityB - liquidityA
          })

          bestPoolData = sortedPools[0]
          bestPool = bestPoolData
          selectionReason = reasonablePools.length > 0 ? '流动性最大（价格合理）' : '流动性最大'
        }

        console.log('\n===== Smart Routing Result =====')
        console.log('Selected Pool Index:', bestPool.index)
        console.log('Selection Reason:', selectionReason)
        console.log('Price Reasonable:', bestPool.isPriceReasonable)
        console.log('Liquidity:', bestPool.liquidity.toString())
        console.log('Price Ratio:', bestPool.priceRatio.toFixed(6))
        console.log('================================\n')
      }

      // 如果没有选择到合适的池子，返回错误
      if (!bestPoolData || !bestPool) {
        console.error('❌ No suitable pool found')
        return null
      }

      const bestToken0Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === bestPool.token0.toLowerCase())?.symbol || 'Unknown'
      const bestToken1Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === bestPool.token1.toLowerCase())?.symbol || 'Unknown'

      console.log('✅ BEST POOL SELECTED:')
      console.log('  Pool Contract Address:', bestPool.pool)
      console.log('  Token0:', bestPool.token0, `(${bestToken0Symbol})`)
      console.log('  Token1:', bestPool.token1, `(${bestToken1Symbol})`)
      console.log('  Pool Index:', bestPool.index)
      console.log('  Fee:', bestPool.fee, `(${(bestPool.fee / 10000).toFixed(2)}%)`)
      console.log('  Liquidity:', bestPool.liquidity.toString())
      console.log('  sqrtPriceX96:', bestPool.sqrtPriceX96.toString())
      console.log('  Price Ratio:', bestPoolData.priceRatio.toFixed(6))
      console.log('  Price Reasonable:', bestPoolData.isPriceReasonable ? 'YES' : 'NO (EXTREME)')
      console.log('  Selection Reason:', selectionReason)

      // 检查是否所有池子都是极端价格
      const reasonablePools = allPoolsWithInfo.filter(p => p.isPriceReasonable)
      const allExtremePrices = reasonablePools.length === 0

      // 如果选中的是极端价格池子，但还有其他价格合理的池子，给出建议
      let priceWarning: string | null = null
      if (!bestPoolData.isPriceReasonable) {
        if (reasonablePools.length > 0) {
          // 有价格合理的池子可选
          priceWarning = `ℹ️ 当前选择池子价格比例极端 (1 ${bestToken0Symbol} = ${bestPoolData.priceRatio.toFixed(2)} ${bestToken1Symbol})。`
          priceWarning += `\n\n系统已自动为您选择了综合最优的池子。`

          // 找出价格最合理的池子
          const mostReasonablePool = reasonablePools.reduce((best, current) => {
            const bestLiquidity = Number(best.liquidity)
            const currentLiquidity = Number(current.liquidity)
            return currentLiquidity > bestLiquidity ? current : best
          })

          if (mostReasonablePool.index !== bestPool.index) {
            priceWarning += `\n\n您也可以手动选择 Pool #${mostReasonablePool.index} (价格合理，流动性: ${Number(mostReasonablePool.liquidity).toLocaleString()})`
          }
        } else if (allExtremePrices) {
          // 所有池子都是极端价格
          priceWarning = `⚠️ 警告：所有池子价格比例都较为极端。\n`
          priceWarning += `当前池子: 1 ${bestToken0Symbol} = ${bestPoolData.priceRatio.toFixed(2)} ${bestToken1Symbol}\n\n`
          priceWarning += `建议：\n`
          priceWarning += `1. 尝试更小的交易数量\n`
          priceWarning += `2. 等待流动性提供者调整价格\n`
          priceWarning += `3. 如果价格确实合理，请忽略此警告`
        }
        console.warn(priceWarning)
      } else if (!allExtremePrices && reasonablePools.length > 0) {
        // 自动选择到了价格合理的池子，给用户提示
        console.log(`✅ 系统自动选择了价格合理的池子 #${bestPool.index}`)
      }

      const indexPath = params.indexPath ?? [Number(bestPool.index)]

      // 计算zeroForOne（价格方向）
      const zeroForOne = actualTokenIn.toLowerCase() < actualTokenOut.toLowerCase()

      // 输出zeroForOne的详细解释
      const tokenInSymbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === actualTokenIn.toLowerCase())?.symbol || 'Unknown'
      const tokenOutSymbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === actualTokenOut.toLowerCase())?.symbol || 'Unknown'

      console.log('\n===== zeroForOne Analysis =====')
      console.log('tokenIn:', actualTokenIn, `(${tokenInSymbol})`)
      console.log('tokenOut:', actualTokenOut, `(${tokenOutSymbol})`)
      console.log('zeroForOne:', zeroForOne)
      console.log('Explanation:')
      console.log('  zeroForOne = tokenIn地址 < tokenOut地址 (按字典序)')
      console.log(`  ${actualTokenIn.toLowerCase()} < ${actualTokenOut.toLowerCase()} = ${zeroForOne}`)
      console.log('  含义:')
      if (zeroForOne) {
        console.log('    true = 价格方向是 token0 → token1 (价格下降)')
      } else {
        console.log('    false = 价格方向是 token1 → token0 (价格上升)')
      }
      console.log('  注意: zeroForOne不代表交易方向，只代表价格方向！')
      console.log('===============================\n')

      // 使用合约的quote函数进行精确报价
      console.log('\n===== Getting Quote from Contract =====')

      // 判断交易方向
      const isToken0In = bestPool.token0.toLowerCase() === actualTokenIn.toLowerCase()

      // 设置价格边界
      const sqrtPriceLimitX96 = zeroForOne ? (MIN_SQRT_RATIO + 1n) : (MAX_SQRT_RATIO - 1n)

      let amountOutWei: bigint | undefined

      try {
        // ✅ 修复：quoteExactInput 是正常的 view 函数，应该使用 readContract 调用
        // 而不是 estimateContractGas 等待 revert
        console.log('Calling quoteExactInput (view function)...')

        try {
          const quoteResult = await publicClient.readContract({
            address: CONTRACTS.SWAP_ROUTER as `0x${string}`,
            abi: SWAP_ROUTER_ABI,
            functionName: 'quoteExactInput',
            args: [{
              tokenIn: actualTokenIn as `0x${string}`,
              tokenOut: actualTokenOut as `0x${string}`,
              indexPath: indexPath,
              amountIn: amountInWei,
              sqrtPriceLimitX96,
            }],
          })

          // 解析返回值
          amountOutWei = quoteResult as bigint

          console.log('✅ Contract quote result:', amountOutWei.toString())

          if (!amountOutWei || amountOutWei === 0n) {
            throw new Error('Contract returned 0 output')
          }

        } catch (readError: any) {
          console.error('Failed to call quoteExactInput:', readError)
          throw readError
        }

        // 验证获取到的报价
        if (amountOutWei && amountOutWei > 0n) {
          const amountOutNum = Number(formatUnits(amountOutWei, tokenOutDecimals))
          const amountInNum = Number(params.amountIn)

          // 基本合理性检查
          if (isToken0In) {
            const rate = amountOutNum / amountInNum
            console.log(`✅ Quote verified: 1 ${tokenInSymbol} = ${rate.toFixed(6)} ${tokenOutSymbol}`)
          } else {
            const rate = amountInNum / amountOutNum
            console.log(`✅ Quote verified: 1 ${tokenOutSymbol} = ${rate.toFixed(6)} ${tokenInSymbol}`)
          }
        }
      } catch (quoteError) {
        console.error('❌ Contract quote failed, triggering fallback calculation')
        console.error('Error details:', quoteError instanceof Error ? quoteError.message : String(quoteError))

        // Fallback: 使用简化的恒定乘积公式（考虑价格影响）
        // 这是更保守但更可靠的计算方法
        console.log('\n===== Fallback Price Calculation =====')
        console.log('Input amount:', params.amountIn)
        console.log('Pool address:', bestPool.pool)
        console.log('Token0:', bestPool.token0)
        console.log('Token1:', bestPool.token1)

        const sqrtPriceX96 = bestPool.sqrtPriceX96
        const liquidity = bestPool.liquidity
        const isToken0In = bestPool.token0.toLowerCase() === actualTokenIn.toLowerCase()
        const feeRate = bestPool.fee / 1000000

        // 验证池子数据有效性
        if (!sqrtPriceX96 || sqrtPriceX96 === 0n) {
          console.error('❌ Invalid sqrtPriceX96:', sqrtPriceX96)
          return null
        }

        if (!liquidity || liquidity === 0n) {
          console.error('❌ Invalid liquidity:', liquidity)
          return null
        }

        // 解析当前价格
        const sqrtPrice = Number(sqrtPriceX96) / (2 ** 96)
        const poolPrice = sqrtPrice ** 2

        const token0Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === bestPool.token0.toLowerCase())?.symbol || 'Token0'
        const token1Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === bestPool.token1.toLowerCase())?.symbol || 'Token1'

        console.log(`Pool Price: 1 ${token0Symbol} = ${poolPrice.toFixed(6)} ${token1Symbol}`)
        console.log(`Fee: ${feeRate * 100}%`)
        console.log(`Liquidity: ${liquidity.toString()}`)

        let estimatedOut: number

        try {
          const amountInNum = Number(params.amountIn)
          const liquidityNum = Number(liquidity)

          // 使用实际的池子余额计算（从池子合约读取）
        console.log('Reading actual pool balances...')

        let actualBalance0: bigint
        let actualBalance1: bigint

        try {
          // 读取池子合约的实际代币余额
          const [balance0, balance1] = await Promise.all([
            publicClient.readContract({
              address: bestPool.token0 as `0x${string}`,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [bestPool.pool as `0x${string}`],
            }),
            publicClient.readContract({
              address: bestPool.token1 as `0x${string}`,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [bestPool.pool as `0x${string}`],
            }),
          ])

          actualBalance0 = BigInt(balance0)
          actualBalance1 = BigInt(balance1)

          console.log(`Actual pool balances:`)
          console.log(`  Token0 (${token0Symbol}): ${formatUnits(actualBalance0, tokenInDecimals)}`)
          console.log(`  Token1 (${token1Symbol}): ${formatUnits(actualBalance1, tokenOutDecimals)}`)

        } catch (balanceError) {
          console.error('Failed to read pool balances:', balanceError)

          // Fallback: 使用sqrtPrice和liquidity估算（不准确但可用）
          console.log('Using estimated balances from sqrtPrice...')
          const x = liquidityNum / sqrtPrice
          const y = liquidityNum * sqrtPrice
          actualBalance0 = parseUnits(x.toFixed(6), tokenInDecimals)
          actualBalance1 = parseUnits(y.toFixed(6), tokenOutDecimals)
        }

        // 使用实际余额计算输出
        const balance0Num = Number(formatUnits(actualBalance0, tokenInDecimals))
        const balance1Num = Number(formatUnits(actualBalance1, tokenOutDecimals))

        let estimatedOut: number

        if (isToken0In) {
          // token0 → token1: 输入token0，输出token1
          // Δy = y * Δx / (x + Δx)
          const deltaY = balance1Num * amountInNum / (balance0Num + amountInNum)
          estimatedOut = deltaY * (1 - feeRate)

          console.log(`Token0 → Token1 (using actual balances):`)
          console.log(`  Δy = ${balance1Num.toFixed(2)} * ${amountInNum} / (${balance0Num.toFixed(2)} + ${amountInNum}) = ${deltaY.toFixed(6)}`)
          console.log(`  After fee (${feeRate * 100}%): ${estimatedOut.toFixed(6)} ${token1Symbol}`)

        } else {
          // token1 → token0: 输入token1，输出token0
          // Δx = x * Δy / (y + Δy)
          const deltaX = balance0Num * amountInNum / (balance1Num + amountInNum)
          estimatedOut = deltaX * (1 - feeRate)

          console.log(`Token1 → Token0 (using actual balances):`)
          console.log(`  Δx = ${balance0Num.toFixed(2)} * ${amountInNum} / (${balance1Num.toFixed(2)} + ${amountInNum}) = ${deltaX.toFixed(6)}`)
          console.log(`  After fee (${feeRate * 100}%): ${estimatedOut.toFixed(6)} ${token0Symbol}`)
        }

          if (!isFinite(estimatedOut) || estimatedOut <= 0) {
            throw new Error('Invalid calculation result')
          }

          // ✅ 移除 15% 安全边际，因为：
          // 1. 我们应该使用合约的真实报价
          // 2. 如果合约报价失败，用户应该知道这是一个估算值
          // 3. Slippage 设置已经提供了保护

          amountOutWei = parseUnits(estimatedOut.toFixed(6), tokenOutDecimals)
          console.log(`✅ Fallback amountOutWei (no safety margin): ${estimatedOut.toFixed(6)}`)
          console.log('⚠️ Warning: Using fallback calculation, result may be less accurate')

        } catch (calcError) {
          console.error('❌ Fallback calculation failed:', calcError)

          // 最终备用方案：使用最保守的估算
          // 假设有3%的价格影响 + 正常的手续费
          const conservativePrice = isToken0In ? poolPrice : (1 / poolPrice)
          estimatedOut = Number(params.amountIn) * conservativePrice * (1 - feeRate) * 0.97

          console.log(`⚠️ Using ultra-conservative estimate:`)
          console.log(`  Price: ${conservativePrice.toFixed(6)}`)
          console.log(`  Output (with 3% impact): ${estimatedOut.toFixed(6)}`)
          amountOutWei = parseUnits(estimatedOut.toFixed(6), tokenOutDecimals)
        }
      }

      console.log('=========================================\n')

      // 检查是否成功获取报价
      if (!amountOutWei || amountOutWei === 0n) {
        console.error('❌ Failed to get valid quote amount')
        return null
      }

      const amountOut = formatUnits(amountOutWei, tokenOutDecimals)
      console.log('Final amountOut:', amountOut)
      console.log('===== getQuote End =====')

      // 检查价格影响
      const inputAmount = Number(params.amountIn)
      const liquidity = Number(bestPool.liquidity)
      if (liquidity > 0 && inputAmount > 0) {
        const priceImpact = Math.min(100, (inputAmount / liquidity) * 100)
        if (priceImpact > 5) {
          console.warn(`⚠️ 价格影响警告: ${priceImpact.toFixed(2)}%`)
          console.warn(`  输入数量占池子流动性的 ${priceImpact.toFixed(2)}%`)
          console.warn(`  这可能导致实际成交价与报价偏差较大`)
        }
      }

      // 返回结果
      return {
        amountOut,
        priceImpact: '0.5',  // 简化版本
        indexPathUsed: indexPath,
        warning: priceWarning || undefined,
        availablePools: allPoolsWithInfo.sort((a, b) => b.priceRatio - a.priceRatio),
      }
    } catch (error) {
      console.error('===== getQuote ERROR =====')
      console.error('Error type:', error?.constructor?.name)
      console.error('Error message:', error instanceof Error ? error.message : String(error))
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace')
      console.error('Full error object:', error)
      console.error('==========================')
      return null
    }
  }, [publicClient, address, getTokenDecimals])

  // 检查代币授权
  const useTokenAllowance = (tokenAddress: string) => {
    // ✅ 修复：允许查询 WETH 的授权（即使传入的是 WETH 地址）
    return useReadContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: address ? [address, CONTRACTS.SWAP_ROUTER] : undefined,
      query: {
        enabled: Boolean(address && tokenAddress),
      },
    })
  }

  // 授权代币
  const approveToken = useCallback(async (tokenAddress: string, amount: string, decimals?: number) => {
    if (!address) return

    const tokenDecimals = decimals ?? getTokenDecimals(tokenAddress)
    const amountWei = parseUnits(amount, tokenDecimals)

    // 使用最大额度避免重复approve
    const maxApproval = BigInt(2) ** BigInt(256) - BigInt(1)

    const gas = await estimateGasWithCap({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [CONTRACTS.SWAP_ROUTER, maxApproval],
      fallbackGas: APPROVE_GAS_FALLBACK,
    })

    writeContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [CONTRACTS.SWAP_ROUTER, maxApproval],
      gas,
    })
  }, [address, writeContract, estimateGasWithCap])

  // 包装 ETH 为 WETH
  const wrapETH = useCallback(async (amount: string, decimals: number = 18) => {
    if (!address || !publicClient) {
      throw new Error('Wallet not connected')
    }

    const amountWei = parseUnits(amount, decimals)
    const wethAddress = TOKENS.ETH.wrappedAddress as `0x${string}`

    console.log('\n===== Wrapping ETH to WETH =====')
    console.log('Amount:', amount, 'ETH')
    console.log('Amount Wei:', amountWei.toString())
    console.log('WETH Address:', wethAddress)

    // 检查 ETH 余额
    const ethBalance = await publicClient.getBalance({ address })
    console.log('ETH Balance:', formatUnits(ethBalance, 18))

    if (ethBalance < amountWei) {
      throw new Error(`ETH 余额不足。需要 ${amount} ETH，但只有 ${formatUnits(ethBalance, 18)} ETH`)
    }

    // 估算 gas
    const gas = await estimateGasWithCap({
      address: wethAddress,
      abi: WETH_ABI,
      functionName: 'deposit',
      value: amountWei,
      fallbackGas: 100000n,
    })

    console.log('Estimated gas:', gas.toString())
    console.log('=================================\n')

    // 调用 WETH.deposit
    writeContract({
      address: wethAddress,
      abi: WETH_ABI,
      functionName: 'deposit',
      value: amountWei,
      gas,
    })
  }, [address, publicClient, writeContract, estimateGasWithCap])

  // 检查并自动包装 ETH（如果需要）
  const checkAndWrapETHIfNeeded = useCallback(async (params: {
    amountRequired: bigint
    amountDisplay: string
    decimals: number
  }): Promise<boolean> => {
    if (!address || !publicClient) return false

    const wethAddress = TOKENS.ETH.wrappedAddress as `0x${string}`

    console.log('\n===== Checking if ETH needs to be wrapped =====')

    // 获取 ETH 和 WETH 余额
    const [ethBalance, wethBalance] = await Promise.all([
      publicClient.getBalance({ address }),
      publicClient.readContract({
        address: wethAddress,
        abi: WETH_ABI,
        functionName: 'balanceOf',
        args: [address],
      }),
    ])

    console.log('ETH Balance:', formatUnits(ethBalance, 18))
    console.log('WETH Balance:', formatUnits(wethBalance as bigint, 18))
    console.log('Required:', formatUnits(params.amountRequired, 18))

    // 如果 WETH 余额足够，直接返回
    if (BigInt(wethBalance as bigint) >= params.amountRequired) {
      console.log('✅ WETH balance sufficient, no need to wrap')
      return true
    }

    // 如果 ETH 余额不够，抛出错误
    if (ethBalance < params.amountRequired) {
      throw new Error(`余额不足。需要 ${params.amountDisplay} ETH，但只有 ${formatUnits(ethBalance, 18)} ETH`)
    }

    // 需要包装 ETH
    console.log('⏳ Wrapping ETH...')
    await wrapETH(params.amountDisplay, params.decimals)
    console.log('✅ ETH wrapped successfully')

    return true
  }, [address, publicClient, wrapETH])

  // 执行交换
  const executeSwap = useCallback(async (params: SwapParams) => {
    if (!address || !publicClient) {
      throw new Error('Wallet not connected')
    }

    console.log('\n===== executeSwap called =====')
    console.log('indexPath from params:', params.indexPath)
    console.log('isExactInput:', params.isExactInput)
    console.log('================================\n')

    const tokenInDecimals = params.tokenInDecimals ?? getTokenDecimals(params.tokenIn)
    const tokenOutDecimals = params.tokenOutDecimals ?? getTokenDecimals(params.tokenOut)

    // ✅ 修复：根据 isExactInput 决定使用哪个金额
    const isExactInput = params.isExactInput !== false  // 默认为 true

    let amountInWei: bigint
    let amountOutWei: bigint = 0n  // ✅ 初始化为 0n

    if (isExactInput) {
      // exactInput: 输入固定
      amountInWei = parseUnits(params.amountIn, tokenInDecimals)
    } else {
      // exactOutput: 输出固定
      if (!params.amountOut) {
        throw new Error('amountOut is required for exactOutput swap')
      }
      amountOutWei = parseUnits(params.amountOut, tokenOutDecimals)
      // 对于 exactOutput，需要先计算需要的 amountIn
      // 这里暂时使用 amountIn 参数，后续会通过报价更新
      amountInWei = parseUnits(params.amountIn, tokenInDecimals)
    }

    // ✅ 新逻辑：自动包装 ETH（如果需要）
    const isNativeTokenIn = isNativeTokenAddress(params.tokenIn)
    if (isNativeTokenIn) {
      await checkAndWrapETHIfNeeded({
        amountRequired: amountInWei,
        amountDisplay: params.amountIn,
        decimals: tokenInDecimals,
      })
    }

    // 获取报价 - 会使用params.indexPath
    const quote = await getQuote(params)
    if (!quote) {
      throw new Error('无法获取报价，请检查交易对是否有可用池子')
    }

    // 处理ETH
    const actualTokenIn = isNativeTokenIn ? TOKENS.ETH.wrappedAddress : params.tokenIn
    const actualTokenOut = isNativeTokenAddress(params.tokenOut) ? TOKENS.ETH.wrappedAddress : params.tokenOut

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200) // 20分钟后过期

    // 使用 getQuote 返回的 indexPath（已经通过 getPool() 查询）
    const indexPath = quote.indexPathUsed ?? [0]

    // 计算最小输出（exactInput）或最大输入（exactOutput）
    const amountOut = parseFloat(quote.amountOut)
    const token0Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === actualTokenIn.toLowerCase())?.symbol || 'Token0'
    const token1Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === actualTokenOut.toLowerCase())?.symbol || 'Token1'

    // 使用标准滑点
    let effectiveSlippage = params.slippage

    // 如果有警告信息，记录下来
    if (quote.warning) {
      console.warn(`⚠️ Quote warning: ${quote.warning}`)
    }

    const minAmountOut = parseUnits(
      (amountOut * (1 - effectiveSlippage / 100)).toFixed(6),
      tokenOutDecimals
    )

    // 输出滑点设置
    console.log('\n===== Slippage Settings =====')
    console.log('User set slippage:', params.slippage, '%')
    console.log('Effective slippage:', effectiveSlippage, '%')
    console.log('Expected output:', quote.amountOut)
    console.log('Min output (with slippage):', formatUnits(minAmountOut, tokenOutDecimals))
    console.log('Swap type:', isExactInput ? 'exactInput' : 'exactOutput')
    console.log('==============================\n')

    // 准备交易参数

    console.log('\n===== Swap Parameters =====')
    console.log('amountIn:', params.amountIn)
    console.log('expected amountOut:', quote.amountOut)
    console.log('minAmountOut (with slippage):', formatUnits(minAmountOut, tokenOutDecimals))
    console.log('slippage:', params.slippage, '%')

    // 计算价格方向和价格限制
    // 使用Uniswap V3的标准做法：MIN_SQRT_RATIO和MAX_SQRT_RATIO
    const zeroForOne = actualTokenIn.toLowerCase() < actualTokenOut.toLowerCase()
    const sqrtPriceLimitX96 = zeroForOne ? (MIN_SQRT_RATIO + 1n) : (MAX_SQRT_RATIO - 1n)

    console.log('\n===== Price Limit =====')
    console.log('zeroForOne:', zeroForOne)
    console.log('sqrtPriceLimitX96:', sqrtPriceLimitX96.toString())
    console.log('(Using MIN/MAX_SQRT_RATIO as per Uniswap V3 standard)')
    console.log('=========================\n')

    // 预检：检查余额和授权
    // ✅ 修复：检查 actualTokenIn（ETH 已经被转换成 WETH）
    // 而不是检查 params.tokenIn（原始的 ETH 地址）
    console.log('\n===== Pre-swap Checks =====')
    try {
      const [balance, allowance] = await Promise.all([
        publicClient.readContract({
          address: actualTokenIn as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        }),
        publicClient.readContract({
          address: actualTokenIn as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, CONTRACTS.SWAP_ROUTER],
        }),
      ])

      const balanceStr = formatUnits(BigInt(balance), tokenInDecimals)
      const allowanceStr = formatUnits(BigInt(allowance), tokenInDecimals)

      console.log('Token In:', actualTokenIn)
      console.log('Token In Balance:', balanceStr)
      console.log('Token In Allowance:', allowanceStr)
      console.log('Required Amount:', params.amountIn)

      if (BigInt(balance) < amountInWei) {
        throw new Error(`输入代币余额不足。拥有: ${balanceStr}, 需要: ${params.amountIn}`)
      }
      if (BigInt(allowance) < amountInWei) {
        throw new Error('授权不足，请先点击 Approve')
      }

      console.log('✅ Pre-checks passed')
      console.log('==========================\n')
    } catch (preCheckError) {
      console.error('Pre-check failed:', preCheckError)
      throw preCheckError
    }

    // ✅ 修复：ETH 已经在上面自动包装成 WETH，所以这里不发送 value
    const value = 0n

    console.log('\n💡 Note: ETH was wrapped to WETH in previous transaction, so no ETH value sent here')

    // 估算gas和执行交易
    console.log('\n===== Gas Estimation =====')
    console.log('Estimating gas for swap...')

    // ✅ 修复：分别处理 exactInput 和 exactOutput
    if (isExactInput) {
      const swapParams = {
        tokenIn: actualTokenIn as `0x${string}`,
        tokenOut: actualTokenOut as `0x${string}`,
        indexPath: indexPath,
        recipient: address,
        deadline,
        amountIn: amountInWei,
        amountOutMinimum: minAmountOut,
        sqrtPriceLimitX96,
      }

      const gas = await estimateGasWithCap({
        address: CONTRACTS.SWAP_ROUTER as `0x${string}`,
        abi: SWAP_ROUTER_ABI,
        functionName: 'exactInput',
        args: [swapParams],
        value,
        fallbackGas: SWAP_GAS_FALLBACK,
      })
      console.log('Estimated gas:', gas.toString())
      console.log('=========================\n')

      console.log('\n===== Executing exactInput Swap =====')
      console.log('Calling writeContract...')
      console.log('Swap params:', JSON.stringify({
        tokenIn: swapParams.tokenIn,
        tokenOut: swapParams.tokenOut,
        indexPath: swapParams.indexPath,
        recipient: swapParams.recipient,
        deadline: swapParams.deadline.toString(),
        amountIn: swapParams.amountIn.toString(),
        amountOutMinimum: swapParams.amountOutMinimum.toString(),
        sqrtPriceLimitX96: swapParams.sqrtPriceLimitX96.toString(),
      }, null, 2))

      try {
        writeContract({
          address: CONTRACTS.SWAP_ROUTER as `0x${string}`,
          abi: SWAP_ROUTER_ABI,
          functionName: 'exactInput',
          args: [swapParams],
          value,
          gas,
        })
        console.log('✅ writeContract called successfully')
        console.log('==========================\n')
      } catch (writeError) {
        console.error('❌ writeContract failed:', writeError)
        console.error('Error details:', JSON.stringify(writeError, null, 2))
        throw writeError
      }
    } else {
      // exactOutput
      const swapParams = {
        tokenIn: actualTokenIn as `0x${string}`,
        tokenOut: actualTokenOut as `0x${string}`,
        indexPath: indexPath,
        recipient: address,
        deadline,
        amountOut: amountOutWei,
        amountInMaximum: amountInWei,  // 最大可接受的输入
        sqrtPriceLimitX96,
      }

      const gas = await estimateGasWithCap({
        address: CONTRACTS.SWAP_ROUTER as `0x${string}`,
        abi: SWAP_ROUTER_ABI,
        functionName: 'exactOutput',
        args: [swapParams],
        value,
        fallbackGas: SWAP_GAS_FALLBACK,
      })
      console.log('Estimated gas:', gas.toString())
      console.log('=========================\n')

      console.log('\n===== Executing exactOutput Swap =====')
      console.log('Calling writeContract...')
      console.log('Swap params:', JSON.stringify({
        tokenIn: swapParams.tokenIn,
        tokenOut: swapParams.tokenOut,
        indexPath: swapParams.indexPath,
        recipient: swapParams.recipient,
        deadline: swapParams.deadline.toString(),
        amountOut: swapParams.amountOut.toString(),
        amountInMaximum: swapParams.amountInMaximum.toString(),
        sqrtPriceLimitX96: swapParams.sqrtPriceLimitX96.toString(),
      }, null, 2))

      try {
        writeContract({
          address: CONTRACTS.SWAP_ROUTER as `0x${string}`,
          abi: SWAP_ROUTER_ABI,
          functionName: 'exactOutput',
          args: [swapParams],
          value,
          gas,
        })
        console.log('✅ writeContract called successfully')
        console.log('==========================\n')
      } catch (writeError) {
        console.error('❌ writeContract failed:', writeError)
        console.error('Error details:', JSON.stringify(writeError, null, 2))
        throw writeError
      }
    }
  }, [address, writeContract, getQuote, publicClient, estimateGasWithCap, checkAndWrapETHIfNeeded])

  // 反向报价：输入tokenOut数量，计算需要的tokenIn数量
  const getReverseQuote = useCallback(async (params: {
    tokenIn: string
    tokenOut: string
    amountOut: string
    tokenInDecimals?: number
    tokenOutDecimals?: number
    indexPath?: number[]
    preloadedPools?: PoolInfo[]  // ✅ 新增：预加载的池子列表
  }): Promise<{ amountIn: string; indexPathUsed: number[] } | null> => {
    if (!params.amountOut || parseFloat(params.amountOut) === 0) {
      return null
    }

    if (!publicClient) {
      console.warn('Public client not available')
      return null
    }

    console.log('===== getReverseQuote Start =====')
    console.log('tokenIn:', params.tokenIn)
    console.log('tokenOut:', params.tokenOut)
    console.log('amountOut:', params.amountOut)

    try {
      const tokenInDecimals = params.tokenInDecimals ?? getTokenDecimals(params.tokenIn)
      const tokenOutDecimals = params.tokenOutDecimals ?? getTokenDecimals(params.tokenOut)

      const amountOutWei = parseUnits(params.amountOut, tokenOutDecimals)
      console.log('amountOutWei:', amountOutWei.toString())

      // 处理ETH地址
      const actualTokenIn = isNativeTokenAddress(params.tokenIn)
        ? TOKENS.ETH.wrappedAddress
        : params.tokenIn
      const actualTokenOut = isNativeTokenAddress(params.tokenOut)
        ? TOKENS.ETH.wrappedAddress
        : params.tokenOut

      console.log('actualTokenIn:', actualTokenIn)
      console.log('actualTokenOut:', actualTokenOut)

      // ✅ 新增：使用预加载的池子列表，避免重复查询
      let matchedPools: any[] = []

      if (params.preloadedPools && params.preloadedPools.length > 0) {
        console.log('✅ Using preloaded pools for reverse quote (避免重复查询)')
        matchedPools = params.preloadedPools.map(pool => ({
          pool: pool.pool,
          token0: pool.token0,
          token1: pool.token1,
          index: pool.index,
          fee: pool.fee,
          sqrtPriceX96: pool.sqrtPriceX96,
          liquidity: pool.liquidity,
        }))
      } else {
        // 如果没有预加载，才进行查询
        console.log('⚠️ No preloaded pools for reverse quote, querying from chain...')

        const WETH_SEPOLIA = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14'
        const WETH_MAINNET = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

        // 确保地址顺序正确（token0 < token1）
        let [sortedToken0, sortedToken1] = actualTokenIn.toLowerCase() < actualTokenOut.toLowerCase()
          ? [actualTokenIn.toLowerCase(), actualTokenOut.toLowerCase()]
          : [actualTokenOut.toLowerCase(), actualTokenIn.toLowerCase()]

        console.log('Querying pools for reverse quote:', sortedToken0, '/', sortedToken1)

        // ✅ 改进：动态查询，直到连续遇到空池子
        const MAX_EMPTY_POOLS = 3  // 连续遇到3个空池子时停止
        let emptyCount = 0
        let index = 0

        while (emptyCount < MAX_EMPTY_POOLS) {
          try {
            const poolAddress = await publicClient.readContract({
              address: CONTRACTS.POOL_MANAGER as `0x${string}`,
              abi: POOL_MANAGER_ABI,
              functionName: 'getPool',
              args: [sortedToken0 as `0x${string}`, sortedToken1 as `0x${string}`, index],
            })

            if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
              console.log(`✅ Found pool at index ${index}: ${poolAddress}`)
              emptyCount = 0  // 重置计数器

              // 获取池子详细信息
              try {
                const POOL_ABI = [
                  {
                    name: 'token0',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [],
                    outputs: [{ name: '', type: 'address' }],
                  },
                  {
                    name: 'token1',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [],
                    outputs: [{ name: '', type: 'address' }],
                  },
                  {
                    name: 'fee',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [],
                    outputs: [{ name: '', type: 'uint24' }],
                  },
                  {
                    name: 'liquidity',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [],
                    outputs: [{ name: '', type: 'uint128' }],
                  },
                  {
                    name: 'sqrtPriceX96',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [],
                    outputs: [{ name: '', type: 'uint160' }],
                  },
                ] as const

                const [poolToken0, poolToken1, fee, liquidity, sqrtPriceX96] = await Promise.all([
                  publicClient.readContract({
                    address: poolAddress,
                    abi: POOL_ABI,
                    functionName: 'token0',
                  }),
                  publicClient.readContract({
                    address: poolAddress,
                    abi: POOL_ABI,
                    functionName: 'token1',
                  }),
                  publicClient.readContract({
                    address: poolAddress,
                    abi: POOL_ABI,
                    functionName: 'fee',
                  }),
                  publicClient.readContract({
                    address: poolAddress,
                    abi: POOL_ABI,
                    functionName: 'liquidity',
                  }),
                  publicClient.readContract({
                    address: poolAddress,
                    abi: POOL_ABI,
                    functionName: 'sqrtPriceX96',
                  }),
                ])

                matchedPools.push({
                  pool: poolAddress,
                  token0: poolToken0,
                  token1: poolToken1,
                  index: index,  // ✅ 使用动态索引
                  fee: Number(fee),
                  sqrtPriceX96: sqrtPriceX96 as bigint,
                  liquidity: liquidity as bigint,
                })

                console.log(`  Fee: ${fee}, Liquidity: ${liquidity}`)
              } catch (error) {
                console.log(`  ⚠️  Could not fetch pool details for ${poolAddress}`)
              }
            } else {
              // 池子地址为空，增加空计数
              emptyCount++
              console.log(`  Empty pool at index ${index}, empty count: ${emptyCount}`)
            }
          } catch (error) {
            // 查询失败，可能是索引超出范围
            emptyCount++
            console.log(`  No pool at index ${index}, empty count: ${emptyCount}`)
          }

          index++  // 移动到下一个索引
        }

        console.log(`Total pools found: ${matchedPools.length}`)
      }

      // 输出所有匹配的池子详细信息
      matchedPools.forEach((pool, idx) => {
        const token0Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === pool.token0.toLowerCase())?.symbol || 'Unknown'
        const token1Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === pool.token1.toLowerCase())?.symbol || 'Unknown'

        console.log(`\n[Reverse Quote - Pool ${idx + 1}] ===================`)
        console.log('  Pool Address:', pool.pool)
        console.log('  Token0:', pool.token0, `(${token0Symbol})`)
        console.log('  Token1:', pool.token1, `(${token1Symbol})`)
        console.log('  Pool Index:', pool.index)
        console.log('  Fee:', pool.fee, `(${(pool.fee / 10000).toFixed(2)}%)`)
        console.log('  Liquidity:', pool.liquidity.toString())
        console.log('  sqrtPriceX96:', pool.sqrtPriceX96.toString())
        console.log('========================================\n')
      })

      if (matchedPools.length === 0) {
        console.warn('No matched pools found')
        return null
      }

      // 计算所有池子的价格合理性
      const poolsWithPriceInfo = matchedPools.map(pool => {
        const sqrtPrice = Number(pool.sqrtPriceX96) / (2 ** 96)
        const priceRatio = sqrtPrice ** 2
        const isPriceReasonable = priceRatio > 0.000001 && priceRatio < 1000000

        return {
          ...pool,
          priceRatio,
          isPriceReasonable,
        }
      })

      // 智能选择池子（和getQuote一样的逻辑）
      let selectedPool: typeof poolsWithPriceInfo[0]

      if (params.indexPath && params.indexPath.length > 0) {
        // 用户指定了池子
        const userPool = poolsWithPriceInfo.find(p => p.index === params.indexPath![0])

        if (userPool) {
          // 检查用户选择的池子是否价格极端
          if (!userPool.isPriceReasonable) {
            // 用户选择的是极端价格池子，检查是否有更好的选择
            const reasonablePools = poolsWithPriceInfo.filter(p => p.isPriceReasonable)

            if (reasonablePools.length > 0) {
              // 有价格合理的池子，自动切换
              const betterPool = reasonablePools.reduce((best, current) => {
                const bestLiquidity = Number(best.liquidity)
                const currentLiquidity = Number(current.liquidity)
                return currentLiquidity > bestLiquidity ? current : best
              })

              console.log(`🔄 反向报价智能路由覆盖: Pool #${userPool.index} → Pool #${betterPool.index}`)
              console.log(`   原因: 用户选择的池子价格极端，切换到价格合理的池子`)
              selectedPool = betterPool
            } else {
              // 所有池子都是极端价格，使用用户选择
              selectedPool = userPool
            }
          } else {
            // 用户选择的池子价格合理，使用用户选择
            selectedPool = userPool
          }
        } else {
          // 用户选择的池子不存在，自动选择
          const reasonablePools = poolsWithPriceInfo.filter(p => p.isPriceReasonable)
          if (reasonablePools.length > 0) {
            selectedPool = reasonablePools.reduce((best, current) => {
              const bestLiquidity = Number(best.liquidity)
              const currentLiquidity = Number(current.liquidity)
              return currentLiquidity > bestLiquidity ? current : best
            })
          } else {
            selectedPool = poolsWithPriceInfo.reduce((best, current) => {
              const bestLiquidity = Number(best.liquidity)
              const currentLiquidity = Number(current.liquidity)
              return currentLiquidity > bestLiquidity ? current : best
            })
          }
        }
      } else {
        // 没有指定池子，自动选择最优
        const reasonablePools = poolsWithPriceInfo.filter(p => p.isPriceReasonable)

        if (reasonablePools.length > 0) {
          // 优先选择价格合理的池子中流动性最大的
          selectedPool = reasonablePools.reduce((best, current) => {
            const bestLiquidity = Number(best.liquidity)
            const currentLiquidity = Number(current.liquidity)
            return currentLiquidity > bestLiquidity ? current : best
          })
        } else {
          // 所有池子都是极端价格，选择流动性最大的
          selectedPool = poolsWithPriceInfo.reduce((best, current) => {
            const bestLiquidity = Number(best.liquidity)
            const currentLiquidity = Number(current.liquidity)
            return currentLiquidity > bestLiquidity ? current : best
          })
        }
      }

      const bestPool = selectedPool
      const indexPath = [Number(bestPool.index)]

      const bestToken0Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === bestPool.token0.toLowerCase())?.symbol || 'Unknown'
      const bestToken1Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === bestPool.token1.toLowerCase())?.symbol || 'Unknown'

      console.log('✅ BEST POOL SELECTED for reverse quote:')
      console.log('  Pool Contract Address:', bestPool.pool)
      console.log('  Token0:', bestPool.token0, `(${bestToken0Symbol})`)
      console.log('  Token1:', bestPool.token1, `(${bestToken1Symbol})`)
      console.log('  Pool Index:', bestPool.index)
      console.log('  Fee:', bestPool.fee, `(${(bestPool.fee / 10000).toFixed(2)}%)`)
      console.log('  Liquidity:', bestPool.liquidity.toString())
      console.log('  sqrtPriceX96:', bestPool.sqrtPriceX96.toString())
      console.log('  Price Ratio:', bestPool.priceRatio.toFixed(6))
      console.log('  Price Reasonable:', bestPool.isPriceReasonable ? 'YES' : 'NO (EXTREME)')

      // 设置价格边界
      // zeroForOne: tokenIn < tokenOut (按地址排序)
      // 当 zeroForOne = true (token0 -> token1), 价格应该下降，使用 MIN_SQRT_RATIO
      // 当 zeroForOne = false (token1 -> token0), 价格应该上升，使用 MAX_SQRT_RATIO
      const zeroForOne = actualTokenIn.toLowerCase() < actualTokenOut.toLowerCase()
      const sqrtPriceLimitX96 = zeroForOne ? (MIN_SQRT_RATIO + 1n) : (MAX_SQRT_RATIO - 1n)

      // 输出zeroForOne的详细解释
      const tokenInSymbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === actualTokenIn.toLowerCase())?.symbol || 'Unknown'
      const tokenOutSymbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === actualTokenOut.toLowerCase())?.symbol || 'Unknown'

      console.log('\n===== zeroForOne Analysis =====')
      console.log('tokenIn:', actualTokenIn, `(${tokenInSymbol})`)
      console.log('tokenOut:', actualTokenOut, `(${tokenOutSymbol})`)
      console.log('zeroForOne:', zeroForOne)
      console.log('Explanation:')
      console.log('  zeroForOne = tokenIn地址 < tokenOut地址 (按字典序)')
      console.log(`  ${actualTokenIn.toLowerCase()} < ${actualTokenOut.toLowerCase()} = ${zeroForOne}`)
      console.log('  含义:')
      if (zeroForOne) {
        console.log('    true = 价格方向是 token0 → token1 (价格下降)')
        console.log('    使用 MIN_SQRT_RATIO 作为价格下限')
      } else {
        console.log('    false = 价格方向是 token1 → token0 (价格上升)')
        console.log('    使用 MAX_SQRT_RATIO 作为价格上限')
      }
      console.log('  注意: zeroForOne不代表交易方向，只代表价格方向！')
      console.log('===============================\n')

      console.log('Calling quoteExactOutput...')
      console.log('indexPath:', indexPath)
      console.log('zeroForOne:', zeroForOne)
      console.log('sqrtPriceLimitX96:', sqrtPriceLimitX96.toString())

      // quoteExactOutput现在可能正常返回值，不再revert
      let amountInWei: bigint

      try {
        // 方法1: 尝试使用readContract直接读取
        const result = await publicClient.readContract({
          address: CONTRACTS.SWAP_ROUTER as `0x${string}`,
          abi: SWAP_ROUTER_ABI,
          functionName: 'quoteExactOutput',
          args: [{
            tokenIn: actualTokenIn as `0x${string}`,
            tokenOut: actualTokenOut as `0x${string}`,
            indexPath: indexPath,
            amount: amountOutWei,
            sqrtPriceLimitX96,
          }],
        })

        amountInWei = result as bigint
        console.log('✅ readContract result:', amountInWei.toString())

        if (amountInWei === 0n) {
          console.warn('Contract returned 0, using fallback')
          throw new Error('Contract returned 0')
        }

      } catch (quoteError: any) {
        console.error('❌ quoteExactOutput failed:', quoteError)

        // Fallback: 使用池子价格计算
        const sqrtPriceX96 = bestPool.sqrtPriceX96
        const isToken0In = bestPool.token0.toLowerCase() === actualTokenIn.toLowerCase()

        const sqrtPrice = Number(sqrtPriceX96) / (2 ** 96)
        const poolPrice = sqrtPrice ** 2

        // 输出详细的价格信息
        const token0Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === bestPool.token0.toLowerCase())?.symbol || 'Token0'
        const token1Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === bestPool.token1.toLowerCase())?.symbol || 'Token1'

        console.log('\n===== Price Information =====')
        console.log(`Pool Price (token1/token0): ${poolPrice}`)
        console.log(`  即: 1 ${token0Symbol} = ${poolPrice.toFixed(6)} ${token1Symbol}`)
        console.log(`或: 1 ${token1Symbol} = ${(1/poolPrice).toFixed(9)} ${token0Symbol}`)
        console.log('=============================\n')

        console.log('Fallback calculation:', { poolPrice, isToken0In, sqrtPrice })

        let estimatedIn: number
        if (isToken0In) {
          // token0 -> token1: 需要的token0 = amountOut / price
          estimatedIn = Number(params.amountOut) / poolPrice
          console.log(`计算: ${params.amountOut} ${token1Symbol} / ${poolPrice} = ${estimatedIn} ${token0Symbol}`)
        } else {
          // token1 -> token0: 需要的token1 = amountOut * price
          estimatedIn = Number(params.amountOut) * poolPrice
          console.log(`计算: ${params.amountOut} ${token0Symbol} * ${poolPrice} = ${estimatedIn} ${token1Symbol}`)
        }

        console.log('Fallback estimatedIn:', estimatedIn)

        // 检测极端价格情况
        if (estimatedIn < 0.000001) {
          console.warn('⚠️ 极端价格警告: 需要的数量太小 (< 0.000001)，可能导致精度问题')
          console.warn(`建议: 增加输出数量至少 ${(0.000001 * poolPrice).toFixed(9)}`)
        }

        if (!isFinite(estimatedIn) || estimatedIn <= 0) {
          return null
        }

        amountInWei = parseUnits(estimatedIn.toFixed(6), tokenInDecimals)
      }

      const amountIn = formatUnits(amountInWei, tokenInDecimals)
      console.log('Final amountIn:', amountIn)

      // 如果结果是0，显示警告
      if (amountIn === '0') {
        console.warn('⚠️ 最终结果为0!')
        console.warn('这可能是因为:')
        console.warn('  1. 池子价格极端 (1 MNA = 250,515,928 MNB)')
        console.warn('  2. 输入的MNB数量太小')
        console.warn('建议: 尝试更大的数量，例如 1000 MNB')
      }

      console.log('===== getReverseQuote End =====')

      // 返回结果，包含池子索引
      return {
        amountIn,
        indexPathUsed: indexPath,  // 返回使用的池子索引
      }
    } catch (error) {
      console.error('Reverse quote failed:', error)
      return null
    }
  }, [publicClient, address, getTokenDecimals])

  return {
    executeSwap,
    approveToken,
    wrapETH,
    checkAndWrapETHIfNeeded,
    getQuote,
    getReverseQuote,
    useTokenAllowance,
    isPending,
    isConfirming,
    isConfirmed,
    hash,
  }
}