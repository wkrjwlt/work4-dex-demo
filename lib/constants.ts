// 合约地址配置
export const CONTRACTS = {
  POOL_MANAGER: '0xddC12b3F9F7C91C79DA7433D8d212FB78d609f7B',
  POSITION_MANAGER: '0xbe766Bf20eFfe431829C5d5a2744865974A0B610',
  SWAP_ROUTER: '0xD2c220143F5784b3bD84ae12747d97C8A36CeCB2',
  META_NODE_MANAGER: '0x8da623dcb3cd359d05682a2aac9bcb7a8eef3baf',
  LIQUIDITY_MANAGER: '0xbe766Bf20eFfe431829C5d5a2744865974A0B610', // 使用Position Manager作为流动性管理器
} as const

// WETH地址 - 延迟检查
const getWethAddress = () => {
  const address = process.env.NEXT_PUBLIC_WETH9_ADDRESS || process.env.NEXT_PUBLIC_WETH_ADDRESS
  if (!address) {
    console.warn('缺少 NEXT_PUBLIC_WETH9_ADDRESS（或 NEXT_PUBLIC_WETH_ADDRESS）环境变量配置')
    // ⚠️ 重要：Sepolia 测试网使用不同的 WETH 地址
    // 正确的 Sepolia WETH 地址: 0xfff9976782d46cc05630d1f6ebab18b2324d6b14
    // 主网 WETH 地址（不适用于 Sepolia）: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
    return '0xfff9976782d46cc05630d1f6ebab18b2324d6b14'
  }
  return address
}

const WETH_ADDRESS = getWethAddress()

// 测试代币地址
export const TOKENS = {
  ETH: {
    address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // 原生ETH的特殊地址
    wrappedAddress: WETH_ADDRESS, // 通过环境变量注入 WETH 地址
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    isNative: true,
  },
  MNTokenA: {
    address: '0x4798388e3adE569570Df626040F07DF71135C48E',
    symbol: 'MNA',
    name: 'MetaNode Token A',
    decimals: 18,
  },
  MNTokenB: {
    address: '0x5A4eA3a013D42Cfd1B1609d19f6eA998EeE06D30',
    symbol: 'MNB',
    name: 'MetaNode Token B',
    decimals: 18,
  },
  MNTokenC: {
    address: '0x86B5df6FF459854ca91318274E47F4eEE245CF28',
    symbol: 'MNC',
    name: 'MetaNode Token C',
    decimals: 18,
  },
  MNTokenD: {
    address: '0x7af86B1034AC4C925Ef5C3F637D1092310d83F03',
    symbol: 'MND',
    name: 'MetaNode Token D',
    decimals: 18,
  },
} as const

export const ETH_SPECIAL_ADDRESS = TOKENS.ETH.address

export function isNativeTokenAddress(address?: string | null): boolean {
  return !!address && address.toLowerCase() === ETH_SPECIAL_ADDRESS.toLowerCase()
}

export function toChainTokenAddress(address: string): string {
  return isNativeTokenAddress(address) ? TOKENS.ETH.wrappedAddress : address
}

export function getTokenByAddress(address?: string | null) {
  if (!address) return undefined

  return Object.values(TOKENS).find((token) => {
    if (token.address.toLowerCase() === address.toLowerCase()) {
      return true
    }

    return 'wrappedAddress' in token &&
      typeof token.wrappedAddress === 'string' &&
      token.wrappedAddress.toLowerCase() === address.toLowerCase()
  })
}

// 网络配置
export const NETWORK_CONFIG = {
  chainId: 11155111, // Sepolia
  name: 'Sepolia',
  // 不再硬编码 API key，使用 wagmi 配置中的 fallback RPC
  rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
  blockExplorer: 'https://sepolia.etherscan.io',
} as const

// 默认滑点配置
export const DEFAULT_SLIPPAGE = 0.5 // 0.5%

// 费率选项
export const FEE_TIERS = [500, 3000, 10000] // 0.05%, 0.3%, 1% 