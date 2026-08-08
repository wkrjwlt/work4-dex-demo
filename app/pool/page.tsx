'use client'

import { useAccount } from 'wagmi'
import { PoolList } from '@/components/PoolList'
import { CreatePoolModal } from '@/components/CreatePoolModal'
import { useState, useRef } from 'react'
// import { PoolDiagnostic } from '@/components/PoolDiagnostic' // 暂时隐藏

export default function PoolPage() {
  const { isConnected } = useAccount()
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const poolListRef = useRef<{ refetch: () => void }>(null)

  // 创建池子成功后的回调
  const handlePoolCreated = () => {
    console.log('🎉 Pool created successfully, refreshing list...')

    // 刷新池子列表
    if (poolListRef.current) {
      poolListRef.current.refetch()
    }
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Liquidity Pools</h1>
          <p className="text-gray-600">View and create trading pools with concentrated liquidity</p>
        </div>
        {isConnected && (
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="bg-blue-500 text-white px-6 py-3 rounded-xl font-semibold hover:bg-blue-600 transition-all shadow-md hover:shadow-lg"
          >
            + Create Pool
          </button>
        )}
      </div>

      {/* Pool Diagnostic - 暂时隐藏 */}
      {/* <PoolDiagnostic /> */}

      {/* Pool List */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
        <PoolList ref={poolListRef} />
      </div>

      {/* Create Pool Modal */}
      {isCreateModalOpen && (
        <CreatePoolModal
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={handlePoolCreated}
        />
      )}
    </div>
  )
}