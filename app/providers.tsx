'use client'

import * as React from 'react'
import {
  RainbowKitProvider,
  lightTheme,
  darkTheme,
} from '@rainbow-me/rainbowkit'
import { WagmiProvider } from 'wagmi'
import {
  QueryClientProvider,
  QueryClient,
} from '@tanstack/react-query'
import { App as AntdApp } from 'antd'

import { config } from '@/lib/wagmi'

const queryClient = new QueryClient()

// 错误边界组件
class WalletErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Wallet connection error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="max-w-md p-6 bg-white rounded-lg shadow-lg">
            <h2 className="text-xl font-bold text-red-600 mb-4">
              钱包连接错误
            </h2>
            <p className="text-gray-600 mb-4">
              {this.state.error?.message || '未知错误'}
            </p>
            <p className="text-sm text-gray-500 mb-4">
              建议：
            </p>
            <ul className="text-sm text-gray-500 list-disc list-inside mb-4">
              <li>检查 WalletConnect Project ID 配置</li>
              <li>刷新页面重试</li>
              <li>使用其他钱包（如 MetaMask）</li>
            </ul>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              刷新页面
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <WalletErrorBoundary>
          <RainbowKitProvider>
            <AntdApp>
              {children}
            </AntdApp>
          </RainbowKitProvider>
        </WalletErrorBoundary>
      </QueryClientProvider>
    </WagmiProvider>
  )
}