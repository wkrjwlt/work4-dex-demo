'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAccount, useBalance, usePublicClient } from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import { TOKENS, isNativeTokenAddress, toChainTokenAddress, CONTRACTS } from '@/lib/constants'
import { POOL_MANAGER_ABI } from '@/lib/contracts'
import { useReadContract } from 'wagmi'
import { Select, Button, Input, Spin, App } from 'antd'
import React from 'react'
import Link from 'next/link'
import { useSwap, PoolInfo } from '@/hooks/useSwap'
import { CreatePoolModal } from '@/components/CreatePoolModal'

export function SwapInterface() {
  const { address, isConnected } = useAccount()
  const { message } = App.useApp()

  // 使用自定义 swap hook
  const {
    executeSwap,
    approveToken,
    getQuote,
    getReverseQuote,
    useTokenAllowance,
    isPending,
    isConfirming,
    isConfirmed,
    hash,
  } = useSwap()

  const [formData, setFormData] = useState({
    tokenIn: TOKENS.ETH.address, // 默认选中 ETH
    tokenOut: TOKENS.MNTokenA.address, // 默认选中 MNA
    amountIn: '',
    amountOut: '',
    slippage: 0.5,
    poolIndex: 0,
  })

  const [isExactInput, setIsExactInput] = useState(true) // true: 输入amountIn计算amountOut, false: 输入amountOut计算amountIn
  const [availablePools, setAvailablePools] = useState<PoolInfo[]>([])
  const [selectedPoolIndex, setSelectedPoolIndex] = useState<number | null>(null)
  const [isQuoting, setIsQuoting] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [showPoolSelector, setShowPoolSelector] = useState(false)
  const [showCreatePoolModal, setShowCreatePoolModal] = useState(false) // 创建池子模态框
  const [pendingSwapAfterApprove, setPendingSwapAfterApprove] = useState(false) // ✅ 新增：标记授权后是否需要继续交易

  // ✅ 使用 getPool() 直接查询池子，而不是 getAllPools()
  const publicClient = usePublicClient()

  // 当代币选择改变时，自动查询池子
  useEffect(() => {
    const queryPoolsForPair = async () => {
      if (!formData.tokenIn || !formData.tokenOut || !publicClient) {
        setAvailablePools([])
        return
      }

      console.log('\n===== SwapInterface: Querying Pools for Token Pair =====')
      console.log('TokenIn:', formData.tokenIn)
      console.log('TokenOut:', formData.tokenOut)

      // 将 ETH 地址转换为 WETH 地址
      const WETH_SEPOLIA = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14'
      const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

      const actualTokenIn = isNativeTokenAddress(formData.tokenIn) ? WETH_SEPOLIA : formData.tokenIn
      const actualTokenOut = isNativeTokenAddress(formData.tokenOut) ? WETH_SEPOLIA : formData.tokenOut

      // ✅ 优化：使用 getAllPools() 一次性获取所有池子
      // 只需要 1 次 RPC 调用，而不是循环查询 N 次
      console.log(`🔄 Querying pools for pair: ${actualTokenIn} / ${actualTokenOut}`)
      const startTime = Date.now()

      try {
        const allPools = await publicClient.readContract({
          address: CONTRACTS.POOL_MANAGER as `0x${string}`,
          abi: POOL_MANAGER_ABI,
          functionName: 'getAllPools',
        })

        const fetchTime = Date.now() - startTime
        console.log(`✅ Got ${allPools.length} pools in ${fetchTime}ms`)

        // 前端过滤特定代币对的池子
        const foundPools: PoolInfo[] = allPools
          .filter((pool: any) => {
            const matchNormal =
              pool.token0.toLowerCase() === actualTokenIn.toLowerCase() &&
              pool.token1.toLowerCase() === actualTokenOut.toLowerCase()
            const matchReverse =
              pool.token0.toLowerCase() === actualTokenOut.toLowerCase() &&
              pool.token1.toLowerCase() === actualTokenIn.toLowerCase()
            return matchNormal || matchReverse
          })
          .map((pool: any) => {
            // 计算价格合理性
            const sqrtPrice = Number(pool.sqrtPriceX96) / (2 ** 96)
            const priceRatio = sqrtPrice ** 2
            const isPriceReasonable = priceRatio > 0.000001 && priceRatio < 1000000

            return {
              pool: pool.pool,
              token0: pool.token0,
              token1: pool.token1,
              index: Number(pool.index),
              fee: Number(pool.fee),
              tick: Number(pool.tick),
              sqrtPriceX96: pool.sqrtPriceX96,
              liquidity: pool.liquidity,
              priceRatio,
              isPriceReasonable,
            }
          })

        console.log(`✅ Found ${foundPools.length} pools for this pair`)
        foundPools.forEach((pool) => {
          console.log(`  Pool #${pool.index}: Fee=${(pool.fee/10000).toFixed(2)}%, Liquidity=${pool.liquidity.toString()}, PriceRatio=${pool.priceRatio.toFixed(6)}`)
        })

        setAvailablePools(foundPools)
      } catch (error) {
        console.error('❌ Failed to fetch pools:', error)
        setAvailablePools([])
      }
    }

    queryPoolsForPair()
  }, [formData.tokenIn, formData.tokenOut, publicClient])

  // 过滤可选的池子
  const filteredPools = useMemo(() => {
    // ✅ 支持 ETH/WETH 地址转换
    const WETH_SEPOLIA = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14'
    const WETH_MAINNET = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
    const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

    const normalizeAddress = (addr: string) => {
      if (addr.toLowerCase() === ETH_ADDRESS.toLowerCase()) {
        return WETH_SEPOLIA.toLowerCase() // ETH 转换为 Sepolia WETH
      }
      if (addr.toLowerCase() === WETH_MAINNET.toLowerCase()) {
        return WETH_SEPOLIA.toLowerCase() // 主网 WETH 转换为 Sepolia WETH
      }
      return addr.toLowerCase()
    }

    const userTokenIn = normalizeAddress(formData.tokenIn)
    const userTokenOut = normalizeAddress(formData.tokenOut)

    return availablePools.filter(pool => {
      const poolToken0 = normalizeAddress(pool.token0)
      const poolToken1 = normalizeAddress(pool.token1)

      // 支持两种顺序匹配
      const matchNormal = poolToken0 === userTokenIn && poolToken1 === userTokenOut
      const matchReverse = poolToken0 === userTokenOut && poolToken1 === userTokenIn

      return matchNormal || matchReverse
    })
  }, [availablePools, formData.tokenIn, formData.tokenOut])

  // 过滤有流动性的池子（可用于交易）
  const availablePoolsWithLiquidity = useMemo(() => {
    return filteredPools.filter(pool => {
      const liquidity = Number(pool.liquidity || 0n)
      return liquidity > 0
    })
  }, [filteredPools])

  // 自动选择最优池子（流动性最大的）
  const primaryPoolIndex = useMemo(() => {
    if (availablePoolsWithLiquidity.length === 0) return -1
    const sorted = [...availablePoolsWithLiquidity].sort((a, b) => {
      const liqA = Number(a.liquidity || 0n)
      const liqB = Number(b.liquidity || 0n)
      return liqB - liqA
    })
    return Number(sorted[0].index)
  }, [availablePoolsWithLiquidity])

  const selectedIndexPath = useMemo(() => {
    if (primaryPoolIndex < 0) return []
    return [primaryPoolIndex]
  }, [primaryPoolIndex])

  // 获取当前池子信息
  // ✅ 优先使用 selectedPoolIndex（智能路由或手动选择），回退到 formData.poolIndex
  const selectedPool = useMemo(() => {
    const poolIndex = selectedPoolIndex ?? formData.poolIndex
    return filteredPools.find(p => p.index === poolIndex) || filteredPools[0]
  }, [filteredPools, selectedPoolIndex, formData.poolIndex])

  // 获取代币信息
  const getTokenDecimals = useCallback((address: string) => {
    const token = Object.values(TOKENS).find(t => t.address.toLowerCase() === address.toLowerCase())
    return token?.decimals || 18
  }, [])

  // 获取代币余额
  const { data: balanceIn, refetch: refetchBalanceIn } = useBalance({
    address: address,
    token: isNativeTokenAddress(formData.tokenIn) ? undefined : (formData.tokenIn as `0x${string}`),
  })

  const { data: balanceOut, refetch: refetchBalanceOut } = useBalance({
    address: address,
    token: isNativeTokenAddress(formData.tokenOut) ? undefined : (formData.tokenOut as `0x${string}`),
  })

  // 获取Allowance
  // ✅ 修复：ETH 需要查询 WETH 的授权，而不是跳过
  const actualTokenInForAllowance = isNativeTokenAddress(formData.tokenIn)
    ? TOKENS.ETH.wrappedAddress  // ETH → WETH
    : formData.tokenIn

  const { data: allowance, refetch: refetchAllowance } = useTokenAllowance(actualTokenInForAllowance)

  // 调试：打印allowance值
  useEffect(() => {
    if (allowance !== undefined && formData.tokenIn) {
      console.log('===== Allowance Debug =====')
      console.log('Token In:', formData.tokenIn)
      console.log('Allowance:', allowance.toString())
      console.log('Allowance (formatted):', formatUnits(allowance as bigint, 18))
      console.log('Amount In:', formData.amountIn)
      console.log('===========================')
    }
  }, [allowance, formData.tokenIn, formData.amountIn])

  // 计算是否需要Approve
  const needsApprove = useMemo(() => {
    // ✅ 修复：ETH 需要被包装成 WETH，所以需要检查 WETH 的授权
    // 不应该直接跳过原生代币的授权检查
    const actualTokenIn = isNativeTokenAddress(formData.tokenIn)
      ? TOKENS.ETH.wrappedAddress  // ETH → WETH
      : formData.tokenIn

    if (!formData.amountIn || parseFloat(formData.amountIn) <= 0) return false
    if (allowance == null) return true
    try {
      const amountWei = parseUnits(formData.amountIn, getTokenDecimals(formData.tokenIn))
      return allowance < amountWei
    } catch {
      return true
    }
  }, [allowance, formData.amountIn, formData.tokenIn, getTokenDecimals])

  // 校验输入金额是否超过余额
  const isInsufficientBalance = useMemo(() => {
    if (!formData.amountIn || !balanceIn) return false
    try {
      const inputAmount = parseUnits(formData.amountIn, balanceIn.decimals)
      return inputAmount > balanceIn.value
    } catch {
      return false
    }
  }, [formData.amountIn, balanceIn])

  // 计算价格影响
  const calculatePriceImpact = useCallback(() => {
    if (!selectedPool || !formData.amountIn || !formData.amountOut) return null
    const liquidity = Number(selectedPool.liquidity)
    if (liquidity === 0) return 100
    const inputAmount = Number(formData.amountIn)
    const impact = Math.min(100, (inputAmount / liquidity) * 100)
    return impact
  }, [selectedPool, formData.amountIn, formData.amountOut])

  // 计算最小接收数量
  const getMinimumOutput = useCallback(() => {
    if (!formData.amountOut) return '0'
    const amount = parseFloat(formData.amountOut)
    const minAmount = amount * (1 - formData.slippage / 100)
    return minAmount.toFixed(6)
  }, [formData.amountOut, formData.slippage])

  // 自动获取价格预估 - 双向报价
  const updateQuote = useCallback(async () => {
    const amount = isExactInput ? formData.amountIn : formData.amountOut
    if (!amount || parseFloat(amount) === 0) {
      if (isExactInput) {
        setFormData(prev => ({ ...prev, amountOut: '' }))
      } else {
        setFormData(prev => ({ ...prev, amountIn: '' }))
      }
      setQuoteError(null)
      return
    }

    if (!formData.tokenIn || !formData.tokenOut || selectedIndexPath.length === 0) {
      setQuoteError(null)
      return
    }

    setIsQuoting(true)
    setQuoteError(null)

    console.log('===== Update Quote =====')
    console.log('isExactInput:', isExactInput)
    console.log('tokenIn:', formData.tokenIn)
    console.log('tokenOut:', formData.tokenOut)
    console.log('amount:', amount)

    try {
      if (isExactInput) {
        // 输入amountIn，计算amountOut
        const quote = await getQuote({
          tokenIn: formData.tokenIn,
          tokenOut: formData.tokenOut,
          amountIn: formData.amountIn,
          slippage: formData.slippage,
          indexPath: selectedPoolIndex ? [selectedPoolIndex] : undefined, // 传入用户选择的池子
          tokenInDecimals: getTokenDecimals(formData.tokenIn),
          tokenOutDecimals: getTokenDecimals(formData.tokenOut),
          preloadedPools: availablePools,  // ✅ 传递已查询的池子列表，避免重复查询
        })

        console.log('Quote result:', quote)

        if (quote) {
          setFormData(prev => ({ ...prev, amountOut: quote.amountOut }))

          // 保存可用池子列表
          if (quote.availablePools && quote.availablePools.length > 0) {
            setAvailablePools(quote.availablePools)

            // 智能路由返回的池子
            const smartRoutedPoolIndex = quote.indexPathUsed?.[0]

            // 如果智能路由选择了不同的池子，检查是否应该覆盖用户选择
            if (smartRoutedPoolIndex !== undefined && smartRoutedPoolIndex !== selectedPoolIndex) {
              const smartPool = quote.availablePools.find(p => p.index === smartRoutedPoolIndex)
              const userPool = quote.availablePools.find(p => p.index === selectedPoolIndex)

              // 如果智能路由的池子价格合理，而用户选择的池子价格极端，则覆盖用户选择
              if (smartPool && smartPool.isPriceReasonable &&
                  (!userPool || !userPool.isPriceReasonable)) {
                console.log(`🔄 智能路由覆盖用户选择: Pool #${selectedPoolIndex} → Pool #${smartRoutedPoolIndex}`)
                console.log(`   原因: 用户选择的池子价格极端，智能路由选择了价格合理的池子`)
                setSelectedPoolIndex(smartRoutedPoolIndex)
                setFormData(prev => ({ ...prev, poolIndex: smartRoutedPoolIndex })) // ✅ 同步更新
              }
            }

            // 如果用户没有手动选择池子，使用智能路由的结果
            if (!selectedPoolIndex && smartRoutedPoolIndex !== undefined) {
              setSelectedPoolIndex(smartRoutedPoolIndex)
              setFormData(prev => ({ ...prev, poolIndex: smartRoutedPoolIndex })) // ✅ 同步更新
            }
          }

          // 显示警告信息（如果有）
          if (quote.warning) {
            setQuoteError(quote.warning)
            setShowPoolSelector(true) // 显示池子选择器
            console.warn('Price warning:', quote.warning)
          } else {
            setQuoteError(null)
            // 不自动隐藏池子选择器，让用户可以随时更换池子
            // setShowPoolSelector(false)
          }
        } else {
          setFormData(prev => ({ ...prev, amountOut: '' }))
          setQuoteError('无法获取报价')
        }
      } else {
        // 输入amountOut，计算amountIn
        const amountInNeeded = await getReverseQuote({
          tokenIn: formData.tokenIn,
          tokenOut: formData.tokenOut,
          amountOut: formData.amountOut,
          indexPath: selectedPoolIndex ? [selectedPoolIndex] : undefined, // 传入用户选择的池子
          tokenInDecimals: getTokenDecimals(formData.tokenIn),
          tokenOutDecimals: getTokenDecimals(formData.tokenOut),
          preloadedPools: availablePools,  // ✅ 传递已查询的池子列表，避免重复查询
        })

        console.log('Reverse quote result:', amountInNeeded)

        if (amountInNeeded) {
          setFormData(prev => ({ ...prev, amountIn: amountInNeeded.amountIn }))

          // 如果反向报价返回了池子索引，更新选择
          if (amountInNeeded.indexPathUsed && amountInNeeded.indexPathUsed.length > 0) {
            const reversePoolIndex = amountInNeeded.indexPathUsed[0]
            // 只在没有手动选择池子时才更新
            if (!selectedPoolIndex) {
              setSelectedPoolIndex(reversePoolIndex)
              setFormData(prev => ({ ...prev, poolIndex: reversePoolIndex })) // ✅ 同步更新
            }
          }

          setQuoteError(null)
        } else {
          setFormData(prev => ({ ...prev, amountIn: '' }))
          setQuoteError('无法获取报价')
        }
      }
    } catch (error) {
      console.error('Quote failed:', error)
      const errorMessage = error instanceof Error ? error.message : '获取报价失败'
      console.error('Quote error details:', error)
      setQuoteError(errorMessage)
      if (isExactInput) {
        setFormData(prev => ({ ...prev, amountOut: '' }))
      } else {
        setFormData(prev => ({ ...prev, amountIn: '' }))
      }
    } finally {
      setIsQuoting(false)
    }
  }, [
    formData.tokenIn,
    formData.tokenOut,
    formData.amountIn,
    formData.amountOut,
    formData.slippage,
    selectedIndexPath,
    isExactInput,
    getQuote,
    getReverseQuote,
    getTokenDecimals,
  ])

  // 防抖拉报价
  const updateQuoteRef = useRef(updateQuote)
  updateQuoteRef.current = updateQuote

  const shouldShowQuote = useMemo(() => {
    const amount = isExactInput ? formData.amountIn : formData.amountOut
    if (!amount) return false
    const n = parseFloat(amount)
    return Number.isFinite(n) && n > 0
  }, [formData.amountIn, formData.amountOut, isExactInput])

  useEffect(() => {
    if (!shouldShowQuote) return

    // 如果没有池子，不需要等待报价，直接显示创建池子提示
    if (selectedIndexPath.length === 0) {
      // 清空报价结果
      setQuoteError(null)
      return
    }

    const timer = setTimeout(() => {
      void updateQuoteRef.current()
    }, 500)
    return () => clearTimeout(timer)
  }, [shouldShowQuote, selectedIndexPath, formData.tokenIn, formData.tokenOut, formData.slippage, formData.amountIn, formData.amountOut])

  // 处理输入变化
  const handleAmountChange = (field: 'amountIn' | 'amountOut', value: string) => {
    const regex = /^[0-9]*\.?[0-9]*$/
    if (value && !regex.test(value)) return

    setFormData(prev => ({ ...prev, [field]: value }))
    setIsExactInput(field === 'amountIn')

    // 清空另一侧
    if (field === 'amountIn') {
      if (!value || !Number.isFinite(parseFloat(value)) || parseFloat(value) <= 0) {
        setFormData(prev => ({ ...prev, amountOut: '' }))
        setQuoteError(null)
        // 清除之前的池子选择，让智能路由重新选择
        setSelectedPoolIndex(null)
      }
    } else {
      if (!value || !Number.isFinite(parseFloat(value)) || parseFloat(value) <= 0) {
        setFormData(prev => ({ ...prev, amountIn: '' }))
        setQuoteError(null)
        // 清除之前的池子选择，让智能路由重新选择
        setSelectedPoolIndex(null)
      }
    }
  }

  // 处理代币选择
  const handleTokenChange = (field: 'tokenIn' | 'tokenOut', value: string) => {
    setFormData(prev => ({ ...prev, [field]: value, amountIn: '', amountOut: '', poolIndex: 0 })) // ✅ 重置池子索引
    setQuoteError(null)
    setSelectedPoolIndex(null) // 切换代币时清空池子选择，让系统重新自动选择
    setShowPoolSelector(false)
  }

  // 处理池子选择
  const handlePoolSelect = (poolIndex: number) => {
    console.log(`\n===== User Selected Pool #${poolIndex} =====`)
    const pool = availablePools.find(p => p.index === poolIndex)
    if (pool) {
      console.log('Pool details:', {
        index: pool.index,
        priceRatio: pool.priceRatio,
        isPriceReasonable: pool.isPriceReasonable,
        liquidity: pool.liquidity.toString()
      })
    }
    setSelectedPoolIndex(poolIndex)
    setFormData(prev => ({ ...prev, poolIndex })) // ✅ 同步更新 formData.poolIndex
    setQuoteError(null) // 清除之前的错误
    setShowPoolSelector(false) // 关闭选择器

    // ✅ 修复：立即触发重新获取报价
    // 使用 setTimeout 确保状态已更新
    setTimeout(() => {
      updateQuoteRef.current()
    }, 100)
  }

  // 交换代币
  const handleSwitchTokens = () => {
    setFormData(prev => ({
      ...prev,
      tokenIn: prev.tokenOut,
      tokenOut: prev.tokenIn,
      amountIn: prev.amountOut,
      amountOut: prev.amountIn,
      poolIndex: 0, // ✅ 重置池子索引
    }))
    setIsExactInput(!isExactInput)
    setSelectedPoolIndex(null) // ✅ 清除手动选择的池子
    setQuoteError(null)
  }

  // 设置最大数量
  const handleMaxClick = () => {
    if (balanceIn) {
      setFormData(prev => ({
        ...prev,
        amountIn: formatUnits(balanceIn.value, balanceIn.decimals),
      }))
      setIsExactInput(true)
    }
  }

  // Approve
  const handleApprove = async () => {
    if (!formData.amountIn) return

    try {
      // ✅ 修复：ETH 需要授权 WETH
      const actualTokenIn = isNativeTokenAddress(formData.tokenIn)
        ? TOKENS.ETH.wrappedAddress
        : formData.tokenIn

      // ✅ 设置标记：授权成功后继续交易
      setPendingSwapAfterApprove(true)

      approveToken(actualTokenIn, formData.amountIn, getTokenDecimals(formData.tokenIn))
      // 注意：approveToken 内部会调用 writeContract，交易提交后会触发 isPending
      // ✅ 授权成功后会在 isConfirmed effect 中自动触发 swap
    } catch (error) {
      console.error('Approval failed:', error)
      message.error('Approve failed')
      setPendingSwapAfterApprove(false)  // 失败时清除标记
    }
  }

  // Swap
  const handleSwap = useCallback(async () => {
    if (!formData.amountIn || !formData.amountOut || !isConnected) return
    if (needsApprove) {
      setQuoteError('授权不足，请先点击 Approve')
      return
    }

    // 检查当前选择的池子是否价格合理
    const currentPool = availablePools.find(p => p.index === selectedPoolIndex)
    const betterPool = availablePools.find(p => p.isPriceReasonable)

    // 如果用户选择的是极端价格池子，但有价格合理的池子，使用合理的
    let poolIndexToUse = selectedPoolIndex

    if (currentPool && !currentPool.isPriceReasonable && betterPool) {
      console.log(`⚠️ 用户选择的池子 #${selectedPoolIndex} 价格极端，切换到池子 #${betterPool.index}`)
      poolIndexToUse = betterPool.index
      setSelectedPoolIndex(betterPool.index) // 更新状态
      setFormData(prev => ({ ...prev, poolIndex: betterPool.index })) // ✅ 同步更新
    }

    if (poolIndexToUse === null) {
      setQuoteError('未找到可用池子')
      return
    }

    console.log('\n===== Swap Transaction =====')
    console.log('Using pool index:', poolIndexToUse)
    console.log('User selected:', selectedPoolIndex)
    console.log('Better pool available:', betterPool?.index)
    console.log('Swap type:', isExactInput ? 'exactInput' : 'exactOutput')
    console.log('============================\n')

    try {
      executeSwap({
        tokenIn: formData.tokenIn,
        tokenOut: formData.tokenOut,
        amountIn: formData.amountIn,
        amountOut: formData.amountOut,  // ✅ 新增：传递 amountOut
        slippage: formData.slippage,
        indexPath: [poolIndexToUse], // 使用正确的池子索引
        tokenInDecimals: getTokenDecimals(formData.tokenIn),
        tokenOutDecimals: getTokenDecimals(formData.tokenOut),
        isExactInput: isExactInput,  // ✅ 新增：传递 swap 类型
        preloadedPools: availablePools,  // ✅ 新增：传递已查询的池子列表，避免重复查询
      })
      // 注意：executeSwap 内部会调用 writeContract，交易提交后会触发 isPending
      // 等待交易确认后在 isConfirmed effect 中处理
    } catch (error) {
      console.error('Swap failed:', error)
      const errorMsg = error instanceof Error ? error.message : 'Swap failed'
      setQuoteError(errorMsg)
      message.error(errorMsg)
    }
  }, [formData, needsApprove, availablePools, selectedPoolIndex, isConnected, executeSwap, getTokenDecimals, isExactInput, message])

  // ✅ 使用 ref 存储 handleSwap，避免循环依赖
  const handleSwapRef = useRef(handleSwap)
  handleSwapRef.current = handleSwap

  // 交易成功后刷新状态
  useEffect(() => {
    if (isConfirmed && hash) {
      console.log('Transaction confirmed:', hash)

      // 刷新授权状态
      refetchAllowance()

      // 刷新余额 - 延迟一下等待链上状态更新
      setTimeout(() => {
        refetchBalanceIn()
        refetchBalanceOut()
      }, 2000)

      // ✅ 如果是授权交易成功，等待 allowance 更新后继续 swap
      if (pendingSwapAfterApprove) {
        console.log('✅ Authorization confirmed, checking allowance...')
        // allowance 更新后会在另一个 effect 中触发 swap
      } else {
        // Swap 交易成功
        setFormData(prev => ({ ...prev, amountIn: '', amountOut: '' }))
        message.success('Transaction confirmed!')
      }
    }
  }, [isConfirmed, hash, refetchAllowance, refetchBalanceIn, refetchBalanceOut, pendingSwapAfterApprove])

  // ✅ 新增：监听 allowance 变化，自动触发 swap
  useEffect(() => {
    if (pendingSwapAfterApprove && allowance && formData.amountIn) {
      console.log('Checking allowance after approval...', formatUnits(allowance as bigint, 18))

      try {
        const amountWei = parseUnits(formData.amountIn, getTokenDecimals(formData.tokenIn))
        if (allowance >= amountWei) {
          console.log('✅ Allowance sufficient, triggering swap...')
          setPendingSwapAfterApprove(false)  // 清除标记

          // 自动触发 swap（使用 ref 避免循环依赖）
          setTimeout(() => {
            if (!needsApprove) {
              handleSwapRef.current()
            }
          }, 300)
        }
      } catch (error) {
        console.error('Error checking allowance:', error)
      }
    }
  }, [allowance, pendingSwapAfterApprove, formData.amountIn, formData.tokenIn, getTokenDecimals, needsApprove])

  // 准备代币选项
  const tokenOptions = useMemo(() => {
    return Object.entries(TOKENS).map(([key, token]) => ({
      label: `${token.symbol} - ${token.name}`,
      value: token.address,
    }))
  }, [])

  const priceImpact = calculatePriceImpact()

  // 校验是否可以执行swap
  const canSwap = useMemo(() => {
    if (!formData.tokenIn || !formData.tokenOut) return false
    if (!formData.amountIn || !formData.amountOut) return false
    if (isPending || isConfirming) return false
    if (isInsufficientBalance) return false
    if (selectedIndexPath.length === 0) return false
    if (needsApprove) return false
    return true
  }, [formData.tokenIn, formData.tokenOut, formData.amountIn, formData.amountOut, isPending, isConfirming, isInsufficientBalance, selectedIndexPath, needsApprove])

  return (
    <div className="max-w-xl mx-auto">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Swap</h2>
        </div>

        <div className="p-6 space-y-4">
          {/* Transaction Status */}
          {hash && (
            <div className={`p-4 rounded-lg ${
              isConfirming ? 'bg-blue-50 border border-blue-200' :
              isConfirmed ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'
            }`}>
              <div className="flex items-center space-x-2">
                {isPending && (
                  <span className="text-gray-600">等待钱包确认...</span>
                )}
                {isConfirming && (
                  <>
                    <Spin size="small" />
                    <span className="text-blue-600">交易确认中...</span>
                  </>
                )}
                {isConfirmed && (
                  <span className="text-green-600">✓ 交易成功！</span>
                )}
              </div>
              <div className="mt-2 text-sm text-gray-500">
                交易哈希: {hash.slice(0, 10)}...{hash.slice(-8)}
              </div>
            </div>
          )}

          {/* Token In */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">You Pay</label>
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <Select
                  value={formData.tokenIn}
                  onChange={(value) => handleTokenChange('tokenIn', value)}
                  placeholder="Select token"
                  className="w-48"
                  options={tokenOptions}
                  showSearch
                  optionFilterProp="label"
                />
                <div className="flex items-center gap-2">
                  {balanceIn && (
                    <span className="text-sm text-gray-500">
                      Balance: {formatUnits(balanceIn.value, balanceIn.decimals)}
                    </span>
                  )}
                  {balanceIn && balanceIn.value > 0 && (
                    <button
                      onClick={handleMaxClick}
                      className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded hover:bg-blue-200"
                    >
                      MAX
                    </button>
                  )}
                </div>
              </div>
              <Input
                value={formData.amountIn}
                onChange={(e) => handleAmountChange('amountIn', e.target.value)}
                placeholder={isQuoting && !isExactInput ? "价格估算中..." : "0.0"}
                size="large"
                className="text-2xl font-bold"
                status={isInsufficientBalance ? 'error' : undefined}
                disabled={isQuoting && isExactInput}
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  fontSize: '1.875rem',
                  fontWeight: 'bold',
                }}
              />
              {isQuoting && isExactInput && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  <Spin size="small" />
                </div>
              )}
              {isInsufficientBalance && (
                <p className="text-red-500 text-sm mt-1">
                  Insufficient balance. Available: {balanceIn ? formatUnits(balanceIn.value, balanceIn.decimals) : '0'}
                </p>
              )}
            </div>
          </div>

          {/* Switch Button */}
          <div className="flex justify-center -my-2 relative z-10">
            <button
              onClick={handleSwitchTokens}
              className="bg-blue-500 hover:bg-blue-600 rounded-full p-2.5 transition-colors shadow-md hover:shadow-lg"
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>

          {/* Token Out */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">You Receive</label>
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <Select
                  value={formData.tokenOut}
                  onChange={(value) => handleTokenChange('tokenOut', value)}
                  placeholder="Select token"
                  className="w-48"
                  options={tokenOptions}
                  showSearch
                  optionFilterProp="label"
                />
                {balanceOut && (
                  <span className="text-sm text-gray-500">
                    Balance: {formatUnits(balanceOut.value, balanceOut.decimals)}
                  </span>
                )}
              </div>
              <div className="relative">
                <Input
                  value={formData.amountOut}
                  onChange={(e) => handleAmountChange('amountOut', e.target.value)}
                  placeholder={isQuoting && isExactInput ? "价格估算中..." : "0.0"}
                  size="large"
                  className="text-2xl font-bold"
                  disabled={isQuoting && !isExactInput}
                  style={{
                    backgroundColor: 'transparent',
                    border: 'none',
                    fontSize: '1.875rem',
                    fontWeight: 'bold',
                  }}
                />
                {isQuoting && !isExactInput && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <Spin size="small" />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Pool Info - Only show when tokens are different and amount is entered */}
          {availablePoolsWithLiquidity.length > 0 && selectedPool &&
           formData.tokenIn !== formData.tokenOut &&
           (formData.amountIn || formData.amountOut) && (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
              {/* Header with status indicator */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${selectedPool.isPriceReasonable !== false ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  <span className="text-sm font-semibold text-gray-700">智能路由选择</span>
                </div>
                {selectedPool.isPriceReasonable !== false ? (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">✓ 价格合理</span>
                ) : (
                  <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">⚠ 极端价格</span>
                )}
              </div>

              {/* Pool details grid */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <div className="text-xs text-gray-500 mb-1">池子编号</div>
                  <div className="text-lg font-bold text-blue-600">#{selectedPool.index}</div>
                </div>
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <div className="text-xs text-gray-500 mb-1">手续费率</div>
                  <div className="text-lg font-bold text-blue-600">{(selectedPool.fee / 10000).toFixed(2)}%</div>
                </div>
              </div>

              {/* Price ratio */}
              <div className="bg-white rounded-lg p-3 shadow-sm mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">当前价格</span>
                  <button
                    onClick={() => setShowPoolSelector(!showPoolSelector)}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    切换池子 ({availablePoolsWithLiquidity.length}个可选)
                  </button>
                </div>
                <div className="text-sm font-medium text-gray-900">
                  {(() => {
                    if (!selectedPool) return <span className="text-gray-400">加载中...</span>

                    const token0Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === selectedPool.token0.toLowerCase())?.symbol || 'Token0'
                    const token1Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === selectedPool.token1.toLowerCase())?.symbol || 'Token1'

                    // 从 sqrtPriceX96 计算 priceRatio（如果不存在）
                    let priceRatio = selectedPool.priceRatio
                    if (!priceRatio && selectedPool.sqrtPriceX96) {
                      const sqrtPrice = Number(selectedPool.sqrtPriceX96) / (2 ** 96)
                      priceRatio = sqrtPrice ** 2
                    }

                    if (!priceRatio || !isFinite(priceRatio)) {
                      return <span className="text-gray-400">价格计算中...</span>
                    }

                    if (priceRatio > 1000000 || priceRatio < 0.000001) {
                      return (
                        <span className="text-yellow-600">
                          1 {token0Symbol} = {priceRatio.toExponential(2)} {token1Symbol}
                        </span>
                      )
                    } else if (priceRatio > 1000 || priceRatio < 0.001) {
                      return (
                        <span className="text-blue-600">
                          1 {token0Symbol} = {priceRatio.toFixed(6)} {token1Symbol}
                        </span>
                      )
                    } else {
                      return (
                        <span className="text-blue-600">
                          1 {token0Symbol} = {priceRatio.toFixed(4)} {token1Symbol}
                        </span>
                      )
                    }
                  })()}
                </div>
              </div>

              {/* Liquidity with better formatting */}
              <div className="bg-white rounded-lg p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">流动性深度</span>
                  <span className="text-sm font-bold text-gray-900">
                    {selectedPool && Number(selectedPool.liquidity) > 0
                      ? Number(selectedPool.liquidity) > 1e18
                        ? `${(Number(selectedPool.liquidity) / 1e18).toFixed(2)} P`
                        : Number(selectedPool.liquidity) > 1e15
                          ? `${(Number(selectedPool.liquidity) / 1e15).toFixed(2)} P`
                          : Number(selectedPool.liquidity) > 1e12
                            ? `${(Number(selectedPool.liquidity) / 1e12).toFixed(2)} T`
                            : Number(selectedPool.liquidity) > 1e9
                              ? `${(Number(selectedPool.liquidity) / 1e9).toFixed(2)} B`
                              : selectedPool.liquidity.toLocaleString()
                      : '0'}
                  </span>
                </div>
                {/* Liquidity bar visualization */}
                <div className="mt-2 bg-gray-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-blue-400 to-blue-600 h-full transition-all duration-500"
                    style={{
                      width: `${selectedPool && Number(selectedPool.liquidity) > 0
                        ? Math.min(100, Math.max(5, (Math.log10(Number(selectedPool.liquidity) + 1) / 25) * 100))
                        : 5}%`
                    }}
                  />
                </div>
              </div>

              {/* Quick stats */}
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="text-center">
                  <div className="text-xs text-gray-500">价格评分</div>
                  <div className="text-sm font-bold text-blue-600">
                    {selectedPool?.isPriceReasonable ? '40/40' : '0/40'}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500">流动性评分</div>
                  <div className="text-sm font-bold text-blue-600">
                    {selectedPool ? Math.min(30, (Number(selectedPool.liquidity) / 1e18) * 30).toFixed(0) : '0'}/30
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-500">综合得分</div>
                  <div className="text-sm font-bold text-green-600">
                    {selectedPool ? (
                      (
                        (selectedPool.isPriceReasonable ? 40 : 0) +
                        Math.min(30, (Number(selectedPool.liquidity) / 1e18) * 30) +
                        (selectedPool.fee < 1000 ? 5 : 0)
                      ).toFixed(0)
                    ) : '0'}/75
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Quote Error */}
          {quoteError && shouldShowQuote && (
            <div className={`rounded-lg p-3 ${
              quoteError.includes('⚠️')
                ? 'bg-yellow-50 border border-yellow-200'
                : 'bg-red-50 border border-red-200'
            }`}>
              <p className={`text-sm ${
                quoteError.includes('⚠️') ? 'text-yellow-800' : 'text-red-600'
              }`}>
                {quoteError}
              </p>
            </div>
          )}

          {/* Pool Selector - Only show when there's an extreme price warning */}
          {showPoolSelector && availablePoolsWithLiquidity.length > 1 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-blue-900">选择其他池子</h4>
                <button
                  onClick={() => setShowPoolSelector(false)}
                  className="text-blue-600 hover:text-blue-800 text-sm"
                >
                  关闭
                </button>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {availablePoolsWithLiquidity.map((pool, idx) => {
                  const token0Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === pool.token0.toLowerCase())?.symbol || 'Token0'
                  const token1Symbol = Object.values(TOKENS).find(t => t.address.toLowerCase() === pool.token1.toLowerCase())?.symbol || 'Token1'
                  const isSelected = selectedPoolIndex === pool.index

                  // 使用token地址和index的组合作为唯一key
                  const uniqueKey = `${pool.token0}-${pool.token1}-${pool.index}`

                  return (
                    <button
                      key={uniqueKey}
                      onClick={() => handlePoolSelect(pool.index)}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        isSelected
                          ? 'bg-blue-100 border-2 border-blue-500'
                          : 'bg-white border border-gray-200 hover:bg-gray-50'
                      } ${!pool.isPriceReasonable ? 'border-l-4 border-l-yellow-500' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-sm">
                            Pool #{pool.index}
                            {isSelected && <span className="ml-2 text-blue-600">(当前选择)</span>}
                          </div>
                          <div className="text-xs text-gray-600 mt-1">
                            价格: 1 {token0Symbol} = {pool.priceRatio.toFixed(6)} {token1Symbol}
                          </div>
                          <div className="text-xs text-gray-500">
                            流动性: {Number(pool.liquidity).toLocaleString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-medium">
                            费率: {(pool.fee / 10000).toFixed(2)}%
                          </div>
                          {!pool.isPriceReasonable && (
                            <div className="text-xs text-yellow-600 mt-1">⚠️ 极端价格</div>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Slippage Settings */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-2">Slippage Tolerance</label>
            <div className="flex space-x-2">
              {[0.1, 0.5, 1.0, 3.0].map((slip) => (
                <Button
                  key={slip}
                  type={formData.slippage === slip ? 'primary' : 'default'}
                  onClick={() => setFormData(prev => ({ ...prev, slippage: slip }))}
                  size="small"
                >
                  {slip}%
                </Button>
              ))}
              <Input
                type="number"
                value={formData.slippage}
                onChange={(e) => setFormData(prev => ({ ...prev, slippage: parseFloat(e.target.value) || 0 }))}
                className="w-20"
                size="small"
                placeholder="Custom"
              />
            </div>
          </div>

          {/* Trade Details */}
          {formData.amountIn && formData.amountOut && (
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Minimum Received</span>
                <span className="text-sm font-medium">{getMinimumOutput()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Price Impact</span>
                <span className={`text-sm font-medium ${
                  priceImpact && priceImpact > 5 ? 'text-red-500' :
                  priceImpact && priceImpact > 2 ? 'text-yellow-500' : 'text-green-500'
                }`}>
                  {priceImpact ? `${priceImpact.toFixed(2)}%` : '-'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Slippage</span>
                <span className="text-sm font-medium">{formData.slippage}%</span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2 pt-2">
            {!isConnected ? (
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <p className="text-gray-500">请先连接钱包</p>
              </div>
            ) : needsApprove ? (
              <Button
                size="large"
                block
                onClick={handleApprove}
                disabled={isPending || isConfirming || !formData.amountIn}
                type="primary"
                ghost
              >
                {isPending || isConfirming ? '处理中...' : `授权 ${Object.values(TOKENS).find(t => t.address === formData.tokenIn)?.symbol || 'Token'}`}
              </Button>
            ) : (
              <Button
                type="primary"
                size="large"
                block
                onClick={handleSwap}
                disabled={!canSwap}
              >
                {isPending || isConfirming ? '交换中...' : '交换'}
              </Button>
            )}
          </div>

          {/* No Pools Available - Only show when user has entered an amount */}
          {formData.tokenIn &&
           formData.tokenOut &&
           formData.tokenIn !== formData.tokenOut &&
           availablePoolsWithLiquidity.length === 0 &&  // 改为检查有流动性的池子
           (formData.amountIn || formData.amountOut) && (
            <div className="bg-linear-to-r from-yellow-50 to-orange-50 border-2 border-yellow-300 rounded-xl p-6 shadow-md">
              <div className="flex items-start gap-3 mb-4">
                <div className="text-3xl">💧</div>
                <div>
                  <h3 className="text-lg font-semibold text-yellow-900 mb-1">
                    No Liquidity Pool Available
                  </h3>
                  <p className="text-yellow-700 text-sm">
                    There's no pool for this trading pair yet. You can create one and become the first liquidity provider!
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => setShowCreatePoolModal(true)}
                  className="flex-1 bg-linear-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-6 py-3 rounded-lg font-semibold transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
                >
                  <span className="text-xl">+</span>
                  Create Pool & Add Liquidity
                </button>

                <Link
                  href="/pool"
                  className="flex-1 bg-white hover:bg-gray-50 text-gray-700 px-6 py-3 rounded-lg font-medium transition-colors border border-gray-300 hover:border-gray-400 flex items-center justify-center gap-2"
                >
                  <span>📋</span>
                  View All Pools
                </Link>
              </div>

              <div className="mt-4 pt-4 border-t border-yellow-200">
                <p className="text-xs text-yellow-600">
                  💡 <strong>Tip:</strong> By creating a pool, you'll earn trading fees from all swaps in this pair. Make sure to set a reasonable initial price based on market conditions.
                </p>
              </div>
            </div>
          )}

          {/* Create Pool Modal */}
          {showCreatePoolModal && (
            <CreatePoolModal
              onClose={() => setShowCreatePoolModal(false)}
              initialToken0={formData.tokenIn}
              initialToken1={formData.tokenOut}
            />
          )}

          {/* Same Token Warning */}
          {formData.tokenIn && formData.tokenOut && formData.tokenIn === formData.tokenOut && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-gray-600 text-sm">
                Please select different tokens to swap.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}