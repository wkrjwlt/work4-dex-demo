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

export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <AntdApp>
            {children}
          </AntdApp>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}