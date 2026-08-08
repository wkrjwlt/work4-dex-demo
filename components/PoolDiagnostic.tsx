'use client'

import { useReadContract } from 'wagmi'
import { POOL_MANAGER_ABI } from '@/lib/contracts'
import { CONTRACTS, TOKENS } from '@/lib/constants'
import { Card, Spin, Alert, Button } from 'antd'
import { useState } from 'react'

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

export function PoolDiagnostic() {
  const [showDetails, setShowDetails] = useState(false)

  const { data: pools, isLoading, error, refetch } = useReadContract({
    address: CONTRACTS.POOL_MANAGER as `0x${string}`,
    abi: POOL_MANAGER_ABI,
    functionName: 'getAllPools',
  })

  if (isLoading) {
    return (
      <Card className="mb-4">
        <div className="flex items-center justify-center p-8">
          <Spin size="large" />
          <span className="ml-2">加载池子数据...</span>
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Alert
        title="错误"
        description={`无法加载池子数据: ${error.message}`}
        type="error"
        className="mb-4"
        showIcon
      />
    )
  }

  const rawPoolList = (pools as PoolInfo[]) || []

  // 去重：根据 pool 地址去重
  const poolList = rawPoolList.reduce((acc: PoolInfo[], pool) => {
    const existing = acc.find(p => p.pool.toLowerCase() === pool.pool.toLowerCase())
    if (!existing) {
      acc.push(pool)
    }
    return acc
  }, [])

  // 检查池子索引分布
  const poolIndexes = poolList.map(p => p.index).sort((a, b) => a - b)
  const maxIndex = poolIndexes.length > 0 ? Math.max(...poolIndexes) : -1
  const minIndex = poolIndexes.length > 0 ? Math.min(...poolIndexes) : -1
  const duplicateCount = rawPoolList.length - poolList.length

  // 获取代币符号
  const getTokenSymbol = (address: string) => {
    const token = Object.values(TOKENS).find(t => t.address.toLowerCase() === address.toLowerCase())
    return token?.symbol || address.slice(0, 10) + '...'
  }

  return (
    <Card
      title="池子诊断"
      className="mb-4"
      extra={
        <div className="flex gap-2">
          <Button size="small" onClick={() => refetch()}>
            刷新
          </Button>
          <Button size="small" onClick={() => setShowDetails(!showDetails)}>
            {showDetails ? '隐藏详情' : '显示详情'}
          </Button>
        </div>
      }
    >
      {poolList.length === 0 ? (
        <Alert
          title="没有找到任何池子"
          description="你需要先创建池子才能添加流动性。点击页面右上角的 '+ Create Pool' 按钮创建一个新池子。"
          type="warning"
          showIcon
        />
      ) : (
        <div className="space-y-3">
          {duplicateCount > 0 && (
            <Alert
              title={`⚠️ 检测到重复池子数据`}
              description={`合约返回了 ${rawPoolList.length} 条记录，去重后实际有 ${poolList.length} 个不同的池子（重复 ${duplicateCount} 条）。这可能是合约实现的问题。`}
              type="warning"
              showIcon
              className="mb-4"
            />
          )}

          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
            <p className="text-green-800 text-sm">
              ✅ 找到 {poolList.length} 个唯一的池子（索引范围: #{minIndex} - #{maxIndex}）。
            </p>
            <p className="text-green-700 text-xs mt-1">
              你可以向这些池子添加流动性。池子索引: [{poolIndexes.slice(0, 10).join(', ')}{poolIndexes.length > 10 ? '...' : ''}]
            </p>
          </div>

          {showDetails && (
            <div className="bg-gray-50 rounded-lg p-3 mb-4">
              <p className="text-xs text-gray-600 mb-2">
                <strong>调试信息：</strong>
              </p>
              <div className="text-xs font-mono space-y-1">
                <div>原始池子数: {rawPoolList.length}</div>
                <div>去重后池子数: {poolList.length}</div>
                <div>重复记录数: {duplicateCount}</div>
                <div>最小索引: {minIndex}</div>
                <div>最大索引: {maxIndex}</div>
                <div className="break-all">所有索引: [{poolIndexes.join(', ')}]</div>
              </div>
            </div>
          )}

          <div className="grid gap-3">
            {poolList.map((pool, idx) => (
              <div
                key={idx}
                className="border rounded-lg p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">池子 #{pool.index}</span>
                    <span className="text-xs text-gray-500">
                      ({getTokenSymbol(pool.token0)}/{getTokenSymbol(pool.token1)})
                    </span>
                  </div>
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      pool.liquidity > 0
                        ? 'bg-green-100 text-green-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {pool.liquidity > 0 ? '有流动性' : '无流动性'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-gray-500">Token0:</span>
                    <span className="ml-1 font-mono text-xs">{pool.token0.slice(0, 6)}...{pool.token0.slice(-4)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Token1:</span>
                    <span className="ml-1 font-mono text-xs">{pool.token1.slice(0, 6)}...{pool.token1.slice(-4)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">费率:</span>
                    <span className="ml-1">{(pool.fee / 10000).toFixed(2)}%</span>
                  </div>
                  <div>
                    <span className="text-gray-500">流动性:</span>
                    <span className="ml-1">{pool.liquidity.toString()}</span>
                  </div>
                </div>

                {showDetails && (
                  <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-600">
                    <div className="font-mono">池子地址: {pool.pool}</div>
                    <div className="font-mono">sqrtPriceX96: {pool.sqrtPriceX96.toString()}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}