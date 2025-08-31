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

// Generate 50 levels with progressive difficulty.
export const levelConfig: LevelConfig[] = Array.from({ length: 50 }, (_, i) => {
  const level = i + 1
  // Score grows steadily: +10 per level step
  const scoreMultiplier = level // L1=1 -> +10, L50=50 -> +500

  // Bird speed scales across bands
  const speedBand =
    level <= 10 ? 0.8 :
    level <= 20 ? 1.0 :
    level <= 30 ? 1.15 :
    level <= 40 ? 1.3 :
    level < 50 ? 1.45 : 1.6

  // Spawn rate: faster at higher levels (lower ms)
  const spawnRate = Math.max(260, 1100 - level * 14)

  // Bird types per band
  let birdTypes: BirdKind[] = ['simple']
  if (level >= 11) birdTypes = ['simple', 'fast']
  if (level >= 15) birdTypes = ['simple', 'fast', 'zigzag']
  if (level >= 21) birdTypes = ['simple', 'fast', 'zigzag', 'tanky']
  if (level % 5 === 0) birdTypes = [...birdTypes, 'boss']
  if (level === 50) birdTypes = ['boss']

  // Power-up drops get rarer later
  const powerUpRate = level <= 15 ? 0.22 : level <= 30 ? 0.16 : level <= 45 ? 0.1 : 0.06

  // Kills required grow with level; more for later levels
  const killsRequired =
    level <= 10 ? 8 + Math.floor(level / 2) :
    level <= 20 ? 12 + Math.floor((level - 10) / 2) :
    level <= 30 ? 16 + Math.floor((level - 20) / 2) :
    level <= 40 ? 18 + Math.floor((level - 30) / 2) :
    level < 50 ? 20 + Math.floor((level - 40) / 2) : 1 // final boss only

  // Target score for this level
  const targetScore = 10 * scoreMultiplier * killsRequired

  return { level, birdSpeed: speedBand, spawnRate, birdTypes, scoreMultiplier, targetScore, powerUpRate }
})
