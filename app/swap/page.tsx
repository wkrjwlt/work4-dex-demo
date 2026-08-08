'use client'

import { SwapInterface } from '@/components/SwapInterface'

export default function SwapPage() {
  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Swap Tokens</h1>
        <p className="text-gray-600">Trade tokens with optimal routing across multiple pools</p>
      </div>

      {/* Swap Interface */}
      <SwapInterface />
    </div>
  )
}