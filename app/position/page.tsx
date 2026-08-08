'use client'

import { useAccount } from 'wagmi'
import { PositionList } from '@/components/PositionList'
import { AddLiquidityModal } from '@/components/AddLiquidityModal'
import { useState } from 'react'
import Image from 'next/image'

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
          <Image
            src="/img/positions.png"
            alt="Connect wallet"
            width={150}
            height={150}
            className="mx-auto mb-6 opacity-50"
          />
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