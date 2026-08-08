import { useAccount, useBalance } from 'wagmi'
import { TOKENS } from '@/lib/constants'

/**
 * 查看用户 WETH 余额的 Hook
 */
export function useWETHBalance() {
  const { address } = useAccount()

  // 获取 WETH 余额
  const { data: wethBalance, isLoading, refetch } = useBalance({
    address,
    token: TOKENS.ETH.wrappedAddress as `0x${string}`,
  })

  // 获取 ETH 余额
  const { data: ethBalance } = useBalance({
    address,
  })

  return {
    wethBalance,
    ethBalance,
    isLoading,
    refetch,
  }
}

/**
 * 在控制台打印 WETH 信息（用于调试）
 */
export function logWETHInfo() {
  console.log('\n===== WETH 信息 =====')
  console.log('WETH 合约地址:', TOKENS.ETH.wrappedAddress)
  console.log('网络: 所有以太坊网络（主网、Sepolia、Goerli 等）')
  console.log('代币符号: WETH')
  console.log('代币精度: 18')
  console.log('\n✅ 重要说明:')
  console.log('1. WETH 在所有以太坊网络上使用相同的地址')
  console.log('2. 这是经过验证的官方 WETH 地址')
  console.log('3. 在主网和测试网上都有效')
  console.log('\n💡 如何添加 WETH 到钱包:')
  console.log('1. 访问 http://localhost:3000/weth')
  console.log('2. 点击"添加 WETH 到钱包"按钮')
  console.log('3. 或手动添加地址:', TOKENS.ETH.wrappedAddress)
  console.log('====================\n')
}

/**
 * 复制到剪贴板（用于辅助添加代币）
 */
export async function copyWETHAddress() {
  const address = TOKENS.ETH.wrappedAddress
  try {
    await navigator.clipboard.writeText(address)
    console.log('✅ WETH 地址已复制到剪贴板:', address)
    return true
  } catch (error) {
    console.error('复制失败:', error)
    return false
  }
}