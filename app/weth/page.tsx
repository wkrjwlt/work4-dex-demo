'use client'

import React from 'react'
import { WETHBalanceHelper } from '@/components/WETHBalanceHelper'
import { WETHDiagnostic } from '@/components/WETHDiagnostic'
import { Typography, Divider } from 'antd'

const { Title, Paragraph } = Typography

export default function WETHPage() {
  return (
    <div style={{ maxWidth: '800px', margin: '40px auto', padding: '20px' }}>
      <Title>WETH 余额与帮助</Title>

      <Paragraph>
        在这个页面，你可以查看你的 WETH 余额，并了解如何将 WETH 添加到 MetaMask 钱包。
      </Paragraph>

      <Divider />

      <WETHBalanceHelper />

      <Divider />

      <WETHDiagnostic />

      <Divider />

      <div style={{ marginTop: '40px' }}>
        <Title level={3}>常见问题</Title>

        <div style={{ marginBottom: '20px' }}>
          <Title level={4}>Q: 为什么 Sepolia 的 WETH 地址和主网一样？</Title>
          <Paragraph>
            A: WETH (Wrapped ETH) 是一个标准的 ERC-20 代币，在所有以太坊网络（主网和测试网）上都使用相同的合约地址。
            这是设计如此，不是错误。
          </Paragraph>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <Title level={4}>Q: MetaMask 提示"地址与主网代币匹配"怎么办？</Title>
          <Paragraph>
            A: 这个提示可以安全忽略。在 Sepolia 网络上，WETH 的地址确实是主网的地址。
            点击"下一步"或"我了解风险"继续添加即可。
          </Paragraph>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <Title level={4}>Q: 如何获取测试 WETH？</Title>
          <Paragraph>
            A: 你可以通过以下方式获取测试 WETH：
          </Paragraph>
          <ul>
            <li>在我们的应用中添加流动性时选择 ETH，系统会自动包装成 WETH</li>
            <li>手动调用 WETH 合约的 deposit() 方法</li>
            <li>使用我们的 ETH → WETH 转换功能（即将推出）</li>
          </ul>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <Title level={4}>Q: WETH 和 ETH 有什么区别？</Title>
          <Paragraph>
            A: ETH 是以太坊的原生代币，WETH 是符合 ERC-20 标准的包装版本。
            WETH 主要用于 DeFi 协议，因为大多数智能合约更容易处理 ERC-20 代币。
            你可以随时将 WETH 解包回 ETH。
          </Paragraph>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <Title level={4}>Q: 如何手动添加 WETH 到 MetaMask？</Title>
          <Paragraph>
            A: 按照以下步骤操作：
          </Paragraph>
          <ol>
            <li>打开 MetaMask</li>
            <li>确保已切换到 Sepolia 网络</li>
            <li>点击"导入代币"</li>
            <li>选择"自定义代币"</li>
            <li>输入地址：<code>0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2</code></li>
            <li>代币符号：WETH，精度：18</li>
            <li>点击"添加自定义代币"</li>
          </ol>
        </div>
      </div>

      <Divider />

      <div style={{ marginTop: '40px', padding: '20px', background: '#f5f5f5', borderRadius: '8px' }}>
        <Title level={4}>快速链接</Title>
        <Paragraph>
          • <a href="https://sepolia.etherscan.io/address/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" target="_blank" rel="noopener noreferrer">
            在 Sepolia Etherscan 查看 WETH 合约
          </a>
        </Paragraph>
        <Paragraph>
          • <a href="https://faucet.quicknode.com/ethereum/sepolia" target="_blank" rel="noopener noreferrer">
            获取 Sepolia 测试 ETH
          </a>
        </Paragraph>
      </div>
    </div>
  )
}