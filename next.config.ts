import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 静态导出配置（用于 Cloudflare Pages）
  output: 'export',

  // 图片优化配置（静态导出不支持 next/image 优化）
  images: {
    unoptimized: true,
  },

  webpack: (config, { isServer }) => {
    // 忽略特定的可选依赖
    config.externals = config.externals || [];
    if (Array.isArray(config.externals)) {
      config.externals.push("pino-pretty", "lokijs", "encoding");
    }

    // 忽略所有 @x402 模块（这些是可选依赖）
    config.resolve.alias = {
      ...config.resolve.alias,
      '@x402/evm/upto/client': false,
      '@x402/evm/exact/client': false,
      '@x402/core/client': false,
      '@x402/svm/exact/client': false,
      '@x402/svm/upto/client': false,
      '@x402': false,
      // 忽略 React Native 模块（用于 MetaMask SDK）
      '@react-native-async-storage/async-storage': false,
      'react-native': false,
    };

    // 忽略可选依赖的警告
    config.ignoreWarnings = [
      { module: /@coinbase\/cdp-sdk/ },
      { module: /@x402/ },
      { module: /@metamask\/sdk/ },
    ];

    return config;
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;