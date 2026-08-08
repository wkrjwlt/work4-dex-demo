import { PublicClient } from 'viem'

/**
 * 使用 multicall 批量执行多个合约调用
 * 减少网络请求次数，提高性能
 */
export async function multicall(
  publicClient: PublicClient,
  calls: Array<{
    address: `0x${string}`
    abi: readonly unknown[]
    functionName: string
    args?: readonly unknown[]
  }>
): Promise<unknown[]> {
  try {
    const results = await publicClient.multicall({
      contracts: calls.map(call => ({
        address: call.address,
        abi: call.abi as any,
        functionName: call.functionName as any,
        args: call.args as any,
      })),
    })

    // 提取结果，处理可能的错误
    return results.map((result, index) => {
      if (result.status === 'failure') {
        console.error(`Multicall failed at index ${index}:`, result.error)
        throw new Error(`Multicall failed: ${result.error?.message || 'Unknown error'}`)
      }
      return result.result
    })
  } catch (error) {
    console.error('Multicall error:', error)
    throw error
  }
}