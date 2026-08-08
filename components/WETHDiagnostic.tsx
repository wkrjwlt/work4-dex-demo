'use client'

import { useAccount, useBalance, usePublicClient } from 'wagmi'
import { formatUnits } from 'viem'
import { TOKENS } from '@/lib/constants'
import { Card, Button, Typography, Alert, Divider } from 'antd'
import { useEffect, useState } from 'react'

const { Text, Title } = Typography

export function WETHDiagnostic() {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const [txInfo, setTxInfo] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  // 获取实时余额
  const { data: wethBalance, refetch: refetchWeth } = useBalance({
    address,
    token: TOKENS.ETH.wrappedAddress as `0x${string}`,
    query: {
      refetchInterval: 2000, // 每 2 秒刷新一次
    },
  })

  const { data: ethBalance, refetch: refetchEth } = useBalance({
    address,
    query: {
      refetchInterval: 2000,
    },
  })

  // 检查交易状态
  const checkTransaction = async () => {
    const txHash = prompt('请输入交易哈希：')
    if (!txHash || !publicClient) return

    setLoading(true)
    try {
      const receipt = await publicClient.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      })

      const tx = await publicClient.getTransaction({
        hash: txHash as `0x${string}`,
      })

      setTxInfo({
        hash: txHash,
        status: receipt.status === 'success' ? '成功' : '失败',
        blockNumber: receipt.blockNumber.toString(),
        from: receipt.from,
        to: receipt.to,
        value: formatUnits(tx.value, 18),
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.effectiveGasPrice.toString(),
      })

      console.log('交易详情:', receipt)
      console.log('交易信息:', tx)
    } catch (error: any) {
      console.error('获取交易失败:', error)
      alert('获取交易失败: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  // 刷新所有余额
  const handleRefresh = async () => {
    await refetchWeth()
    await refetchEth()
    console.log('余额已刷新')
    console.log('ETH 余额:', ethBalance ? formatUnits(ethBalance.value, 18) : '0')
    console.log('WETH 余额:', wethBalance ? formatUnits(wethBalance.value, 18) : '0')
  }

  // 打印详细信息到控制台
  useEffect(() => {
    if (isConnected && address) {
      console.log('\n===== WETH 诊断信息 =====')
      console.log('用户地址:', address)
      console.log('WETH 合约地址:', TOKENS.ETH.wrappedAddress)
      console.log('ETH 余额:', ethBalance ? formatUnits(ethBalance.value, 18) : '0')
      console.log('WETH 余额:', wethBalance ? formatUnits(wethBalance.value, 18) : '0')
      console.log('========================\n')
    }
  }, [isConnected, address, ethBalance, wethBalance])

  if (!isConnected) {
    return (
      <Card>
        <Alert
          title="请先连接钱包"
          description="连接钱包后才能进行诊断"
          type="info"
          showIcon
        />
      </Card>
    )
  }

  return (
    <Card>
      <Title level={4}>🔍 WETH 诊断工具</Title>
      <Text type="secondary">帮助你检查 WETH 交易和余额状态</Text>

      <Divider />

      {/* 地址信息 */}
      <div className="space-y-2 mb-4">
        <div>
          <Text strong>用户地址：</Text>
          <Text code>{address}</Text>
        </div>
        <div>
          <Text strong>WETH 合约：</Text>
          <Text code>{TOKENS.ETH.wrappedAddress}</Text>
        </div>
      </div>

      <Divider />

      {/* 余额显示 */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="p-4 bg-blue-50 rounded-lg">
          <Text strong>ETH 余额</Text>
          <div className="text-2xl font-bold mt-2">
            {ethBalance ? formatUnits(ethBalance.value, 18) : '0'} ETH
          </div>
        </div>
        <div className="p-4 bg-green-50 rounded-lg">
          <Text strong>WETH 余额</Text>
          <div className="text-2xl font-bold mt-2">
            {wethBalance ? formatUnits(wethBalance.value, 18) : '0'} WETH
          </div>
        </div>
      </div>

      <Divider />

      {/* 操作按钮 */}
      <div className="space-y-2">
        <Button type="primary" onClick={handleRefresh} block>
          🔄 刷新余额
        </Button>
        <Button onClick={checkTransaction} loading={loading} block>
          🔍 检查交易状态
        </Button>
      </div>

      {/* 交易信息 */}
      {txInfo && (
        <>
          <Divider />
          <Alert
            title={`交易状态: ${txInfo.status}`}
            description={
              <div className="space-y-1 text-sm">
                <p><strong>交易哈希:</strong> {txInfo.hash}</p>
                <p><strong>区块号:</strong> {txInfo.blockNumber}</p>
                <p><strong>发送方:</strong> {txInfo.from}</p>
                <p><strong>接收方:</strong> {txInfo.to}</p>
                <p><strong>转账金额:</strong> {txInfo.value} ETH</p>
                <p><strong>Gas 使用:</strong> {txInfo.gasUsed}</p>
              </div>
            }
            type={txInfo.status === '成功' ? 'success' : 'error'}
            showIcon
          />
        </>
      )}

      <Divider />

      {/* 常见问题 */}
      <Alert
        title="常见问题排查"
        description={
          <div className="space-y-2">
            <p><strong>1. WETH 余额显示为 0？</strong></p>
            <ul className="list-disc list-inside ml-2 text-sm">
              <li>检查交易是否真的成功（点击上方"检查交易状态"）</li>
              <li>确认你发送到了正确的 WETH 合约地址</li>
              <li>等待几秒钟后点击"刷新余额"</li>
            </ul>

            <p className="mt-4"><strong>2. 交易成功但余额没变？</strong></p>
            <ul className="list-disc list-inside ml-2 text-sm">
              <li>可能是查询延迟，等待几秒后刷新</li>
              <li>检查是否在正确的网络上（Sepolia）</li>
              <li>确认查询的是正确的地址</li>
            </ul>

            <p className="mt-4"><strong>3. 你的交易哈希：</strong></p>
            <p className="text-xs font-mono bg-gray-100 p-2 rounded">
              0x7791b8e5ba1c646bacc14420ebabc081cea7a39e8e4076dede6d9d759e5648f4
            </p>
          </div>
        }
        type="info"
        showIcon
      />
    </Card>
  )
}