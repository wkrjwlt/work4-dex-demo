/**
 * TickMath - Uniswap V3 Tick数学工具
 * 用于tick和sqrtPriceX96之间的转换
 */

/// @dev 最小tick
export const MIN_TICK = -887272
/// @dev 最大tick
export const MAX_TICK = 887272
/// @dev 最小sqrtPriceX96
export const MIN_SQRT_RATIO = 4295128739n
/// @dev 最大sqrtPriceX96
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n

/// @dev 2^96
const Q96 = BigInt(2) ** BigInt(96)

/**
 * 计算给定tick的sqrtPriceX96
 * sqrtPriceX96 = sqrt(1.0001^tick) * 2^96
 */
export function getSqrtRatioAtTick(tick: number): bigint {
  const absTick = Math.abs(tick)

  let ratio = (absTick & 0x1) !== 0
    ? BigInt('0xfffcb933bd6fad37aa2d162d07a86e4a')
    : BigInt('0x100000000000000000000000000000000')

  if ((absTick & 0x2) !== 0) {
    ratio = (ratio * BigInt('0xfff97272373d413259a46990539e76df')) >> 128n
  }
  if ((absTick & 0x4) !== 0) {
    ratio = (ratio * BigInt('0xfff2e50f5f656932ef12357cf3c7fdcc')) >> 128n
  }
  if ((absTick & 0x8) !== 0) {
    ratio = (ratio * BigInt('0xffe5caca7e10e4e61c3624eaa0941cd0')) >> 128n
  }
  if ((absTick & 0x10) !== 0) {
    ratio = (ratio * BigInt('0xffcb9843d60f6159c9db5c8fa6c4c2a2')) >> 128n
  }
  if ((absTick & 0x20) !== 0) {
    ratio = (ratio * BigInt('0xff973b41fa98c081472e6896dfb254c0')) >> 128n
  }
  if ((absTick & 0x40) !== 0) {
    ratio = (ratio * BigInt('0xff2eaade66c10c8b6d3a5e9c4a1c2b0c')) >> 128n
  }
  if ((absTick & 0x80) !== 0) {
    ratio = (ratio * BigInt('0xfe5dee55d0c1a6a1c9b7a5e9c4a1c2b0c')) >> 128n
  }
  if ((absTick & 0x100) !== 0) {
    ratio = (ratio * BigInt('0xffcbe4d1fc19f1dd9a3c5a5b5b5b5b5b')) >> 128n
  }
  if ((absTick & 0x200) !== 0) {
    ratio = (ratio * BigInt('0xffe5caca7e10e4e61c3624eaa0941cd0')) >> 128n
  }
  if ((absTick & 0x400) !== 0) {
    ratio = (ratio * BigInt('0xfff2e50f5f656932ef12357cf3c7fdcc')) >> 128n
  }
  if ((absTick & 0x800) !== 0) {
    ratio = (ratio * BigInt('0xfff97272373d413259a46990539e76df')) >> 128n
  }
  if ((absTick & 0x1000) !== 0) {
    ratio = (ratio * BigInt('0xfffcb933bd6fad37aa2d162d07a86e4a')) >> 128n
  }
  if ((absTick & 0x2000) !== 0) {
    ratio = (ratio * BigInt('0x100000000000000000000000000000000')) >> 128n
  }
  if ((absTick & 0x4000) !== 0) {
    ratio = (ratio * BigInt('0x10005af3107a3a2a1a1a1a1a1a1a1a1a1a')) >> 128n
  }
  if ((absTick & 0x8000) !== 0) {
    ratio = (ratio * BigInt('0x1000bce506e4e9d9d9d9d9d9d9d9d9d9d9d')) >> 128n
  }
  if ((absTick & 0x10000) !== 0) {
    ratio = (ratio * BigInt('0x1000d7e2b9e4e4e4e4e4e4e4e4e4e4e4e4e')) >> 128n
  }
  if ((absTick & 0x20000) !== 0) {
    ratio = (ratio * BigInt('0x1000e4e4e4e4e4e4e4e4e4e4e4e4e4e4e4e')) >> 128n
  }
  if ((absTick & 0x40000) !== 0) {
    ratio = (ratio * BigInt('0x1000f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f')) >> 128n
  }
  if (tick > 0) {
    ratio = ratio >> 128n
  }

  return ratio >> 32n
}

/**
 * 计算给定sqrtPriceX96对应的tick
 */
export function getTickAtSqrtRatio(sqrtPriceX96: bigint): number {
  // 简化实现：使用近似计算
  // tick = log1.0001(sqrtPriceX96^2 / 2^192)
  const price = Number(sqrtPriceX96) ** 2 / Number(Q96) ** 2
  const tick = Math.log(price) / Math.log(1.0001)
  return Math.floor(tick)
}

/**
 * 计算给定价格的sqrtPriceX96
 * sqrtPriceX96 = sqrt(price) * 2^96
 */
export function getSqrtRatioAtPrice(price: number): bigint {
  if (price <= 0 || !isFinite(price)) {
    return BigInt(0)
  }

  const sqrtPrice = Math.sqrt(price)
  const result = BigInt(Math.floor(sqrtPrice * Number(Q96)))

  // 确保在有效范围内
  if (result < MIN_SQRT_RATIO) return MIN_SQRT_RATIO
  if (result > MAX_SQRT_RATIO) return MAX_SQRT_RATIO

  return result
}

/**
 * 从sqrtPriceX96计算价格
 * price = (sqrtPriceX96 / 2^96)^2
 */
export function getPriceAtSqrtRatio(sqrtPriceX96: bigint): number {
  const sqrtPrice = Number(sqrtPriceX96) / Number(Q96)
  return sqrtPrice ** 2
}

/**
 * 计算价格对应的tick
 */
export function getTickAtPrice(price: number): number {
  if (price <= 0 || !isFinite(price)) {
    return 0
  }
  const tick = Math.log(price) / Math.log(1.0001)
  return Math.floor(tick)
}

/**
 * 计算tick对应的价格
 */
export function getPriceAtTick(tick: number): number {
  return Math.pow(1.0001, tick)
}

/**
 * 计算价格影响
 */
export function calculatePriceImpact(
  sqrtPriceX96Before: bigint,
  sqrtPriceX96After: bigint,
  zeroForOne: boolean
): number {
  const priceBefore = getPriceAtSqrtRatio(sqrtPriceX96Before)
  const priceAfter = getPriceAtSqrtRatio(sqrtPriceX96After)

  if (priceBefore === 0) return 0

  if (zeroForOne) {
    // token0 -> token1: 价格应该下降
    return Math.abs((priceAfter - priceBefore) / priceBefore) * 100
  } else {
    // token1 -> token0: 价格应该上升
    return Math.abs((priceAfter - priceBefore) / priceBefore) * 100
  }
}