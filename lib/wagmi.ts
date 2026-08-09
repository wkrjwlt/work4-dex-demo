import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { sepolia } from 'wagmi/chains'
import { http, fallback } from 'wagmi'

// Sepolia 公共 RPC 端点（按优先级排序）
const SEPOLIA_RPC_URLS = [
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL, // 用户配置的 RPC（优先）
  'https://sepolia.infura.io/v3/9aa3d95b3bc440fa83ea838f2401a4e9', // Infura 公共端点
  'https://rpc.sepolia.org', // Sepolia 官方 RPC
  'https://ethereum-sepolia.publicnode.com', // Public Node
  'https://1rpc.io/sepolia', // 1RPC
].filter(Boolean) as string[]

// 配置支持的链
export const config = getDefaultConfig({
  appName: 'MetaNodeSwap',
  projectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || '0029f9c8592dd69181c6ee9806187bb4',
  chains: [sepolia],
  transports: {
    // 使用 fallback 配置多个 RPC 端点，自动切换
    [sepolia.id]: fallback(SEPOLIA_RPC_URLS.map(url => http(url))),
  },
  ssr: true,
})

export { sepolia }