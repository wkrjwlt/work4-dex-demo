'use client'

import { useState, useEffect } from 'react'
import { useAccount, useBalance, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import { TOKENS } from '@/lib/constants'
import { WETH_ABI } from '@/lib/contracts'
import { Card, Button, Input, Typography, Space, Alert } from 'antd'
import React from 'react'

const { Title, Text } = Typography

export function WrapETHCard() {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const [amount, setAmount] = useState('')
  const { writeContract, data: hash, isPending } = useWriteContract()

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
  })

  // 获取 ETH 和 WETH 余额，添加 refetch
  const { data: ethBalance, refetch: refetchEthBalance } = useBalance({ address })
  const { data: wethBalance, refetch: refetchWethBalance } = useBalance({
    address,
    token: TOKENS.ETH.wrappedAddress as `0x${string}`,
  })

  // 交易确认后刷新余额
  useEffect(() => {
    if (isConfirmed && hash) {
      console.log('✅ Transaction confirmed:', hash)
      console.log('Refreshing balances in 2 seconds...')
      // 延迟 2 秒后刷新，给区块链一点时间同步
      setTimeout(() => {
        refetchEthBalance()
        refetchWethBalance()
        console.log('✅ Balances refreshed')
      }, 2000)

      // 清空输入
      setAmount('')
    }
  }, [isConfirmed, hash, refetchEthBalance, refetchWethBalance])

  // 手动刷新余额
  const handleRefresh = () => {
    refetchEthBalance()
    refetchWethBalance()
  }

  // 处理包装
  const handleWrap = async () => {
    if (!amount || parseFloat(amount) <= 0) return

    const amountWei = parseUnits(amount, 18)

    writeContract({
      address: TOKENS.ETH.wrappedAddress as `0x${string}`,
      abi: WETH_ABI,
      functionName: 'deposit',
      value: amountWei,
    })
  }

  // 处理解包
  const handleUnwrap = async () => {
    if (!amount || parseFloat(amount) <= 0) return

    const amountWei = parseUnits(amount, 18)

    writeContract({
      address: TOKENS.ETH.wrappedAddress as `0x${string}`,
      abi: WETH_ABI,
      functionName: 'withdraw',
      args: [amountWei],
    })
  }

  if (!isConnected) {
    return (
      <Card>
        <Alert
          title="请先连接钱包"
          description="连接钱包后即可包装/解包 ETH"
          type="info"
          showIcon
        />
      </Card>
    )
  }

  return (
    <Card>
      <Space orientation="vertical" style={{ width: '100%' }} size="large">
        <div>
          <Title level={4}>包装 ETH ↔ WETH</Title>
          <Text type="secondary">
            在添加流动性前，先包装 ETH → WETH
          </Text>
        </div>

        {/* 余额显示 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Text strong>ETH 余额</Text>
            <div style={{ fontSize: '20px', marginTop: '8px' }}>
              {ethBalance ? formatUnits(ethBalance.value, 18) : '0'} ETH
            </div>
          </div>
          <div>
            <Text strong>WETH 余额</Text>
            <div style={{ fontSize: '20px', marginTop: '8px' }}>
              {wethBalance ? formatUnits(wethBalance.value, 18) : '0'} WETH
            </div>
          </div>
        </div>

        {/* 刷新按钮 */}
        <Button onClick={handleRefresh} size="small">
          🔄 刷新余额
        </Button>

        {/* 调试信息 */}
        {process.env.NODE_ENV === 'development' && (
          <div className="text-xs text-gray-500 mt-2">
            <div>WETH 地址: {TOKENS.ETH.wrappedAddress}</div>
            {hash && <div>交易哈希: {hash}</div>}
          </div>
        )}

        {/* 输入数量 */}
        <div>
          <Text strong>数量</Text>
          <Input
            placeholder="输入数量"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="number"
            size="large"
            style={{ marginTop: '8px' }}
          />
        </div>

        {/* 操作按钮 */}
        <div className="grid grid-cols-2 gap-4">
          <Button
            type="primary"
            size="large"
            onClick={handleWrap}
            disabled={!amount || isPending || isConfirming}
            loading={isPending || isConfirming}
          >
            包装 ETH → WETH
          </Button>
          <Button
            size="large"
            onClick={handleUnwrap}
            disabled={!amount || isPending || isConfirming}
            loading={isPending || isConfirming}
          >
            解包 WETH → ETH
          </Button>
        </div>

        {/* 交易状态 */}
        {(isPending || isConfirming || isConfirmed) && (
          <Alert
            title={
              isPending ? '请在钱包确认交易...' :
              isConfirming ? '交易确认中...' :
              '✅ 交易成功！'
            }
            type={
              isPending ? 'info' :
              isConfirming ? 'warning' :
              'success'
            }
            showIcon
          />
        )}

        {/* 说明 */}
        <Alert
          title="说明"
          description={
            <div>
              <p>• <strong>包装 (Wrap)</strong>：将 ETH 转换为 WETH</p>
              <p>• <strong>解包 (Unwrap)</strong>：将 WETH 转换回 ETH</p>
              <p>• 1 ETH = 1 WETH，等价转换</p>
              <p>• 添加流动性需要使用 WETH</p>
            </div>
          }
          type="info"
          showIcon
        />
      </Space>
    </Card>
  )
}