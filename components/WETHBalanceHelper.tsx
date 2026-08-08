'use client'

import { useAccount, useBalance, useChainId } from 'wagmi'
import { formatUnits } from 'viem'
import { TOKENS } from '@/lib/constants'
import { useWETHBalance, logWETHInfo } from '@/hooks/useWETHBalance'
import { Card, Button, Typography, Space, Alert, Divider } from 'antd'
import React, { useEffect } from 'react'

const { Text, Title } = Typography

export function WETHBalanceHelper() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { wethBalance, ethBalance, isLoading, refetch } = useWETHBalance()

  // 组件加载时打印 WETH 信息
  useEffect(() => {
    logWETHInfo()
  }, [])

  const handleCopyAddress = async () => {
    const success = await navigator.clipboard.writeText(TOKENS.ETH.wrappedAddress)
    if (success) {
      alert('✅ WETH 地址已复制到剪贴板！\n\n现在你可以在 MetaMask 中粘贴并添加代币。')
    }
  }

  const handleAddToMetaMask = () => {
    const address = TOKENS.ETH.wrappedAddress
    console.log('Attempting to add WETH to MetaMask...',address);
    
    const tokenData = {
      type: 'ERC20',
      options: {
        address: address,
        symbol: 'WETH',
        decimals: 18,
        image: 'https://ethereum.org/static/a18372462c19c5d4636c5d3a26355765/309a7/wrapped-eth.png',
      },
    }

    // 尝试使用 MetaMask 的 wallet_watchAsset API
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      (window as any).ethereum.request({
        method: 'wallet_watchAsset',
        params: tokenData,
      }).then((success: boolean) => {
        if (success) {
          console.log('✅ WETH 已添加到 MetaMask')
        }
      }).catch((error: Error) => {
        console.warn('通过 API 添加失败，请手动添加:', error)
        alert(`请手动添加 WETH 到钱包：\n\n合约地址：${address}\n符号：WETH\n精度：18`)
      })
    } else {
      alert(`请手动添加 WETH 到钱包：\n\n合约地址：${address}\n符号：WETH\n精度：18`)
    }
  }

  if (!isConnected) {
    return (
      <Card>
        <Alert
          title="请先连接钱包"
          description="连接钱包后即可查看 WETH 余额"
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
          <Title level={4}>WETH 余额信息</Title>
          <Text type="secondary">
            钱包地址: {address?.slice(0, 6)}...{address?.slice(-4)}
          </Text>
          <br />
          <Text type="secondary">
            网络ID: {chainId} {chainId === 11155111 ? '(Sepolia)' : '(非 Sepolia 网络)'}
          </Text>
        </div>

        <Divider />

        {/* 网络警告 */}
        {chainId !== 11155111 && (
          <Alert
            title="请切换到 Sepolia 测试网"
            description="当前不在 Sepolia 网络上，无法正确显示 WETH 余额。"
            type="warning"
            showIcon
          />
        )}

        {/* ETH 余额 */}
        <div>
          <Text strong>ETH 余额：</Text>
          <div style={{ fontSize: '24px', marginTop: '8px' }}>
            {ethBalance ? (
              `${parseFloat(formatUnits(ethBalance.value, ethBalance.decimals)).toFixed(4)} ETH`
            ) : (
              '加载中...'
            )}
          </div>
        </div>

        {/* WETH 余额 */}
        <div>
          <Text strong>WETH 余额：</Text>
          <div style={{ fontSize: '24px', marginTop: '8px' }}>
            {isLoading ? (
              '加载中...'
            ) : wethBalance ? (
              `${parseFloat(formatUnits(wethBalance.value, wethBalance.decimals)).toFixed(4)} WETH`
            ) : (
              '0 WETH'
            )}
          </div>
        </div>

        <Divider />

        {/* 操作按钮 */}
        <Space wrap>
          <Button type="primary" onClick={handleAddToMetaMask}>
            添加 WETH 到钱包
          </Button>
          <Button onClick={handleCopyAddress}>
            复制 WETH 地址
          </Button>
          <Button onClick={() => refetch()}>
            刷新余额
          </Button>
        </Space>

        {/* 说明信息 */}
        <Alert
          title="关于 WETH 地址"
          description={
            <div>
              <p>• WETH 合约地址：<strong>{TOKENS.ETH.wrappedAddress}</strong></p>
              <p>• ⚠️ <strong>Sepolia 测试网使用不同的 WETH 地址</strong></p>
              <p>• 主网 WETH 地址（不适用于 Sepolia）: 0xC02...Cc2</p>
              <p>• WETH = Wrapped ETH (包装的 ETH)，用于 DeFi 协议</p>
            </div>
          }
          type="info"
          showIcon
        />

        {/* 获取测试 WETH 的说明 */}
        <Alert
          title="如何获取测试 WETH？"
          description={
            <div>
              <p>1. 确保 Sepolia 测试网有足够的 ETH</p>
              <p>2. 在我们的应用中添加流动性时选择 ETH</p>
              <p>3. 系统会自动将 ETH 包装成 WETH</p>
              <p>4. 或者访问 Sepolia Faucet 获取测试 ETH</p>
            </div>
          }
          type="success"
          showIcon
        />
      </Space>
    </Card>
  )
}