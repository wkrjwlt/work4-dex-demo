'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAccount, useBalance, useReadContract, usePublicClient } from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import { TOKENS, isNativeTokenAddress, toChainTokenAddress, CONTRACTS } from '@/lib/constants'
import { POOL_MANAGER_ABI } from '@/lib/contracts'
import { Modal, Form, Input, Select, Button, App } from 'antd'
import React from 'react'
import { useLiquidity } from '@/hooks/useLiquidity'

interface AddLiquidityModalProps {
  onClose: () => void
  initialToken0?: string  // 预填充 token0
  initialToken1?: string  // 预填充 token1
  onSuccess?: () => void  // ✅ 新增：交易成功后的回调
}

interface PoolInfo {
  pool: string
  token0: string
  token1: string
  index: number
  fee: number
  feeProtocol: number
  tickLower: number
  tickUpper: number
  tick: number
  sqrtPriceX96: bigint
  liquidity: bigint
}

export function AddLiquidityModal({ onClose, initialToken0, initialToken1, onSuccess }: AddLiquidityModalProps) {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const [form] = Form.useForm()
  const { message } = App.useApp() // 使用 antd App 的 message API

  // 当打开弹窗时，自动填充代币
  useEffect(() => {
    if (initialToken0 || initialToken1) {
      // ✅ 将 WETH 地址转换为 ETH 地址（让用户看到更友好的 ETH 而不是 WETH 地址）
      const WETH_SEPOLIA = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14'
      const WETH_MAINNET = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
      const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

      const convertWethToEth = (address: string) => {
        if (!address) return address
        // 如果是 WETH 地址（主网或 Sepolia），转换为 ETH 地址
        if (address.toLowerCase() === WETH_SEPOLIA.toLowerCase() ||
            address.toLowerCase() === WETH_MAINNET.toLowerCase()) {
          return ETH_ADDRESS
        }
        return address
      }

      form.setFieldsValue({
        token0: convertWethToEth(initialToken0 || ''),
        token1: convertWethToEth(initialToken1 || ''),
      })
    }
  }, [initialToken0, initialToken1, form])

  // 使用自定义 liquidity hook
  const {
    addLiquidity,
    approveToken,
    useTokenAllowance,
    isPending,
    isConfirming,
    isConfirmed,
    hash,
  } = useLiquidity()

  const [availablePools, setAvailablePools] = useState<PoolInfo[]>([])
  const [needsApproval0, setNeedsApproval0] = useState(false)
  const [needsApproval1, setNeedsApproval1] = useState(false)
  const [pendingAddLiquidityAfterApprove, setPendingAddLiquidityAfterApprove] = useState(false) // ✅ 新增：标记授权后是否需要继续添加流动性

  // 监听表单中的代币选择
  const token0 = Form.useWatch('token0', form)
  const token1 = Form.useWatch('token1', form)
  const amount0 = Form.useWatch('amount0', form)
  const amount1 = Form.useWatch('amount1', form)
  const poolIndex = Form.useWatch('poolIndex', form)

  // 当选择交易对后，自动查询该交易对的所有池子
  useEffect(() => {
    const queryPoolsForPair = async () => {
      if (!token0 || !token1 || !publicClient) {
        setAvailablePools([])
        return
      }

      console.log('\n===== Querying Pools for Token Pair =====')
      console.log('Token0:', token0)
      console.log('Token1:', token1)

      try {
        // ✅ 优化：使用 getAllPools() 一次性获取所有池子
        console.log('🔄 Fetching all pools from contract...')
        const startTime = Date.now()

        const allPools = await publicClient.readContract({
          address: CONTRACTS.POOL_MANAGER as `0x${string}`,
          abi: POOL_MANAGER_ABI,
          functionName: 'getAllPools',
        })

        const fetchTime = Date.now() - startTime
        console.log(`✅ Got ${allPools.length} pools in ${fetchTime}ms`)

        // 将 ETH 地址转换为 WETH 地址
        const WETH_SEPOLIA = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14'
        const WETH_MAINNET = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
        const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

        const normalizeAddress = (addr: string) => {
          if (addr.toLowerCase() === ETH_ADDRESS.toLowerCase()) {
            return WETH_SEPOLIA.toLowerCase()
          }
          return addr.toLowerCase()
        }

        const normalizedToken0 = normalizeAddress(token0)
        const normalizedToken1 = normalizeAddress(token1)

        // 前端过滤特定代币对的池子
        const foundPools: PoolInfo[] = allPools
          .filter((pool: any) => {
            const matchNormal =
              pool.token0.toLowerCase() === normalizedToken0 &&
              pool.token1.toLowerCase() === normalizedToken1
            const matchReverse =
              pool.token0.toLowerCase() === normalizedToken1 &&
              pool.token1.toLowerCase() === normalizedToken0
            return matchNormal || matchReverse
          })
          .map((pool: any) => ({
            pool: pool.pool,
            token0: pool.token0,
            token1: pool.token1,
            index: Number(pool.index),
            fee: Number(pool.fee),
            feeProtocol: Number(pool.feeProtocol) || 0,
            tickLower: Number(pool.tickLower) || 0,
            tickUpper: Number(pool.tickUpper) || 0,
            tick: Number(pool.tick) || 0,
            sqrtPriceX96: pool.sqrtPriceX96,
            liquidity: pool.liquidity,
          }))

        console.log(`✅ Found ${foundPools.length} pools for this pair`)
        foundPools.forEach((pool) => {
          console.log(`  Pool #${pool.index}: Fee=${(pool.fee/10000).toFixed(2)}%, Liquidity=${pool.liquidity.toString()}`)
        })

        setAvailablePools(foundPools)
      } catch (error) {
        console.error('❌ Failed to fetch pools:', error)
        setAvailablePools([])
      }
    }

    queryPoolsForPair()
  }, [token0, token1, publicClient])

  // 获取代币信息
  const getTokenDecimals = useCallback((address: string) => {
    const token = Object.values(TOKENS).find(t => t.address.toLowerCase() === address.toLowerCase())
    return token?.decimals || 18
  }, [])

  // 获取代币余额
  const { data: balance0 } = useBalance({
    address: address,
    // ETH 不传 token 参数，WETH/其他代币传 token 地址
    token: token0 && !isNativeTokenAddress(token0) ? token0 as `0x${string}` : undefined,
  })

  const { data: balance1 } = useBalance({
    address: address,
    // ETH 不传 token 参数，WETH/其他代币传 token 地址
    token: token1 && !isNativeTokenAddress(token1) ? token1 as `0x${string}` : undefined,
  })

  // 获取授权状态
  const { data: allowance0, refetch: refetchAllowance0 } = useTokenAllowance(
    token0 && !isNativeTokenAddress(token0) ? token0 : '',
    CONTRACTS.POSITION_MANAGER
  )

  const { data: allowance1, refetch: refetchAllowance1 } = useTokenAllowance(
    token1 && !isNativeTokenAddress(token1) ? token1 : '',
    CONTRACTS.POSITION_MANAGER
  )

  // 检查是否需要授权
  useEffect(() => {
    const checkApproval = async () => {
      if (!token0 || !token1 || !amount0 || !amount1) {
        setNeedsApproval0(false)
        setNeedsApproval1(false)
        return
      }

      const decimals0 = getTokenDecimals(token0)
      const decimals1 = getTokenDecimals(token1)
      const amount0Wei = parseUnits(amount0, decimals0)
      const amount1Wei = parseUnits(amount1, decimals1)

      setNeedsApproval0(
        !isNativeTokenAddress(token0) &&
        allowance0 !== undefined &&
        allowance0 < amount0Wei
      )

      setNeedsApproval1(
        !isNativeTokenAddress(token1) &&
        allowance1 !== undefined &&
        allowance1 < amount1Wei
      )
    }

    checkApproval()
  }, [token0, token1, amount0, amount1, allowance0, allowance1, getTokenDecimals])

  // ✅ 新增：监听授权状态变化，自动继续添加流动性
  useEffect(() => {
    if (pendingAddLiquidityAfterApprove && allowance0 !== undefined && allowance1 !== undefined) {
      if (!amount0 || !amount1) return

      const decimals0 = getTokenDecimals(token0)
      const decimals1 = getTokenDecimals(token1)
      const amount0Wei = parseUnits(amount0, decimals0)
      const amount1Wei = parseUnits(amount1, decimals1)

      // 检查两个代币是否都已授权
      const token0Approved = isNativeTokenAddress(token0) || allowance0 >= amount0Wei
      const token1Approved = isNativeTokenAddress(token1) || allowance1 >= amount1Wei

      if (token0Approved && token1Approved) {
        console.log('✅ Authorization confirmed, continuing with add liquidity...')
        setPendingAddLiquidityAfterApprove(false)

        // 延迟一小段时间让状态更新
        setTimeout(() => {
          // 触发表单提交
          form.submit()
        }, 300)
      }
    }
  }, [allowance0, allowance1, pendingAddLiquidityAfterApprove, amount0, amount1, token0, token1, form, getTokenDecimals])

  // 刷新授权状态和成功回调
  useEffect(() => {
    if (isConfirmed) {
      // 刷新授权状态
      refetchAllowance0()
      refetchAllowance1()

      // ✅ 只有在不是授权后自动继续的情况下才调用成功回调和关闭弹窗
      if (!pendingAddLiquidityAfterApprove) {
        // ✅ 调用成功回调（用于刷新池子列表）
        if (onSuccess) {
          onSuccess()
        }

        // ✅ 延迟关闭弹窗，让用户看到成功状态
        const timer = setTimeout(() => {
          onClose()
        }, 1500) // 1.5秒后关闭

        return () => clearTimeout(timer)
      }
    }
  }, [isConfirmed, refetchAllowance0, refetchAllowance1, onClose, onSuccess, pendingAddLiquidityAfterApprove])

  // 处理授权
  const handleApprove = async (tokenAddress: string, amount: string) => {
    if (!amount) return
    try {
      await approveToken(tokenAddress, amount, getTokenDecimals(tokenAddress), CONTRACTS.POSITION_MANAGER)
      message.success('Approve transaction submitted!')
      setPendingAddLiquidityAfterApprove(true) // ✅ 标记授权后需要继续添加流动性
    } catch (error) {
      console.error('Approve failed:', error)
      message.error('Approve failed')
    }
  }

  // 处理提交
  const handleSubmit = async (values: any) => {
    if (!address || !isConnected) {
      message.error('Please connect wallet first')
      return
    }

    if (!values.token0 || !values.token1 || !values.amount0 || !values.amount1 || !values.poolIndex) {
      message.error('Please fill in all fields')
      return
    }

    // ✅ 移除了 ETH 检查，现在支持自动包装 ETH
    // 用户可以直接选择 ETH，系统会自动将其包装为 WETH

    // 从 poolOptions 中找到对应的池子信息
    const selectedPoolOption = poolOptions.find(opt => opt.value === values.poolIndex)
    if (!selectedPoolOption || !selectedPoolOption.pool) {
      message.error(`Invalid pool selection. Please select a valid pool from the list.`)
      return
    }

    const selectedPool = selectedPoolOption.pool

    console.log('\n===== Add Liquidity Debug =====')
    console.log('Available pools count:', availablePools.length)
    console.log('Available pools:', availablePools.length)
    console.log('Selected pool address:', values.poolIndex)
    console.log('Selected pool details:', selectedPool)
    console.log('User selected token0:', values.token0)
    console.log('User selected token1:', values.token1)
    console.log('Pool actual token0:', selectedPool.token0)
    console.log('Pool actual token1:', selectedPool.token1)
    console.log('================================\n')

    try {
      await addLiquidity({
        token0: values.token0,
        token1: values.token1,
        amount0: values.amount0,
        amount1: values.amount1,
        poolIndex: selectedPool.index,
        token0Decimals: getTokenDecimals(values.token0),
        token1Decimals: getTokenDecimals(values.token1),
      })
      message.success('Add liquidity transaction submitted!')
    } catch (error: any) {
      console.error('Add liquidity failed:', error)

      // 特殊错误处理
      let errorMessage = 'Add liquidity failed'
      if (error?.message?.includes('array out-of-bounds') || error?.message?.includes('Array index is out of bounds')) {
        errorMessage = '池子索引无效。池子数据可能已过期，请刷新页面后重试。如果问题持续，请检查池子是否真实存在。'
      } else if (error instanceof Error) {
        errorMessage = error.message
      }

      message.error(errorMessage)
    }
  }

  // 准备代币选项
  const tokenOptions = useMemo(() => {
    return Object.entries(TOKENS).map(([key, token]) => ({
      label: `${token.symbol} - ${token.name}`,
      value: token.address,
    }))
  }, [])

  // 准备池子选项
  const poolOptions = useMemo(() => {
    // 优先排序：存储 WETH 地址的池子排在前面
    const sortedPools = [...availablePools].sort((a, b) => {
      // 检查是否存储 WETH 地址（支持主网和 Sepolia）
      const WETH_SEPOLIA = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14'
      const WETH_MAINNET = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

      const aHasWeth = a.token0.toLowerCase() === WETH_SEPOLIA.toLowerCase() ||
                       a.token0.toLowerCase() === WETH_MAINNET.toLowerCase() ||
                       a.token1.toLowerCase() === WETH_SEPOLIA.toLowerCase() ||
                       a.token1.toLowerCase() === WETH_MAINNET.toLowerCase()
      const bHasWeth = b.token0.toLowerCase() === WETH_SEPOLIA.toLowerCase() ||
                       b.token0.toLowerCase() === WETH_MAINNET.toLowerCase() ||
                       b.token1.toLowerCase() === WETH_SEPOLIA.toLowerCase() ||
                       b.token1.toLowerCase() === WETH_MAINNET.toLowerCase()

      // WETH 池子优先
      if (aHasWeth && !bHasWeth) return -1
      if (!aHasWeth && bHasWeth) return 1

      // 都有 WETH 或都没有，按地址排序（避免重复 index）
      return a.pool.localeCompare(b.pool)
    })

    return sortedPools.map((pool, idx) => {
      // 支持 ETH 和 WETH 的匹配（显示为 ETH）
      const WETH_SEPOLIA = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14'
      const WETH_MAINNET = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

      const token0Symbol = Object.values(TOKENS).find(t => {
        const poolToken0 = pool.token0.toLowerCase()
        const checkAddress = t.address.toLowerCase()
        const wrappedAddress = 'wrappedAddress' in t && typeof t.wrappedAddress === 'string'
          ? t.wrappedAddress.toLowerCase()
          : null

        // 特殊处理 ETH/WETH（支持主网和 Sepolia）
        if (t.symbol === 'ETH') {
          const ethAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
          return poolToken0 === ethAddress ||
                 poolToken0 === WETH_SEPOLIA.toLowerCase() ||
                 poolToken0 === WETH_MAINNET.toLowerCase()
        }

        return poolToken0 === checkAddress || (wrappedAddress && poolToken0 === wrappedAddress)
      })?.symbol || 'Token0'

      const token1Symbol = Object.values(TOKENS).find(t => {
        const poolToken1 = pool.token1.toLowerCase()
        const checkAddress = t.address.toLowerCase()
        const wrappedAddress = 'wrappedAddress' in t && typeof t.wrappedAddress === 'string'
          ? t.wrappedAddress.toLowerCase()
          : null

        // 特殊处理 ETH/WETH（支持主网和 Sepolia）
        if (t.symbol === 'ETH') {
          const ethAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
          return poolToken1 === ethAddress ||
                 poolToken1 === WETH_SEPOLIA.toLowerCase() ||
                 poolToken1 === WETH_MAINNET.toLowerCase()
        }

        return poolToken1 === checkAddress || (wrappedAddress && poolToken1 === wrappedAddress)
      })?.symbol || 'Token1'

      const hasLiquidity = pool.liquidity > 0

      // 检查是否存储 WETH 地址
      const hasWethAddress = pool.token0.toLowerCase() === WETH_SEPOLIA.toLowerCase() ||
                             pool.token0.toLowerCase() === WETH_MAINNET.toLowerCase() ||
                             pool.token1.toLowerCase() === WETH_SEPOLIA.toLowerCase() ||
                             pool.token1.toLowerCase() === WETH_MAINNET.toLowerCase()
      const addressType = hasWethAddress ? '(WETH)' : '(ETH-legacy)'

      return {
        label: `Pool #${pool.index} - ${token0Symbol}/${token1Symbol} - Fee: ${(pool.fee / 10000).toFixed(2)}% ${hasLiquidity ? '' : '(No Liquidity)'} ${addressType}`,
        // 使用池子地址作为 value，确保唯一性
        value: pool.pool,
        key: `pool-${pool.pool}`,
        pool, // 保存完整的池子信息
      }
    })
  }, [availablePools])

  // 检查余额是否足够
  const hasInsufficientBalance0 = useMemo(() => {
    if (!balance0 || !amount0) return false
    try {
      return parseUnits(amount0, getTokenDecimals(token0)) > balance0.value
    } catch {
      return false
    }
  }, [balance0, amount0, token0, getTokenDecimals])

  const hasInsufficientBalance1 = useMemo(() => {
    if (!balance1 || !amount1) return false
    try {
      return parseUnits(amount1, getTokenDecimals(token1)) > balance1.value
    } catch {
      return false
    }
  }, [balance1, amount1, token1, getTokenDecimals])

  // 按钮状态
  const canSubmit = useMemo(() => {
    return (
      isConnected &&
      token0 &&
      token1 &&
      amount0 &&
      amount1 &&
      poolIndex !== undefined &&
      !hasInsufficientBalance0 &&
      !hasInsufficientBalance1 &&
      !needsApproval0 &&
      !needsApproval1 &&
      !isPending &&
      !isConfirming
    )
  }, [isConnected, token0, token1, amount0, amount1, poolIndex, hasInsufficientBalance0, hasInsufficientBalance1, needsApproval0, needsApproval1, isPending, isConfirming])

  return (
    <Modal
      title="Add Liquidity"
      open={true}
      onCancel={onClose}
      footer={null}
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        className="mt-4"
      >
        {/* Transaction Status */}
        {hash && (
          <div className={`p-4 rounded-lg mb-4 ${
            isConfirming ? 'bg-blue-50 border border-blue-200' :
            isConfirmed ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'
          }`}>
            <div className="flex items-center space-x-2">
              {isPending && (
                <span className="text-gray-600">等待钱包确认...</span>
              )}
              {isConfirming && (
                <span className="text-blue-600">交易确认中...</span>
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

        {/* Token Selection */}
        <div className="grid grid-cols-2 gap-4">
          <Form.Item
            label="Token 0"
            name="token0"
            rules={[{ required: true, message: 'Please select token 0' }]}
          >
            <Select
              placeholder="Select token"
              options={tokenOptions}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item
            label="Token 1"
            name="token1"
            rules={[{ required: true, message: 'Please select token 1' }]}
          >
            <Select
              placeholder="Select token"
              options={tokenOptions}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
        </div>

        {/* Pool Selection */}
        {token0 && token1 && availablePools.length > 0 && (
          <div className="space-y-2">
            <div className="bg-green-50 border border-green-200 rounded-lg p-2 text-xs text-green-800">
              ✓ 找到 {availablePools.length} 个匹配的池子
              {availablePools.filter((p: PoolInfo) => p.liquidity > 0).length === 0 && (
                <span className="text-orange-600 ml-2">
                  ⚠️ 所有池子都没有流动性，你将是第一个添加流动性的用户
                </span>
              )}
            </div>
            <Form.Item
              label="Select Pool"
              name="poolIndex"
              rules={[{ required: true, message: 'Please select a pool' }]}
            >
              <Select
                placeholder="Select pool"
                options={poolOptions}
              />
            </Form.Item>
          </div>
        )}

        {/* Amount Input */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Amount 0</label>
              {balance0 && (
                <span className="text-sm text-gray-500">
                  Balance: {formatUnits(balance0.value, balance0.decimals)}
                </span>
              )}
            </div>
            <Form.Item
              name="amount0"
              rules={[{ required: true, message: 'Please enter amount 0' }]}
              className="mb-0"
            >
              <Input
                placeholder="0.0"
                type="number"
                size="large"
                status={hasInsufficientBalance0 ? 'error' : undefined}
              />
            </Form.Item>
            {hasInsufficientBalance0 && (
              <p className="text-red-500 text-xs mt-1">Insufficient balance</p>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Amount 1</label>
              {balance1 && (
                <span className="text-sm text-gray-500">
                  Balance: {formatUnits(balance1.value, balance1.decimals)}
                </span>
              )}
            </div>
            <Form.Item
              name="amount1"
              rules={[{ required: true, message: 'Please enter amount 1' }]}
              className="mb-0"
            >
              <Input
                placeholder="0.0"
                type="number"
                size="large"
                status={hasInsufficientBalance1 ? 'error' : undefined}
              />
            </Form.Item>
            {hasInsufficientBalance1 && (
              <p className="text-red-500 text-xs mt-1">Insufficient balance</p>
            )}
          </div>
        </div>

        {/* Price Range Info */}
        {availablePools.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <p className="text-blue-800 text-sm">
              This pool has a fixed price range. Your liquidity will be added within this range.
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-2 pt-2">
          {!isConnected ? (
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-gray-500">请先连接钱包</p>
            </div>
          ) : (
            <>
              {needsApproval0 && token0 && amount0 && (
                <Button
                  size="large"
                  block
                  onClick={() => handleApprove(token0, amount0)}
                  disabled={isPending || isConfirming || hasInsufficientBalance0}
                  type="primary"
                  ghost
                >
                  {isPending || isConfirming ? 'Approving...' : `Approve ${Object.values(TOKENS).find(t => t.address === token0)?.symbol || 'Token 0'}`}
                </Button>
              )}

              {needsApproval1 && token1 && amount1 && (
                <Button
                  size="large"
                  block
                  onClick={() => handleApprove(token1, amount1)}
                  disabled={isPending || isConfirming || hasInsufficientBalance1}
                  type="primary"
                  ghost
                >
                  {isPending || isConfirming ? 'Approving...' : `Approve ${Object.values(TOKENS).find(t => t.address === token1)?.symbol || 'Token 1'}`}
                </Button>
              )}

              <Button
                type="primary"
                size="large"
                block
                htmlType="submit"
                loading={isPending || isConfirming}
                disabled={!canSubmit}
              >
                {isPending || isConfirming ? 'Processing...' : 'Add Liquidity'}
              </Button>
            </>
          )}
        </div>

        {/* No Pools Available */}
        {token0 && token1 && token0 !== token1 && availablePools.length === 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-4">
            <p className="text-yellow-800 font-medium mb-2">⚠️ 没有找到匹配的池子</p>
            <p className="text-yellow-700 text-sm mb-3">
              这个代币对还没有创建池子。你需要先创建池子才能添加流动性。
            </p>
            <Button
              type="primary"
              onClick={onClose}
              className="bg-yellow-600 hover:bg-yellow-700 border-yellow-600 hover:border-yellow-700"
            >
              去创建池子
            </Button>
          </div>
        )}

        {/* Pool List Available but Index Invalid */}
        {token0 && token1 && availablePools.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
            <p className="text-green-800 text-sm">
              ✓ 找到 {availablePools.length} 个匹配的池子，请选择一个池子
            </p>
          </div>
        )}
      </Form>
    </Modal>
  )
}