'use client'

import { useAccount } from 'wagmi'
import { PositionList } from '@/components/PositionList'
import { AddLiquidityModal } from '@/components/AddLiquidityModal'
import { useState } from 'react'
import { Wallet, Layers } from 'lucide-react'

export default function PositionPage() {
  const { isConnected } = useAccount()
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Your Positions</h1>
          <p className="text-gray-600">Manage your liquidity positions and collect fees</p>
        </div>
        {isConnected && (
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="bg-blue-500 text-white px-6 py-3 rounded-xl font-semibold hover:bg-blue-600 transition-all shadow-md hover:shadow-lg"
          >
            + Add Liquidity
          </button>
        )}
      </div>

      {/* Not Connected State */}
      {!isConnected ? (
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-12 text-center">
          <div className="mx-auto mb-6 flex justify-center">
            <div className="relative">
              {/* 背景圆 */}
              <div className="w-32 h-32 bg-linear-to-br from-blue-100 to-indigo-100 rounded-full flex items-center justify-center">
                {/* 主要图标 - 钱包 */}
                <Wallet className="w-16 h-16 text-blue-500 opacity-60" />
              </div>
              {/* 装饰图标 - 流动性层 */}
              <Layers className="w-8 h-8 text-indigo-400 absolute -bottom-2 -right-2 opacity-60" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-4">Connect Your Wallet</h3>
          <p className="text-gray-600">Please connect your wallet to view and manage your positions</p>
        </div>
      ) : (
        /* Position List */
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
          <PositionList />
        </div>
      )}

      {/* Add Liquidity Modal */}
      {isAddModalOpen && (
        <AddLiquidityModal onClose={() => setIsAddModalOpen(false)} />
      )}
    </div>
  )
}