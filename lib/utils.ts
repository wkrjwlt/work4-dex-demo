// Utility functions for the DEX

import { formatUnits as viemFormatUnits, parseUnits as viemParseUnits } from 'viem'

/**
 * Format a bigint value to a readable string
 */
export function formatTokenAmount(
  value: bigint,
  decimals: number = 18,
  displayDecimals: number = 6
): string {
  const formatted = viemFormatUnits(value, decimals)
  const parts = formatted.split('.')

  if (parts.length === 1) {
    return parts[0]
  }

  const integerPart = parts[0]
  const decimalPart = parts[1].slice(0, displayDecimals)

  return `${integerPart}.${decimalPart}`
}

/**
 * Parse a string value to bigint
 */
export function parseTokenAmount(
  value: string,
  decimals: number = 18
): bigint {
  return viemParseUnits(value, decimals)
}

/**
 * Calculate tick from sqrtPriceX96
 */
export function sqrtPriceX96ToTick(sqrtPriceX96: bigint): number {
  const Q96 = BigInt(2) ** BigInt(96)
  const price = Number(sqrtPriceX96) / Number(Q96)
  return Math.floor(Math.log(price) / Math.log(1.0001))
}

/**
 * Calculate sqrtPriceX96 from tick
 */
export function tickToSqrtPriceX96(tick: number): bigint {
  const sqrtPrice = Math.pow(1.0001, tick / 2)
  const Q96 = BigInt(2) ** BigInt(96)
  return BigInt(Math.floor(sqrtPrice * Number(Q96)))
}

/**
 * Format address to shorter version
 */
export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

/**
 * Format fee to percentage
 */
export function formatFee(fee: number): string {
  return `${(fee / 10000).toFixed(2)}%`
}

/**
 * Calculate slippage amount
 */
export function calculateSlippageAmount(
  amount: bigint,
  slippagePercent: number
): bigint {
  return amount * BigInt(Math.floor(slippagePercent * 100)) / BigInt(10000)
}

/**
 * Check if a pool matches a token pair
 */
export function isPoolMatch(
  pool: { token0: string; token1: string },
  tokenA: string,
  tokenB: string
): boolean {
  return (
    (pool.token0.toLowerCase() === tokenA.toLowerCase() &&
      pool.token1.toLowerCase() === tokenB.toLowerCase()) ||
    (pool.token0.toLowerCase() === tokenB.toLowerCase() &&
      pool.token1.toLowerCase() === tokenA.toLowerCase())
  )
}

/**
 * Get deadline timestamp (default 20 minutes from now)
 */
export function getDeadline(minutes: number = 20): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + minutes * 60)
}