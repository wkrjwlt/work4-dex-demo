'use client'

import { useState, useEffect, useMemo } from 'react'
import { useWriteContract, useAccount, useReadContract, usePublicClient, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import { POOL_MANAGER_ABI, ERC20_ABI } from '@/lib/contracts'
import { TOKENS, CONTRACTS, isNativeTokenAddress } from '@/lib/constants'
import { Modal, Form, Input, Select, Button, Tooltip, Switch } from 'antd'
import React from 'react'

interface CreatePoolModalProps {
  onClose: () => void
  initialToken0?: string  // 可选：预填充token0
  initialToken1?: string  // 可选：预填充token1
  onSuccess?: () => void  // 可选：创建成功后的回调
}

// Gas限制常量
const GAS_LIMIT_CAP = 16_000_000n
const CREATE_POOL_GAS_FALLBACK = 2_000_000n

export function CreatePoolModal({ onClose, initialToken0, initialToken1, onSuccess }: CreatePoolModalProps) {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContract, data: hash, isPending } = useWriteContract()
  const [form] = Form.useForm()
  const [addLiquidity, setAddLiquidity] = useState(false) // 是否同时添加流动性
  const [estimatedGasCost, setEstimatedGasCost] = useState<string>('') // 预估 gas 费用
  const [error, setError] = useState<string>('') // 错误信息
  const [submitting, setSubmitting] = useState(false) // 提交状态

  // 等待交易确认
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  // 监听交易确认成功
  useEffect(() => {
    if (isConfirmed && hash) {
      console.log('✅ Pool creation transaction confirmed:', hash)

      // 调用成功回调（如果存在）
      if (onSuccess) {
        onSuccess()
      }

      // 延迟关闭，让用户看到成功状态
      const timer = setTimeout(() => {
        onClose()
      }, 1500)

      return () => clearTimeout(timer)
    }
  }, [isConfirmed, hash, onSuccess, onClose])

  // 当代币选择改变时，预估 gas 费用
  useEffect(() => {
    const estimateGasCost = async () => {
      if (!publicClient || !address) return

      const values = form.getFieldsValue()
      if (!values.token0 || !values.token1 || !values.sqrtPriceX96) return

      try {
        // 获取当前 gas price
        const gasPrice = await publicClient.getGasPrice()

        // 估算 gas limit
        const gasLimit = await estimateGasWithCap({
          address: CONTRACTS.POOL_MANAGER as `0x${string}`,
          abi: POOL_MANAGER_ABI,
          functionName: 'createAndInitializePoolIfNecessary',
          args: [
            {
              token0: values.token0 as `0x${string}`,
              token1: values.token1 as `0x${string}`,
              fee: values.fee || 500,
              tickLower: parseInt(values.tickLower || '-887220'),
              tickUpper: parseInt(values.tickUpper || '887220'),
              sqrtPriceX96: parseUnits(values.sqrtPriceX96, 0),
            }
          ],
          fallbackGas: CREATE_POOL_GAS_FALLBACK,
        })

        // 计算预估费用 (gas price * gas limit)
        const estimatedCost = gasPrice * gasLimit
        const estimatedCostInEth = formatUnits(estimatedCost, 18)

        setEstimatedGasCost(estimatedCostInEth)
        console.log('Estimated gas cost:', estimatedCostInEth, 'ETH')
      } catch (error) {
        console.warn('Failed to estimate gas cost:', error)
      }
    }

    estimateGasCost()
  }, [form, publicClient, address])

  // Gas估算优化
  const estimateGasWithCap = async (request: {
    address: `0x${string}`
    abi: readonly unknown[]
    functionName: string
    args?: readonly unknown[]
    fallbackGas: bigint
  }) => {
    if (!publicClient || !address) return request.fallbackGas
    try {
      const estimated = await publicClient.estimateContractGas({
        address: request.address,
        abi: request.abi as any,
        functionName: request.functionName as any,
        args: request.args as any,
        account: address as `0x${string}`,
      })
      // 加20%缓冲
      const buffered = (estimated * 12n) / 10n
      return buffered > GAS_LIMIT_CAP ? GAS_LIMIT_CAP : buffered
    } catch (error) {
      console.warn(`Gas estimate failed for ${request.functionName}, fallback to ${request.fallbackGas.toString()}`, error)
      return request.fallbackGas
    }
  }

  // 监听代币选择，计算初始价格建议
  const token0 = Form.useWatch('token0', form)
  const token1 = Form.useWatch('token1', form)

  // 当模态框打开时，如果有初始代币，自动填充
  useEffect(() => {
    if (initialToken0 || initialToken1) {
      form.setFieldsValue({
        token0: initialToken0,
        token1: initialToken1,
      })
    }
  }, [initialToken0, initialToken1, form])

  // 获取代币decimals
  const getTokenDecimals = (tokenAddress: string) => {
    const token = Object.values(TOKENS).find(t => t.address.toLowerCase() === tokenAddress?.toLowerCase())
    return token?.decimals || 18
  }

  // 价格模式：simple（实际价格）或 raw（sqrtPriceX96）
  const [priceMode, setPriceMode] = useState<'simple' | 'raw'>('simple')
  const [simplePrice, setSimplePrice] = useState<string>('1')

  // 初始化时设置默认价格
  useEffect(() => {
    const defaultPrice = calculateSqrtPriceX96('1')
    if (defaultPrice) {
      form.setFieldValue('sqrtPriceX96', defaultPrice)
    }
  }, [])

  // 计算sqrtPriceX96（高精度版本）
  const calculateSqrtPriceX96 = (price: string) => {
    const priceNum = parseFloat(price)
    if (isNaN(priceNum) || priceNum <= 0) return ''

    // sqrtPriceX96 = sqrt(price) * 2^96
    const sqrtPrice = Math.sqrt(priceNum)
    const Q96 = BigInt(2) ** BigInt(96)  // 79228162514264337593543950336

    // 使用分离整数和小数部分的方法避免精度损失
    const sqrtPriceInt = Math.floor(sqrtPrice)
    const sqrtPriceFrac = sqrtPrice - sqrtPriceInt

    // 整数部分直接相乘
    const intPart = BigInt(sqrtPriceInt) * Q96

    // 小数部分使用高精度（1e18 精度）
    const SCALE = BigInt(10) ** BigInt(18)
    const fracPart = (Q96 * BigInt(Math.floor(sqrtPriceFrac * 1e18))) / SCALE

    const sqrtPriceX96Value = intPart + fracPart

    return sqrtPriceX96Value.toString()
  }

  // 当实际价格改变时，自动更新sqrtPriceX96
  useEffect(() => {
    if (priceMode === 'simple' && simplePrice) {
      const sqrtPriceX96 = calculateSqrtPriceX96(simplePrice)
      console.log('Price conversion:', {
        input: simplePrice,
        output: sqrtPriceX96,
        expected: 'For price=1000, should be ~2505159283018496488446629036'
      })
      if (sqrtPriceX96) {
        form.setFieldValue('sqrtPriceX96', sqrtPriceX96)
      }
    }
  }, [simplePrice, priceMode, form])

  const handleSubmit = async (values: any) => {
    console.log('\n===== Form Submitted =====')
    console.log('Form values:', values)
    console.log('All fields:', form.getFieldsValue())
    console.log('===========================\n')

    if (!address) {
      setError('请先连接钱包')
      return
    }

    // 检查必填字段
    if (!values.token0 || !values.token1) {
      setError('请选择代币对')
      return
    }

    if (!values.sqrtPriceX96) {
      setError('请输入初始价格')
      return
    }

    // ✅ 处理 ETH -> WETH 转换
    // 因为合约中应该存储 WETH 地址而不是 ETH 地址
    const isToken0Native = isNativeTokenAddress(values.token0)
    const isToken1Native = isNativeTokenAddress(values.token1)
    let token0 = isToken0Native ? TOKENS.ETH.wrappedAddress : values.token0 as string
    let token1 = isToken1Native ? TOKENS.ETH.wrappedAddress : values.token1 as string
    let sqrtPriceX96 = values.sqrtPriceX96

    console.log('\n===== Token Address Conversion =====')
    console.log('User selected token0:', values.token0, isToken0Native ? '(ETH, converted to WETH)' : '')
    console.log('User selected token1:', values.token1, isToken1Native ? '(ETH, converted to WETH)' : '')
    console.log('Actual token0 for contract:', token0)
    console.log('Actual token1 for contract:', token1)
    console.log('====================================\n')

    // 自动调整 token0 和 token1 的顺序（token0 必须小于 token1）
    if (token0.toLowerCase() > token1.toLowerCase()) {
      console.log('🔄 Swapping token0 and token1 to satisfy token0 < token1 requirement')
      const temp = token0
      token0 = token1
      token1 = temp

      // 当代币顺序对调时，价格需要取倒数
      // 新价格 = 1 / 原价格
      const originalPrice = parseFloat(simplePrice)
      if (!isNaN(originalPrice) && originalPrice > 0) {
        const newPrice = 1 / originalPrice
        const newSqrtPriceX96 = calculateSqrtPriceX96(newPrice.toString())
        if (newSqrtPriceX96) {
          sqrtPriceX96 = newSqrtPriceX96
        }
        console.log(`Price adjusted: ${originalPrice} → ${newPrice}`)
      }
    }

    console.log('\n===== Creating Pool =====')
    console.log('Token0:', token0, '(address smaller)')
    console.log('Token1:', token1, '(address larger)')
    console.log('Fee:', values.fee)
    console.log('TickLower:', values.tickLower)
    console.log('TickUpper:', values.tickUpper)
    console.log('sqrtPriceX96:', sqrtPriceX96)
    console.log('========================\n')

    setError('')
    setSubmitting(true)

    try {
      // 估算gas
      console.log('Estimating gas...')
      const gas = await estimateGasWithCap({
        address: CONTRACTS.POOL_MANAGER as `0x${string}`,
        abi: POOL_MANAGER_ABI,
        functionName: 'createAndInitializePoolIfNecessary',
        args: [
          {
            token0: token0 as `0x${string}`,
            token1: token1 as `0x${string}`,
            fee: values.fee,
            tickLower: parseInt(values.tickLower),
            tickUpper: parseInt(values.tickUpper),
            sqrtPriceX96: parseUnits(sqrtPriceX96, 0),
          }
        ],
        fallbackGas: CREATE_POOL_GAS_FALLBACK,
      })

      console.log('✅ Estimated gas:', gas.toString())

      // 创建池子
      writeContract({
        address: CONTRACTS.POOL_MANAGER as `0x${string}`,
        abi: POOL_MANAGER_ABI,
        functionName: 'createAndInitializePoolIfNecessary',
        args: [
          {
            token0: token0 as `0x${string}`,
            token1: token1 as `0x${string}`,
            fee: values.fee,
            tickLower: parseInt(values.tickLower),
            tickUpper: parseInt(values.tickUpper),
            sqrtPriceX96: parseUnits(sqrtPriceX96, 0),
          }
        ],
        gas,
      })

      console.log('✅ Transaction submitted')
      setSubmitting(false)
    } catch (error: any) {
      console.error('❌ Failed to create pool:', error)
      setSubmitting(false)

      // 显示具体错误信息
      let errorMessage = '创建池子失败'
      if (error.message) {
        if (error.message.includes('insufficient funds')) {
          errorMessage = '余额不足，请确保有足够的 ETH 支付 gas 费用'
        } else if (error.message.includes('user rejected')) {
          errorMessage = '用户取消了交易'
        } else if (error.message.includes('execution reverted')) {
          errorMessage = '合约执行失败：' + error.message
        } else {
          errorMessage = '错误：' + error.message
        }
      }

      setError(errorMessage)

      // 如果gas估算失败，尝试不带gas参数发送
      try {
        console.log('Retrying without gas estimation...')
        writeContract({
          address: CONTRACTS.POOL_MANAGER as `0x${string}`,
          abi: POOL_MANAGER_ABI,
          functionName: 'createAndInitializePoolIfNecessary',
          args: [
            {
              token0: token0 as `0x${string}`,
              token1: token1 as `0x${string}`,
              fee: values.fee,
              tickLower: parseInt(values.tickLower),
              tickUpper: parseInt(values.tickUpper),
              sqrtPriceX96: parseUnits(sqrtPriceX96, 0),
            }
          ],
        })
      } catch (retryError: any) {
        console.error('❌ Retry also failed:', retryError)
      }
    }

    // TODO: 如果addLiquidity为true，需要在创建池子后添加流动性
  }

  // 准备代币选项
  const tokenOptions = Object.entries(TOKENS).map(([key, token]) => ({
    label: `${token.symbol} - ${token.name}`,
    value: token.address,
  }))

  return (
    <Modal
      title="Create New Liquidity Pool"
      open={true}
      onCancel={onClose}
      footer={null}
      width={700}
    >
      {/* 调试信息（开发模式） */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mb-4 p-2 bg-gray-100 rounded text-xs font-mono">
          <div>Wallet: {address ? '✅ Connected' : '❌ Not connected'}</div>
          <div>Form Valid: {form.getFieldsError().length === 0 ? '✅ Yes' : '❌ No'}</div>
          <div>Errors: {form.getFieldsError().map(e => e.errors.join(', ')).join('; ') || 'None'}</div>
          {hash && <div>Tx Hash: {hash.slice(0, 10)}...{hash.slice(-8)}</div>}
          <div>Status: {isPending ? '⏳ Pending' : isConfirming ? '⏳ Confirming' : isConfirmed ? '✅ Confirmed' : 'Ready'}</div>
        </div>
      )}

      {/* 交易状态显示 */}
      {(isPending || isConfirming || isConfirmed) && (
        <div className={`mb-4 p-3 rounded-lg border ${
          isPending ? 'bg-blue-50 border-blue-200' :
          isConfirming ? 'bg-yellow-50 border-yellow-200' :
          'bg-green-50 border-green-200'
        }`}>
          <div className="flex items-center space-x-2">
            {isPending && (
              <span className="text-blue-700">⏳ 等待钱包确认...</span>
            )}
            {isConfirming && (
              <span className="text-yellow-700">⏳ 交易确认中...</span>
            )}
            {isConfirmed && (
              <span className="text-green-700">✅ 池子创建成功！</span>
            )}
          </div>
          {hash && (
            <div className="mt-2 text-xs text-gray-600">
              交易哈希: {hash.slice(0, 10)}...{hash.slice(-8)}
            </div>
          )}
        </div>
      )}

      <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
        <p className="text-sm text-blue-800">
          💡 <strong>提示</strong>：创建池子只需要设置代币对、费率和初始价格。价格区间通常使用默认的全范围即可。
        </p>
      </div>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        className="mt-4"
        initialValues={{
          fee: 500, // 改为0.05%，更适合稳定币对
          tickLower: '-887220',
          tickUpper: '887220',
        }}
      >
        {/* Token Selection */}
        <div className="grid grid-cols-2 gap-4">
          <Form.Item
            label="Token 0"
            name="token0"
            rules={[{ required: true, message: 'Please select token 0' }]}
            tooltip="第一个代币。注意：提交时会自动调整为地址较小的代币作为 token0"
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
            tooltip="第二个代币。注意：提交时会自动调整为地址较大的代币作为 token1"
          >
            <Select
              placeholder="Select token"
              options={tokenOptions}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
        </div>

        {/* 代币顺序提示 */}
        {token0 && token1 && (
          <div className="mb-4 p-2 bg-blue-50 rounded border border-blue-200 text-xs text-blue-800">
            💡 提示：系统会自动调整代币顺序以满足合约要求（token0 地址 &lt; token1 地址）
            <br />
            {token0.toLowerCase() < token1.toLowerCase() ? (
              <span className="text-green-600">✅ 当前顺序正确</span>
            ) : (
              <span className="text-orange-600">⚠️ 提交时会自动对调 token0 和 token1，同时价格也会相应调整（取倒数）</span>
            )}
          </div>
        )}

        {/* Fee Selection */}
        <Form.Item
          label={
            <span>
              Fee Tier
              <Tooltip title="交易手续费率。稳定币对推荐0.05%，普通代币对推荐0.3%，波动大的推荐1%">
                <span className="ml-1 text-blue-500">ⓘ</span>
              </Tooltip>
            </span>
          }
          name="fee"
          rules={[{ required: true }]}
        >
          <Select
            options={[
              { label: '0.05% - 稳定币对推荐', value: 500 },
              { label: '0.3% - 标准费率', value: 3000 },
              { label: '1% - 波动大的代币', value: 10000 },
            ]}
          />
        </Form.Item>

        {/* Price Range */}
        <div className="bg-gray-50 p-3 rounded-lg mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-sm">Price Range (Tick)</span>
            <Tooltip title="价格区间定义池子可交易的价格范围。全范围(-887220 到 887220)适合大多数情况。">
              <span className="text-blue-500 text-sm cursor-help">ⓘ</span>
            </Tooltip>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item
              name="tickLower"
              rules={[{ required: true }]}
              className="mb-0"
            >
              <Input type="number" placeholder="-887220" />
            </Form.Item>
            <Form.Item
              name="tickUpper"
              rules={[{ required: true }]}
              className="mb-0"
            >
              <Input type="number" placeholder="887220" />
            </Form.Item>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            默认值代表全范围（Full Range），适合大多数情况。如需自定义范围，请了解Uniswap V3的tick概念。
          </p>
        </div>

        {/* Initial Price */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-medium text-sm">Initial Price</span>
            <Tooltip title="池子的初始价格。可以选择'实际价格'模式直接输入如1:100的比例，或使用'原始值'模式直接输入sqrtPriceX96">
              <span className="text-blue-500 text-sm cursor-help">ⓘ</span>
            </Tooltip>
          </div>

          {/* 价格模式切换 */}
          <div className="flex gap-2 mb-3">
            <Button
              type={priceMode === 'simple' ? 'primary' : 'default'}
              size="small"
              onClick={() => setPriceMode('simple')}
            >
              实际价格
            </Button>
            <Button
              type={priceMode === 'raw' ? 'primary' : 'default'}
              size="small"
              onClick={() => setPriceMode('raw')}
            >
              原始值(sqrtPriceX96)
            </Button>
          </div>

          {/* 简单价格输入 */}
          {priceMode === 'simple' && (
            <div className="space-y-2">
              <div className="flex gap-2 items-center">
                <span className="text-sm text-gray-600">1 {token0 ? (Object.values(TOKENS).find(t => t.address === token0)?.symbol || 'Token0') : 'Token0'} =</span>
                <Input
                  type="number"
                  value={simplePrice}
                  onChange={(e) => setSimplePrice(e.target.value)}
                  placeholder="1"
                  className="flex-1"
                  step="0.001"
                />
                <span className="text-sm text-gray-600">{token1 ? (Object.values(TOKENS).find(t => t.address === token1)?.symbol || 'Token1') : 'Token1'}</span>
              </div>
              <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
                💡 直接输入实际兑换比例，系统会自动转换为sqrtPriceX96
                <br />
                例如：输入 100 表示 1 {token0 ? (Object.values(TOKENS).find(t => t.address === token0)?.symbol || 'Token0') : 'Token0'} = 100 {token1 ? (Object.values(TOKENS).find(t => t.address === token1)?.symbol || 'Token1') : 'Token1'}
                {token0 && token1 && token0.toLowerCase() > token1.toLowerCase() && simplePrice && parseFloat(simplePrice) > 0 && (
                  <>
                    <br />
                    <span className="text-orange-600">
                      ⚠️ 注意：提交时代币顺序会对调，价格会自动调整为 {(1/parseFloat(simplePrice)).toFixed(6)} (取倒数)
                    </span>
                  </>
                )}
              </div>

              {/* 隐藏字段存储值 */}
              <Form.Item name="sqrtPriceX96" noStyle>
                <Input type="hidden" />
              </Form.Item>

              {/* 实时显示转换结果 */}
              {simplePrice && form.getFieldValue('sqrtPriceX96') && (
                <div className="text-xs bg-blue-50 p-2 rounded border border-blue-200">
                  <div className="text-blue-800 space-y-1">
                    <div>
                      转换后的 sqrtPriceX96:
                    </div>
                    <div className="bg-blue-100 px-2 py-1 rounded font-mono text-xs break-all">
                      {form.getFieldValue('sqrtPriceX96')}
                    </div>
                    <div className="text-gray-600 mt-1">
                      ✓ 验证: sqrt({simplePrice}) × 2^96
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 原始sqrtPriceX96输入 */}
          {priceMode === 'raw' && (
            <div className="space-y-2">
              <Form.Item
                name="sqrtPriceX96"
                rules={[{ required: true, message: 'Please enter sqrtPriceX96' }]}
                className="mb-0"
              >
                <Input
                  placeholder="79228162514264337593543950336"
                  className="font-mono text-sm"
                />
              </Form.Item>
              <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
                <p className="font-medium mb-1">💡 常见价格参考：</p>
                <ul className="list-disc list-inside ml-2 space-y-1">
                  <li><strong>1:1 价格</strong>: 79228162514264337593543950336</li>
                  <li><strong>1:2 价格</strong>: 111803398874989489442149146 (token0更贵)</li>
                  <li><strong>2:1 价格</strong>: 560227709747861398276240144 (token0更便宜)</li>
                  <li><strong>1:100 价格</strong>: 792281625142643375935439503360</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Add Liquidity Switch */}
        <div className="mb-4">
          <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
            <div>
              <span className="font-medium">Add Initial Liquidity</span>
              <p className="text-xs text-gray-600 mt-1">
                是否立即添加流动性？（需要提供代币数量）
              </p>
            </div>
            <Switch
              checked={addLiquidity}
              onChange={setAddLiquidity}
            />
          </div>
        </div>

        {/* Initial Liquidity Amounts - Only show if adding liquidity */}
        {addLiquidity && (
          <div className="bg-yellow-50 p-4 rounded-lg mb-4 border border-yellow-200">
            <p className="text-sm text-yellow-800 mb-3">
              ⚠️ 添加流动性需要提供两种代币的数量。请确保您的钱包有足够的代币余额。
            </p>
            <div className="grid grid-cols-2 gap-4">
              <Form.Item
                label="Amount 0"
                name="amount0"
                rules={[{ required: addLiquidity, message: 'Required when adding liquidity' }]}
              >
                <Input placeholder="0.0" type="number" />
              </Form.Item>
              <Form.Item
                label="Amount 1"
                name="amount1"
                rules={[{ required: addLiquidity, message: 'Required when adding liquidity' }]}
              >
                <Input placeholder="0.0" type="number" />
              </Form.Item>
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 rounded-lg border border-red-200">
            <p className="text-sm text-red-800">
              ❌ {error}
            </p>
          </div>
        )}

        {/* Gas 费用预估 */}
        {estimatedGasCost && !error && (
          <div className="mb-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
            <div className="flex items-center justify-between">
              <span className="text-sm text-yellow-800">
                ⛽ 预估 Gas 费用:
              </span>
              <span className="font-medium text-yellow-900">
                ~{parseFloat(estimatedGasCost).toFixed(6)} ETH
              </span>
            </div>
            <p className="text-xs text-yellow-700 mt-1">
              实际费用可能因网络状况而有所不同
            </p>
          </div>
        )}

        {/* Submit Button */}
        <div className="pt-4">
          <Button
            type="primary"
            size="large"
            block
            htmlType="submit"
            loading={isPending || isConfirming || submitting}
            disabled={!address || isConfirming || isConfirmed}
          >
            {!address ? '请先连接钱包' :
             isConfirmed ? '✅ 创建成功' :
             isConfirming ? '确认中...' :
             isPending ? '等待确认...' :
             addLiquidity ? 'Create Pool & Add Liquidity' : 'Create Pool'}
          </Button>
        </div>
      </Form>
    </Modal>
  )
}