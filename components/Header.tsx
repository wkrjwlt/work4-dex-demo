'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function Header() {
  const pathname = usePathname()

  const isActive = (path: string) => {
    return pathname === path ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600 hover:text-gray-900'
  }

  return (
    <header className="bg-white border-b border-gray-200 shadow-sm">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center">
              <span className="text-white font-bold text-xl">M</span>
            </div>
            <span className="text-gray-900 font-bold text-xl">MetaNodeSwap</span>
          </Link>

          {/* Navigation */}
          <nav className="flex items-center space-x-8">
            <Link
              href="/pool"
              className={`${isActive('/pool')} transition-colors font-medium pb-1`}
            >
              Pool
            </Link>
            <Link
              href="/position"
              className={`${isActive('/position')} transition-colors font-medium pb-1`}
            >
              Position
            </Link>
            <Link
              href="/swap"
              className={`${isActive('/swap')} transition-colors font-medium pb-1`}
            >
              Swap
            </Link>
          </nav>

          {/* Wallet Connection */}
          <ConnectButton />
        </div>
      </div>
    </header>
  )
}