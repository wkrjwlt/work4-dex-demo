# MetaNodeSwap DEX

A decentralized exchange (DEX) built on the MetaNodeSwap protocol, featuring concentrated liquidity and multiple fee tiers.

## Features

- **Concentrated Liquidity**: Provide liquidity within specific price ranges for better capital efficiency
- **Multiple Fee Tiers**: Choose from different fee tiers (0.05%, 0.3%, 1%) based on your trading strategy
- **Flexible Pools**: Create pools with custom price ranges and fee structures
- **Fee Collection**: Automatically earn trading fees proportional to your liquidity contribution

## Tech Stack

- **Next.js 15** - React framework with App Router
- **React 19** - Latest React version
- **Wagmi** - React hooks for Ethereum
- **RainbowKit** - Wallet connection for React
- **Tailwind CSS 4** - Utility-first CSS framework
- **TypeScript** - Type-safe JavaScript
- **Viem** - TypeScript interface for Ethereum
- **Yarn** - Package manager (recommended)

## Getting Started

### Prerequisites

- Node.js 18+
- Yarn (preferred) or npm
- MetaMask or other Web3 wallet

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd work4-dex-demo
```

2. Install dependencies:
```bash
# Using Yarn (recommended)
yarn install

# Or using npm
npm install
```

3. Create `.env.local` file:
```bash
NEXT_PUBLIC_WETH9_ADDRESS=0xfFf997dA78462e4a79F7f8B8e9B3fC9bF7BfC7Ff
```

4. Run the development server:
```bash
# Using Yarn
yarn dev

# Or using npm
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
work4-dex-demo/
├── app/                    # Next.js App Router
│   ├── pool/              # Pool management page
│   ├── position/          # Position management page
│   ├── swap/              # Swap interface page
│   ├── layout.tsx         # Root layout with providers
│   ├── page.tsx           # Home page
│   ├── providers.tsx      # Web3 providers (Wagmi + RainbowKit)
│   └── globals.css        # Global styles
├── components/            # React components
│   ├── Header.tsx         # App header with wallet connection
│   ├── PoolList.tsx       # Pool list display
│   ├── CreatePoolModal.tsx # Pool creation modal
│   ├── PositionList.tsx   # Position list display
│   ├── AddLiquidityModal.tsx # Liquidity addition modal
│   └── SwapInterface.tsx  # Swap interface component
├── lib/                   # Utility libraries
│   ├── constants.ts       # Contract addresses and token configs
│   └── contracts.ts       # Contract ABIs
├── img/                   # Image assets
└── public/               # Public assets

```

## Available Pages

### 1. Pool Page (`/pool`)
- View all available liquidity pools
- Create new pools with custom parameters:
  - Token pair selection
  - Fee tier
  - Price range (tick range)
  - Initial price
  - Initial liquidity (optional)

### 2. Position Page (`/position`)
- View your liquidity positions
- Add liquidity to existing pools
- Remove liquidity (Burn)
- Collect earned fees

### 3. Swap Page (`/swap`)
- Swap tokens with optimal routing
- Select input/output tokens
- Choose from available pools
- Set slippage tolerance
- Approve and execute swaps

## Smart Contract Interaction

The DApp interacts with the following smart contracts:

- **PoolManager**: Manages pool creation and retrieval
- **PositionManager**: Manages LP positions (ERC721)
- **SwapRouter**: Handles token swaps across pools
- **Pool**: Individual pool contracts

## Development

### Contract ABIs

Contract ABIs are defined in `lib/contracts.ts` and include:
- `POOL_MANAGER_ABI`
- `POSITION_MANAGER_ABI`
- `SWAP_ROUTER_ABI`
- `POOL_ABI`
- `ERC20_ABI`

### Token Configuration

Token addresses and configurations are in `lib/constants.ts`:
- Test tokens: MNA, MNB, MNC, MND
- ETH (native and wrapped)
- Network: Sepolia testnet

## Network

The DApp is configured for the **Sepolia testnet**:
- Chain ID: 11155111
- RPC URL: Configurable via `SEPOLIA_RPC_URL`
- Block Explorer: https://sepolia.etherscan.io

## Quick Commands

```bash
# Clean install
yarn install

# Development server
yarn dev

# Build for production
yarn build

# Start production server
yarn start
```

## Troubleshooting

If you encounter dependency issues:

1. Run the clean script:
```bash
clean.bat
```

2. Reinstall dependencies:
```bash
yarn install
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.

## Support

For support, please open an issue in the repository or contact the development team.