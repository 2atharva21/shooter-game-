export type BirdKind = 'simple' | 'fast' | 'zigzag' | 'tanky' | 'boss'
export type LevelConfig = {
  level: number
  birdSpeed: number // base speed scalar
  spawnRate: number // average ms between spawns
  birdTypes: BirdKind[]
  scoreMultiplier: number // points per kill = 10 * scoreMultiplier
  targetScore: number // points needed this level to clear
  powerUpRate: number // 0..1 chance on kill
}

function getSpeedBand(level: number): number {
  if (level <= 10) return 0.8
  if (level <= 20) return 1.0
  if (level <= 30) return 1.15
  if (level <= 40) return 1.3
  if (level < 50) return 1.45
  return 1.6
}

function getBirdTypes(level: number): BirdKind[] {
  if (level === 50) return ['boss']
  
  let birdTypes: BirdKind[] = ['simple']
  if (level >= 11) birdTypes = ['simple', 'fast']
  if (level >= 15) birdTypes = ['simple', 'fast', 'zigzag']
  if (level >= 21) birdTypes = ['simple', 'fast', 'zigzag', 'tanky']
  if (level % 5 === 0) birdTypes = [...birdTypes, 'boss']
  
  return birdTypes
}

function getPowerUpRate(level: number): number {
  if (level <= 15) return 0.22
  if (level <= 30) return 0.16
  if (level <= 45) return 0.1
  return 0.06
}

function getKillsRequired(level: number): number {
  if (level === 50) return 1 // final boss only
  if (level <= 10) return 8 + Math.floor(level / 2)
  if (level <= 20) return 12 + Math.floor((level - 10) / 2)
  if (level <= 30) return 16 + Math.floor((level - 20) / 2)
  if (level <= 40) return 18 + Math.floor((level - 30) / 2)
  return 20 + Math.floor((level - 40) / 2)
}

// Generate 50 levels with progressive difficulty.
export const levelConfig: LevelConfig[] = Array.from({ length: 50 }, (_, i) => {
  const level = i + 1
  const scoreMultiplier = level // L1=1 -> +10, L50=50 -> +500
  const birdSpeed = getSpeedBand(level)
  const spawnRate = Math.max(260, 1100 - level * 14)
  const birdTypes = getBirdTypes(level)
  const powerUpRate = getPowerUpRate(level)
  const killsRequired = getKillsRequired(level)
  const targetScore = 10 * scoreMultiplier * killsRequired

  return { level, birdSpeed, spawnRate, birdTypes, scoreMultiplier, targetScore, powerUpRate }
})
