import { useState, useCallback } from 'react'
import {
  useAccount,
  useWriteContract,
  useReadContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import { POSITION_MANAGER_ABI, POOL_MANAGER_ABI, ERC20_ABI, WETH_ABI } from '@/lib/contracts'
import { TOKENS, isNativeTokenAddress, toChainTokenAddress, CONTRACTS } from '@/lib/constants'
import { MIN_SQRT_RATIO, MAX_SQRT_RATIO, getSqrtRatioAtPrice } from '@/lib/tickMath'

// Gas限制常量
const GAS_LIMIT_CAP = 16_000_000n
const ADD_LIQUIDITY_GAS_FALLBACK = 5_000_000n
const APPROVE_GAS_FALLBACK = 120_000n

export interface AddLiquidityParams {
  token0: string
  token1: string
  amount0: string
  amount1: string
  poolIndex: number
  token0Decimals?: number
  token1Decimals?: number
}

export function useLiquidity() {
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
    } catch (error: any) {
      console.warn(`Gas estimate failed for ${request.functionName}, fallback to ${request.fallbackGas.toString()}`, error)

      // 特殊处理：检查是否是池子索引越界错误
      if (error?.message?.includes('array out-of-bounds') || error?.message?.includes('Array index is out of bounds')) {
        console.error('\n❌ 池子索引越界错误！')
        console.error('这可能意味着：')
        console.error('1. 池子索引不存在于合约中')
        console.error('2. 池子数据已过期，需要刷新')
        console.error('3. 合约中的池子数组已被修改')
        console.error('建议：刷新页面重新获取池子列表\n')
      }

      return request.fallbackGas
    }
  }, [address, publicClient])

  // 检查代币授权
  const useTokenAllowance = (tokenAddress: string, spender: string) => {
    return useReadContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: address ? [address, spender as `0x${string}`] : undefined,
      query: {
        enabled: Boolean(address && tokenAddress && !isNativeTokenAddress(tokenAddress)),
      },
    })
  }

  // 授权代币
  const approveToken = useCallback(async (tokenAddress: string, amount: string, decimals?: number, spender?: string) => {
    if (!address) return

    const tokenDecimals = decimals ?? getTokenDecimals(tokenAddress)
    const amountWei = parseUnits(amount, tokenDecimals)
    const targetSpender = (spender || CONTRACTS.POSITION_MANAGER) as `0x${string}`

    // 使用最大额度避免重复approve
    const maxApproval = BigInt(2) ** BigInt(256) - BigInt(1)

    const gas = await estimateGasWithCap({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [targetSpender, maxApproval],
      fallbackGas: APPROVE_GAS_FALLBACK,
    })

    writeContract({
      address: tokenAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [targetSpender, maxApproval],
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
    tokenAddress: string
    amountRequired: bigint
    amountDisplay: string
    decimals: number
  }): Promise<boolean> => {
    if (!address || !publicClient) return false

    const isNative = isNativeTokenAddress(params.tokenAddress)
    if (!isNative) return true // 不是 ETH，不需要包装

    console.log('\n===== Checking if ETH needs to be wrapped =====')

    const wethAddress = TOKENS.ETH.wrappedAddress as `0x${string}`

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

  // 检查余额和授权
  const checkBalanceAndAllowance = useCallback(async (params: {
    tokenAddress: string
    amountRequired: bigint
    tokenSymbol: string
    tokenDecimals: number
    spender?: string
  }) => {
    if (!address || !publicClient || params.amountRequired <= 0n) return { hasBalance: false, hasAllowance: false }

    const targetSpender = params.spender || CONTRACTS.POSITION_MANAGER

    try {
      const [balance, allowance] = await Promise.all([
        publicClient.readContract({
          address: params.tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        }),
        publicClient.readContract({
          address: params.tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address, targetSpender as `0x${string}`],
        }),
      ])

      const hasBalance = BigInt(balance) >= params.amountRequired
      const hasAllowance = BigInt(allowance) >= params.amountRequired

      return { hasBalance, hasAllowance, balance: BigInt(balance), allowance: BigInt(allowance) }
    } catch (error) {
      console.error('Check balance/allowance failed:', error)
      return { hasBalance: false, hasAllowance: false }
    }
  }, [address, publicClient])

  // 添加流动性
  const addLiquidity = useCallback(async (params: AddLiquidityParams) => {
    if (!address || !publicClient) {
      throw new Error('Wallet not connected')
    }

    const token0Decimals = params.token0Decimals ?? getTokenDecimals(params.token0)
    const token1Decimals = params.token1Decimals ?? getTokenDecimals(params.token1)

    const amount0Wei = parseUnits(params.amount0, token0Decimals)
    const amount1Wei = parseUnits(params.amount1, token1Decimals)

    // ✅ 正确处理：如果是 ETH，转换成 WETH 地址
    // 因为合约的 mintCallback 会调用 ERC20.transferFrom
    const isToken0Native = isNativeTokenAddress(params.token0)
    const isToken1Native = isNativeTokenAddress(params.token1)
    const actualToken0 = isToken0Native ? TOKENS.ETH.wrappedAddress : params.token0
    const actualToken1 = isToken1Native ? TOKENS.ETH.wrappedAddress : params.token1

    console.log('\n===== Add Liquidity Token Addresses =====')
    console.log('User selected token0:', params.token0, isToken0Native ? '(ETH, will auto-wrap to WETH)' : '')
    console.log('User selected token1:', params.token1, isToken1Native ? '(ETH, will auto-wrap to WETH)' : '')
    console.log('Actual token0 sent to contract:', actualToken0)
    console.log('Actual token1 sent to contract:', actualToken1)
    console.log('==========================================\n')

    // ✅ 新逻辑：自动包装 ETH（如果需要）
    if (isToken0Native) {
      await checkAndWrapETHIfNeeded({
        tokenAddress: params.token0,
        amountRequired: amount0Wei,
        amountDisplay: params.amount0,
        decimals: token0Decimals,
      })
    }

    if (isToken1Native) {
      await checkAndWrapETHIfNeeded({
        tokenAddress: params.token1,
        amountRequired: amount1Wei,
        amountDisplay: params.amount1,
        decimals: token1Decimals,
      })
    }

    // 检查余额和授权（用原始地址检查，ETH 不需要授权）
    if (!isToken0Native) {
      const check0 = await checkBalanceAndAllowance({
        tokenAddress: actualToken0,
        amountRequired: amount0Wei,
        tokenSymbol: 'Token0',
        tokenDecimals: token0Decimals,
      })
      if (!check0.hasBalance) {
        throw new Error('Token0 余额不足')
      }
      if (!check0.hasAllowance) {
        throw new Error('Token0 授权不足，请先授权')
      }
    } else {
      // ETH 已经在上面包装完成，检查 WETH 授权
      const wethAllowance0 = await publicClient.readContract({
        address: TOKENS.ETH.wrappedAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, CONTRACTS.POSITION_MANAGER as `0x${string}`],
      })

      if (BigInt(wethAllowance0) < amount0Wei) {
        console.log('⏳ Approving WETH for Token0...')
        await approveToken(TOKENS.ETH.wrappedAddress, params.amount0, token0Decimals, CONTRACTS.POSITION_MANAGER)
        console.log('✅ WETH approved for Token0')
      }
    }

    if (!isToken1Native) {
      const check1 = await checkBalanceAndAllowance({
        tokenAddress: actualToken1,
        amountRequired: amount1Wei,
        tokenSymbol: 'Token1',
        tokenDecimals: token1Decimals,
      })
      if (!check1.hasBalance) {
        throw new Error('Token1 余额不足')
      }
      if (!check1.hasAllowance) {
        throw new Error('Token1 授权不足，请先授权')
      }
    } else {
      // ETH 已经在上面包装完成，检查 WETH 授权
      const wethAllowance1 = await publicClient.readContract({
        address: TOKENS.ETH.wrappedAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, CONTRACTS.POSITION_MANAGER as `0x${string}`],
      })

      if (BigInt(wethAllowance1) < amount1Wei) {
        console.log('⏳ Approving WETH for Token1...')
        await approveToken(TOKENS.ETH.wrappedAddress, params.amount1, token1Decimals, CONTRACTS.POSITION_MANAGER)
        console.log('✅ WETH approved for Token1')
      }
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200) // 20分钟后过期

    // 排序token地址（token0 < token1）
    let sortedToken0 = actualToken0
    let sortedToken1 = actualToken1
    let sortedAmount0 = amount0Wei
    let sortedAmount1 = amount1Wei

    if (BigInt(actualToken0) > BigInt(actualToken1)) {
      sortedToken0 = actualToken1
      sortedToken1 = actualToken0
      sortedAmount0 = amount1Wei
      sortedAmount1 = amount0Wei
    }

    const mintParams = {
      token0: sortedToken0 as `0x${string}`,
      token1: sortedToken1 as `0x${string}`,
      index: params.poolIndex,
      amount0Desired: sortedAmount0,
      amount1Desired: sortedAmount1,
      recipient: address,
      deadline,
    }

    console.log('\n===== Mint Transaction Debug =====')
    console.log('Pool Index:', params.poolIndex)
    console.log('Token0 (after sort):', sortedToken0)
    console.log('Token1 (after sort):', sortedToken1)
    console.log('Amount0 Desired:', sortedAmount0.toString())
    console.log('Amount1 Desired:', sortedAmount1.toString())
    console.log('Recipient:', address)
    console.log('===================================\n')

    // 检查池子是否存在和可用
    const MAINNET_WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

    // 如果有 WETH，检查是否是旧池子（使用主网 WETH 地址）
    const isSortedToken0Weth = sortedToken0.toLowerCase() === TOKENS.ETH.wrappedAddress.toLowerCase()
    const isSortedToken1Weth = sortedToken1.toLowerCase() === TOKENS.ETH.wrappedAddress.toLowerCase()

    try {
      const poolAddress = await publicClient.readContract({
        address: CONTRACTS.POOL_MANAGER as `0x${string}`,
        abi: POOL_MANAGER_ABI,
        functionName: 'getPool',
        args: [sortedToken0 as `0x${string}`, sortedToken1 as `0x${string}`, params.poolIndex],
      })
      console.log('✅ Pool found at address:', poolAddress)
    } catch (error) {
      console.error('❌ Pool not found! Index:', params.poolIndex, 'Tokens:', sortedToken0, sortedToken1)

      // 如果是 WETH 相关的池子，给出更详细的提示
      if (isSortedToken0Weth || isSortedToken1Weth) {
        throw new Error(
          `Pool #${params.poolIndex} 不存在。\n\n` +
          `可能原因：\n` +
          `1. 该池子尚未创建，请先创建池子\n` +
          `2. 或者旧池子使用了错误的 WETH 地址（主网地址），无法使用\n\n` +
          `解决方案：\n` +
          `请在"创建池子"页面创建新的 ${sortedToken0}/${sortedToken1} 池子`
        )
      }

      throw new Error(`Pool #${params.poolIndex} not found for tokens ${sortedToken0}/${sortedToken1}`)
    }

    // 估算gas
    const gas = await estimateGasWithCap({
      address: CONTRACTS.POSITION_MANAGER as `0x${string}`,
      abi: POSITION_MANAGER_ABI,
      functionName: 'mint',
      args: [mintParams],
      fallbackGas: ADD_LIQUIDITY_GAS_FALLBACK,
    })

    writeContract({
      address: CONTRACTS.POSITION_MANAGER as `0x${string}`,
      abi: POSITION_MANAGER_ABI,
      functionName: 'mint',
      args: [mintParams],
      gas,
    })
  }, [address, writeContract, publicClient, checkBalanceAndAllowance, estimateGasWithCap])

  // 创建池子并添加流动性
  const createPoolAndAddLiquidity = useCallback(async (params: AddLiquidityParams & {
    initialPrice: number // 初始价格比例 token1/token0
    fee: number // 费率
  }) => {
    if (!address || !publicClient) {
      throw new Error('Wallet not connected')
    }

    const token0Decimals = params.token0Decimals ?? getTokenDecimals(params.token0)
    const token1Decimals = params.token1Decimals ?? getTokenDecimals(params.token1)

    const amount0Wei = parseUnits(params.amount0, token0Decimals)
    const amount1Wei = parseUnits(params.amount1, token1Decimals)

    // ✅ 正确处理：如果是 ETH，转换成 WETH 地址
    // 因为合约的 mintCallback 会调用 ERC20.transferFrom
    const isToken0Native = isNativeTokenAddress(params.token0)
    const isToken1Native = isNativeTokenAddress(params.token1)
    const actualToken0 = isToken0Native ? TOKENS.ETH.wrappedAddress : params.token0
    const actualToken1 = isToken1Native ? TOKENS.ETH.wrappedAddress : params.token1

    console.log('\n===== Create Pool Token Addresses =====')
    console.log('User selected token0:', params.token0, isToken0Native ? '(ETH, will auto-wrap to WETH)' : '')
    console.log('User selected token1:', params.token1, isToken1Native ? '(ETH, will auto-wrap to WETH)' : '')
    console.log('Actual token0 sent to contract:', actualToken0)
    console.log('Actual token1 sent to contract:', actualToken1)
    console.log('=========================================\n')

    // 排序token地址
    let sortedToken0 = actualToken0
    let sortedToken1 = actualToken1
    let sortedAmount0 = amount0Wei
    let sortedAmount1 = amount1Wei

    if (BigInt(actualToken0) > BigInt(actualToken1)) {
      sortedToken0 = actualToken1
      sortedToken1 = actualToken0
      sortedAmount0 = amount1Wei
      sortedAmount1 = amount0Wei
    }

    // ✅ 新逻辑：自动包装 ETH（如果需要）
    if (isToken0Native) {
      await checkAndWrapETHIfNeeded({
        tokenAddress: params.token0,
        amountRequired: sortedAmount0,
        amountDisplay: params.amount0,
        decimals: token0Decimals,
      })
    }

    if (isToken1Native) {
      await checkAndWrapETHIfNeeded({
        tokenAddress: params.token1,
        amountRequired: sortedAmount1,
        amountDisplay: params.amount1,
        decimals: token1Decimals,
      })
    }

    // 检查余额和授权（用原始地址检查，ETH 不需要授权）
    if (!isToken0Native) {
      const check0 = await checkBalanceAndAllowance({
        tokenAddress: sortedToken0,
        amountRequired: sortedAmount0,
        tokenSymbol: 'Token0',
        tokenDecimals: token0Decimals,
      })
      if (!check0.hasBalance) {
        throw new Error('Token0 余额不足')
      }
      if (!check0.hasAllowance) {
        throw new Error('Token0 授权不足，请先授权')
      }
    }

    if (!isToken1Native) {
      const check1 = await checkBalanceAndAllowance({
        tokenAddress: sortedToken1,
        amountRequired: sortedAmount1,
        tokenSymbol: 'Token1',
        tokenDecimals: token1Decimals,
      })
      if (!check1.hasBalance) {
        throw new Error('Token1 余额不足')
      }
      if (!check1.hasAllowance) {
        throw new Error('Token1 授权不足，请先授权')
      }
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)

    // 使用TickMath计算sqrtPriceX96
    const sqrtPriceX96 = getSqrtRatioAtPrice(params.initialPrice)
    if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 > MAX_SQRT_RATIO) {
      throw new Error('Invalid price range')
    }

    // 创建池子参数
    const poolParams = {
      token0: sortedToken0 as `0x${string}`,
      token1: sortedToken1 as `0x${string}`,
      fee: params.fee,
      tickLower: -887272, // 全范围
      tickUpper: 887272,
      sqrtPriceX96,
    }

    const mintParams = {
      token0: sortedToken0 as `0x${string}`,
      token1: sortedToken1 as `0x${string}`,
      index: 0,
      amount0Desired: sortedAmount0,
      amount1Desired: sortedAmount1,
      recipient: address,
      deadline,
    }

    // 估算gas
    const gas = await estimateGasWithCap({
      address: CONTRACTS.META_NODE_MANAGER as `0x${string}`,
      abi: POSITION_MANAGER_ABI, // 使用POSITION_MANAGER_ABI，包含createAndAddLiquidity
      functionName: 'createAndAddLiquidity',
      args: [poolParams, mintParams],
      fallbackGas: ADD_LIQUIDITY_GAS_FALLBACK * 2n, // 创建池子需要更多gas
    })

    writeContract({
      address: CONTRACTS.META_NODE_MANAGER as `0x${string}`,
      abi: POSITION_MANAGER_ABI,
      functionName: 'createAndAddLiquidity',
      args: [poolParams, mintParams],
      gas,
    })
  }, [address, writeContract, publicClient, checkBalanceAndAllowance, estimateGasWithCap, getTokenDecimals])

  return {
    addLiquidity,
    createPoolAndAddLiquidity,
    approveToken,
    checkBalanceAndAllowance,
    useTokenAllowance,
    wrapETH,
    checkAndWrapETHIfNeeded,
    isPending,
    isConfirming,
    isConfirmed,
    hash,
  }
}