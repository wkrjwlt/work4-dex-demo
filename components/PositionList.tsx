'use client'

import { useReadContract, useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { POSITION_MANAGER_ABI } from '@/lib/contracts'
import { CONTRACTS, TOKENS } from '@/lib/constants'
import { formatUnits } from 'viem'
import { Table, Button, Space, message, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import React, { useMemo, useState, useEffect } from 'react'
import { getPriceAtTick } from '@/lib/tickMath'
import { Layers } from 'lucide-react'

interface PositionInfo {
  id: bigint
  owner: string
  token0: string
  token1: string
  index: number
  fee: number
  liquidity: bigint
  tickLower: number
  tickUpper: number
  tokensOwed0: bigint
  tokensOwed1: bigint
  feeGrowthInside0LastX128: bigint
  feeGrowthInside1LastX128: bigint
}

// 获取代币symbol
const getTokenSymbol = (address: string) => {
  const token = Object.values(TOKENS).find(t => t.address.toLowerCase() === address.toLowerCase())
  return token?.symbol || address.slice(0, 6) + '...' + address.slice(-4)
}

export function PositionList() {
  const { address } = useAccount()
  const { writeContract, data: hash, isPending } = useWriteContract()
  const [lastAction, setLastAction] = useState<'burn' | 'collect' | null>(null)
  const [processingPositionId, setProcessingPositionId] = useState<bigint | null>(null)

  // 等待交易确认
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  const { data: positions, isLoading, error, refetch } = useReadContract({
    address: CONTRACTS.POSITION_MANAGER as `0x${string}`,
    abi: POSITION_MANAGER_ABI,
    functionName: 'getAllPositions',
  })

  // 交易成功后刷新数据
  useEffect(() => {
    if (isConfirmed && lastAction) {
      message.success(`${lastAction === 'burn' ? 'Burn' : 'Collect'} successful!`)
      setLastAction(null)
      setProcessingPositionId(null)
      // 刷新数据
      refetch()
    }
  }, [isConfirmed, lastAction, refetch])

  // 过滤出只属于当前用户的仓位，并添加价格信息
  const userPositions = useMemo(() => {
    if (!positions || !address) return []

    const allPositions = positions as PositionInfo[]
    const filtered = allPositions.filter(position =>
      position.owner.toLowerCase() === address.toLowerCase()
    )

    console.log('===== getAllPositions 真实结果 =====')
    console.log('原始数据:', allPositions)
    console.log('所有仓位数量:', allPositions.length)
    console.log('当前用户地址:', address)
    console.log('用户仓位数量:', filtered.length)
    console.log('用户仓位:', JSON.parse(JSON.stringify(filtered, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )))
    console.log('==============================')

    // 添加价格信息
    return filtered.map(position => ({
      ...position,
      priceLower: getPriceAtTick(position.tickLower),
      priceUpper: getPriceAtTick(position.tickUpper),
      token0Symbol: getTokenSymbol(position.token0),
      token1Symbol: getTokenSymbol(position.token1),
    }))
  }, [positions, address])

  const handleBurn = (positionId: bigint, liquidity: bigint) => {
    if (!address) return

    // ✅ 检查 liquidity 是否为 0
    if (liquidity === 0n) {
      message.warning('This position has no liquidity to burn')
      return
    }

    setLastAction('burn')
    setProcessingPositionId(positionId)

    writeContract({
      address: CONTRACTS.POSITION_MANAGER as `0x${string}`,
      abi: POSITION_MANAGER_ABI,
      functionName: 'burn',
      args: [positionId],
    })
  }

  const handleCollect = (positionId: bigint, tokensOwed0: bigint, tokensOwed1: bigint) => {
    if (!address) return

    // ✅ 检查是否有手续费可以提取
    if (tokensOwed0 === 0n && tokensOwed1 === 0n) {
      message.warning('No fees to collect')
      return
    }

    setLastAction('collect')
    setProcessingPositionId(positionId)

    writeContract({
      address: CONTRACTS.POSITION_MANAGER as `0x${string}`,
      abi: POSITION_MANAGER_ABI,
      functionName: 'collect',
      args: [positionId, address],
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">Error loading positions: {error.message}</p>
      </div>
    )
  }

  if (!positions || userPositions.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="mx-auto mb-4 flex justify-center">
          <div className="w-28 h-28 bg-linear-to-br from-indigo-100 to-purple-100 rounded-full flex items-center justify-center">
            <Layers className="w-14 h-14 text-indigo-400 opacity-60" />
          </div>
        </div>
        <p className="text-gray-600 text-lg">No positions found</p>
        <p className="text-gray-400 text-sm mt-2">Add liquidity to create your first position!</p>
      </div>
    )
  }

  // 统计活跃和空仓
  const activePositions = userPositions.filter(p => p.liquidity > 0n)
  const emptyPositions = userPositions.filter(p => p.liquidity === 0n)

  const columns: ColumnsType<typeof userPositions[0]> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 80,
      render: (id: bigint) => (
        <span className="text-gray-900 font-mono">#{id.toString()}</span>
      ),
    },
    {
      title: 'Token Pair',
      key: 'tokenPair',
      render: (_, record) => (
        <div className="flex flex-col">
          <span className="text-gray-900 font-medium">
            {record.token0Symbol} / {record.token1Symbol}
          </span>
          <span className="text-gray-400 text-xs">
            {record.token0.slice(0, 6)}...{record.token1.slice(-4)}
          </span>
        </div>
      ),
    },
    {
      title: 'Fee',
      dataIndex: 'fee',
      key: 'fee',
      width: 80,
      render: (fee: number) => (
        <span className="text-gray-900">{(fee / 10000).toFixed(2)}%</span>
      ),
    },
    {
      title: 'Price Range',
      key: 'priceRange',
      render: (_, record) => (
        <div className="flex flex-col">
          <span className="text-gray-900 text-sm">
            [{record.priceLower.toFixed(6)}, {record.priceUpper.toFixed(6)}]
          </span>
          <span className="text-gray-400 text-xs">
            {record.token0Symbol}/{record.token1Symbol}
          </span>
        </div>
      ),
    },
    {
      title: 'Liquidity',
      dataIndex: 'liquidity',
      key: 'liquidity',
      render: (liquidity: bigint) => (
        <div className="flex flex-col">
          <span className={liquidity === 0n ? 'text-gray-400' : 'text-gray-900'}>
            {formatUnits(liquidity, 0)}
          </span>
          {liquidity === 0n && (
            <span className="text-xs text-red-500">Burned</span>
          )}
        </div>
      ),
    },
    {
      title: 'Fees Owed',
      key: 'feesOwed',
      render: (_, record) => {
        const hasFees = record.tokensOwed0 > 0n || record.tokensOwed1 > 0n
        return (
          <div className="flex flex-col text-xs">
            <span className={hasFees ? 'text-green-600' : 'text-gray-400'}>
              {record.token0Symbol}: {formatUnits(record.tokensOwed0, 18)}
            </span>
            <span className={hasFees ? 'text-blue-600' : 'text-gray-400'}>
              {record.token1Symbol}: {formatUnits(record.tokensOwed1, 18)}
            </span>
          </div>
        )
      },
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, record) => {
        const isProcessing = processingPositionId === record.id && (isPending || isConfirming)
        const hasLiquidity = record.liquidity > 0n
        const hasFees = record.tokensOwed0 > 0n || record.tokensOwed1 > 0n

        return (
          <div className="flex flex-col">
            {isProcessing && (
              <span className="text-yellow-600 text-xs">
                {isConfirming ? 'Confirming...' : 'Pending...'}
              </span>
            )}
            {!hasLiquidity && !hasFees && (
              <span className="text-gray-400 text-xs">Empty</span>
            )}
            {hasLiquidity && (
              <span className="text-green-600 text-xs">Active</span>
            )}
          </div>
        )
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_, record) => {
        const isProcessing = processingPositionId === record.id && (isPending || isConfirming)
        const hasLiquidity = record.liquidity > 0n
        const hasFees = record.tokensOwed0 > 0n || record.tokensOwed1 > 0n

        return (
          <Space>
            <Tooltip title={!hasLiquidity ? 'No liquidity to burn' : 'Burn liquidity'}>
              <Button
                size="small"
                danger
                onClick={() => handleBurn(record.id, record.liquidity)}
                disabled={!hasLiquidity || isProcessing}
                loading={isProcessing && lastAction === 'burn'}
              >
                Burn
              </Button>
            </Tooltip>
            <Tooltip title={!hasFees ? 'No fees to collect' : 'Collect fees'}>
              <Button
                size="small"
                type="primary"
                onClick={() => handleCollect(record.id, record.tokensOwed0, record.tokensOwed1)}
                disabled={!hasFees || isProcessing}
                loading={isProcessing && lastAction === 'collect'}
              >
                Collect
              </Button>
            </Tooltip>
          </Space>
        )
      },
    },
  ]

  return (
    <div>
      <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded">
        <p className="text-sm text-blue-800">
          <strong>💡 Tips:</strong>
        </p>
        <ul className="text-xs text-blue-700 mt-2 space-y-1">
          <li>• <strong>Burn</strong>: Remove liquidity from position (requires liquidity {'>'} 0)</li>
          <li>• <strong>Collect</strong>: Withdraw accumulated fees (requires fees {'>'} 0)</li>
          <li>• Recommend: Collect fees first, then burn liquidity</li>
        </ul>
        <div className="mt-2 text-xs text-gray-600">
          📊 Stats: {activePositions.length} active, {emptyPositions.length} empty
        </div>
      </div>
      <Table
        columns={columns}
        dataSource={userPositions}
        rowKey={(record) => record.id.toString()}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `Total ${total} positions`,
        }}
      />
    </div>
  )
}