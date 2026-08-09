'use client'

import { useEffect, useMemo, useState, forwardRef, useImperativeHandle } from 'react'
import { useReadContract } from 'wagmi'
import { POOL_MANAGER_ABI } from '@/lib/contracts'
import { CONTRACTS, TOKENS } from '@/lib/constants'
import { formatUnits } from 'viem'
import Image from 'next/image'
import { Table, Input, Button, Space } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import React from 'react'
import { getPriceAtTick, getPriceAtSqrtRatio } from '@/lib/tickMath'
import { SearchOutlined, ReloadOutlined, PlusOutlined } from '@ant-design/icons'
import { AddLiquidityModal } from './AddLiquidityModal'

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

// 获取代币symbol（支持 ETH/WETH 识别）
const getTokenSymbol = (address: string) => {
  // 如果是 ETH 地址
  if (address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
    return 'ETH'
  }

  // 如果是主网 WETH 地址（历史遗留问题）
  if (address.toLowerCase() === '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2') {
    return 'ETH (⚠️ 旧地址)'
  }

  // 如果是 Sepolia WETH 地址（正确）
  if (address.toLowerCase() === '0xfff9976782d46cc05630d1f6ebab18b2324d6b14') {
    return 'ETH'
  }

  const token = Object.values(TOKENS).find(t => t.address.toLowerCase() === address.toLowerCase())
  return token?.symbol || address.slice(0, 6) + '...' + address.slice(-4)
}

// 检查池子是否可用（排除使用主网 WETH 地址的旧池子）
const isPoolUsable = (pool: PoolInfo) => {
  const MAINNET_WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

  // 如果池子的 token 地址使用了主网 WETH，则不可用
  if (pool.token0.toLowerCase() === MAINNET_WETH.toLowerCase() ||
      pool.token1.toLowerCase() === MAINNET_WETH.toLowerCase()) {
    return false
  }

  return true
}

export interface PoolListRef {
  refetch: () => void
}

export const PoolList = forwardRef<PoolListRef>((props, ref) => {
  const [searchText, setSearchText] = useState('')
  const [addLiquidityPool, setAddLiquidityPool] = useState<{
    token0: string
    token1: string
  } | null>(null)

  const { data: pools, isLoading, error, refetch } = useReadContract({
    address: CONTRACTS.POOL_MANAGER as `0x${string}`,
    abi: POOL_MANAGER_ABI,
    functionName: 'getAllPools',
  })

  // 暴露 refetch 方法给父组件
  useImperativeHandle(ref, () => ({
    refetch
  }))

  // 输出真实的合约读取结果
  useEffect(() => {
    if (pools) {
      console.log('===== getAllPools 真实结果 =====')
      console.log('原始数据:', pools)
      console.log('池子数量:', (pools as PoolInfo[]).length)

      // 去重统计
      const rawPools = pools as PoolInfo[]
      const uniquePools = rawPools.reduce((acc: PoolInfo[], pool) => {
        const existing = acc.find(p => p.pool.toLowerCase() === pool.pool.toLowerCase())
        if (!existing) {
          acc.push(pool)
        }
        return acc
      }, [])

      console.log('去重后池子数:', uniquePools.length)
      console.log('重复记录数:', rawPools.length - uniquePools.length)
      console.log('池子详情:', JSON.parse(JSON.stringify(uniquePools, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )))
      console.log('==============================')
    }
  }, [pools])

  // 处理池子数据，添加价格信息
  const processedPools = useMemo(() => {
    if (!pools) return []

    // 去重
    const rawPools = pools as PoolInfo[]
    const uniquePools = rawPools.reduce((acc: PoolInfo[], pool) => {
      const existing = acc.find(p => p.pool.toLowerCase() === pool.pool.toLowerCase())
      if (!existing) {
        acc.push(pool)
      }
      return acc
    }, [])

    return uniquePools.map(pool => {
      const priceLower = getPriceAtTick(pool.tickLower)
      const priceUpper = getPriceAtTick(pool.tickUpper)
      const currentPrice = getPriceAtSqrtRatio(pool.sqrtPriceX96)

      return {
        ...pool,
        priceLower,
        priceUpper,
        currentPrice,
        token0Symbol: getTokenSymbol(pool.token0),
        token1Symbol: getTokenSymbol(pool.token1),
      }
    })
  }, [pools])

  // 根据搜索文本过滤池子
  const filteredPools = useMemo(() => {
    if (!searchText.trim()) return processedPools

    const searchLower = searchText.toLowerCase().trim()

    return processedPools.filter(pool => {
      // 搜索池子地址
      if (pool.pool.toLowerCase().includes(searchLower)) {
        return true
      }

      // 搜索代币地址
      if (pool.token0.toLowerCase().includes(searchLower) ||
          pool.token1.toLowerCase().includes(searchLower)) {
        return true
      }

      // 搜索代币符号（例如：MNA, MNB, ETH）
      if (pool.token0Symbol.toLowerCase().includes(searchLower) ||
          pool.token1Symbol.toLowerCase().includes(searchLower)) {
        return true
      }

      // 搜索交易对（例如：MNA/MNB）
      const pair = `${pool.token0Symbol}/${pool.token1Symbol}`.toLowerCase()
      const reversePair = `${pool.token1Symbol}/${pool.token0Symbol}`.toLowerCase()
      if (pair.includes(searchLower) || reversePair.includes(searchLower)) {
        return true
      }

      return false
    })
  }, [processedPools, searchText])

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
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md mx-auto">
          <p className="text-red-600 text-lg mb-2">⚠️ 加载池子数据失败</p>
          <p className="text-gray-600 text-sm mb-4">
            {error.message || '网络请求失败，请检查网络连接'}
          </p>
          <div className="space-y-2">
            <p className="text-xs text-gray-500">可能的解决方案：</p>
            <ul className="text-xs text-gray-500 text-left list-disc list-inside">
              <li>检查网络连接</li>
              <li>刷新页面重试</li>
              <li>配置自己的 RPC 端点（推荐）</li>
            </ul>
          </div>
          <Button
            type="primary"
            onClick={() => refetch()}
            className="mt-4"
          >
            重新加载
          </Button>
        </div>
      </div>
    )
  }

  // 搜索结果为空时的提示
  if (filteredPools.length === 0 && searchText && processedPools.length > 0) {
    return (
      <div className="space-y-4">
        {/* 搜索框 */}
        <div className="flex gap-4 items-center bg-gray-50 p-4 rounded-lg">
          <div className="flex-1">
            <Input
              placeholder="搜索池子地址或交易对（例如：MNA/MNB、0x123...）"
              prefix={<SearchOutlined className="text-gray-400" />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              size="large"
              allowClear
            />
          </div>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => refetch()}
            size="large"
            className="flex items-center"
          >
            刷新
          </Button>
        </div>

        {/* 无搜索结果提示 */}
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <SearchOutlined className="text-6xl text-gray-300 mb-4" />
          <p className="text-gray-600 text-lg mb-2">未找到匹配的池子</p>
          <p className="text-gray-400 text-sm mb-4">
            搜索 "{searchText}" 没有结果
          </p>
          <Button
            onClick={() => setSearchText('')}
            type="primary"
          >
            清除搜索
          </Button>
        </div>
      </div>
    )
  }

  if (!pools || processedPools.length === 0) {
    return (
      <div className="text-center py-12">
        <Image
          src="/img/pool.png"
          alt="No pools"
          width={120}
          height={120}
          className="mx-auto mb-4 opacity-50"
        />
        <p className="text-gray-600 text-lg">No pools available yet</p>
        <p className="text-gray-400 text-sm mt-2">Create the first pool to get started!</p>
      </div>
    )
  }

  const columns: ColumnsType<typeof processedPools[0]> = [
    {
      title: '#',
      dataIndex: 'index',
      key: 'index',
      width: 60,
      render: (index: number) => <span className="text-gray-900">{index + 1}</span>,
    },
    {
      title: 'Status',
      key: 'status',
      width: 100,
      render: (_, record) => {
        const usable = isPoolUsable(record)
        return usable ? (
          <span className="text-green-600 text-xs font-medium px-2 py-1 bg-green-50 rounded">
            ✅ Available
          </span>
        ) : (
          <span className="text-red-600 text-xs font-medium px-2 py-1 bg-red-50 rounded">
            ❌ Unavailable
          </span>
        )
      },
    },
    {
      title: 'Pool Address',
      dataIndex: 'pool',
      key: 'pool',
      render: (pool: string) => (
        <span className="text-blue-600 font-mono text-sm">
          {pool.slice(0, 6)}...{pool.slice(-4)}
        </span>
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
      title: 'Current Price',
      key: 'currentPrice',
      render: (_, record) => (
        <div className="flex flex-col">
          <span className="text-gray-900 font-medium">
            {record.currentPrice.toFixed(6)}
          </span>
          <span className="text-gray-400 text-xs">
            {record.token1Symbol}/{record.token0Symbol}
          </span>
        </div>
      ),
    },
    {
      title: 'Liquidity',
      dataIndex: 'liquidity',
      key: 'liquidity',
      render: (liquidity: bigint) => (
        <span className="text-gray-900">{formatUnits(liquidity, 0)}</span>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 150,
      render: (_, record) => {
        const usable = isPoolUsable(record)
        return usable ? (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="small"
            onClick={() => {
              setAddLiquidityPool({
                token0: record.token0,
                token1: record.token1,
              })
            }}
          >
            Add Liquidity
          </Button>
        ) : (
          <div className="flex flex-col gap-1">
            <Button
              disabled
              size="small"
              className="cursor-not-allowed opacity-50"
            >
              ❌ Pool Unavailable
            </Button>
            <span className="text-xs text-gray-500">
              Using wrong WETH address
            </span>
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      {/* 搜索和刷新 */}
      <div className="flex gap-4 items-center bg-gray-50 p-4 rounded-lg">
        <div className="flex-1">
          <Input
            placeholder="搜索池子地址或交易对（例如：MNA/MNB、0x123...）"
            prefix={<SearchOutlined className="text-gray-400" />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            size="large"
            allowClear
          />
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => refetch()}
          size="large"
          className="flex items-center"
        >
          刷新
        </Button>
      </div>

      {/* 搜索结果统计 */}
      {searchText && (
        <div className="text-sm text-gray-600 px-2">
          找到 <span className="font-semibold text-blue-600">{filteredPools.length}</span> 个匹配的池子
          {filteredPools.length === 0 && (
            <span className="text-gray-400 ml-2">- 尝试修改搜索关键词</span>
          )}
        </div>
      )}

      {/* 表格 */}
      <Table
        columns={columns}
        dataSource={filteredPools}
        rowKey="pool"
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `Total ${total} pools`,
        }}
      />

      {/* Add Liquidity Modal */}
      {addLiquidityPool && (
        <AddLiquidityModal
          onClose={() => setAddLiquidityPool(null)}
          initialToken0={addLiquidityPool.token0}
          initialToken1={addLiquidityPool.token1}
          onSuccess={() => {
            console.log('✅ 流动性添加成功，刷新池子列表')
            refetch()
          }}
        />
      )}
    </div>
  )
})

PoolList.displayName = 'PoolList'