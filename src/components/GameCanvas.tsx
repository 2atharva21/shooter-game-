import React, { useEffect, useRef, useState } from 'react'
import { levelConfig } from '../game/levels.ts'

type Vec = { x: number; y: number }

type BulletKind = 'normal' | 'strong' | 'homing'
type Bullet = { pos: Vec; vel: Vec; w: number; h: number; pierce?: number; kind?: BulletKind }
type BirdType = 'simple' | 'fast' | 'zigzag' | 'tanky' | 'boss'
type Bird = { pos: Vec; vel: Vec; w: number; h: number; t: number; hp: number; type: BirdType }
type PowerUpType = 'double' | 'rapid' | 'shield'
type PowerUp = { pos: Vec; vel: Vec; w: number; h: number; type: PowerUpType }
type Particle = { pos: Vec; vel: Vec; life: number; color: string }

type Props = {
  running: boolean
  session: number
  level: number
  score: number
  onAddScore: (amount: number) => void
  onLoseLife: () => void
  onLevelCleared: () => void
  onPause?: () => void
  musicOn?: boolean
  onToggleMusic?: () => void
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const rand = (a: number, b: number) => a + Math.random() * (b - a)

// --- audio utilities (module scope) ---
type AudioPoolAPI = { play: () => Promise<void>; dispose: () => void }

function createAudioPool(url: string, size: number, volume: number): AudioPoolAPI {
  let items: HTMLAudioElement[] = []
  let idx = 0
  for (let i = 0; i < size; i++) {
    const a = new Audio(url)
    a.preload = 'auto'
    a.volume = volume
    ;(a as any).webkitPreservesPitch = true
    items.push(a)
  }
  const play = async (): Promise<void> => {
    const cand = items.find(x => x.ended || x.paused) ?? items[idx]
    idx = (idx + 1) % items.length
    cand.currentTime = 0
    try { await cand.play() } catch { /* ignore, will use fallback from caller */ }
  }
  const dispose = (): void => {
    items.forEach(a => { a.pause() })
    items = []
  }
  return { play, dispose }
}

function getAudioContext(ref: React.RefObject<AudioContext | null> & { current: AudioContext | null }): AudioContext {
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext
  ref.current ??= new Ctor()
  return ref.current as AudioContext
}

function playBeep(ref: React.RefObject<AudioContext | null> & { current: AudioContext | null }, freq = 900, duration = 0.06, volume = 0.2): void {
  const ctx = getAudioContext(ref)
  void ctx.resume().catch(() => {})
  const t0 = ctx.currentTime
  const osc = ctx.createOscillator()
  osc.type = 'square'
  osc.frequency.value = freq
  const gain = ctx.createGain()
  gain.gain.value = volume
  gain.gain.setValueAtTime(volume, t0)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + duration)
}

function playExplosionSweep(ref: React.RefObject<AudioContext | null> & { current: AudioContext | null }, duration = 0.18, volume = 0.25): void {
  const ctx = getAudioContext(ref)
  void ctx.resume().catch(() => {})
  const t0 = ctx.currentTime
  const osc = ctx.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(600, t0)
  osc.frequency.exponentialRampToValueAtTime(80, t0 + duration)
  const gain = ctx.createGain()
  gain.gain.value = volume
  gain.gain.setValueAtTime(volume, t0)
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + duration)
}

export default function GameCanvas(props: Readonly<Props>) {
  const { running, session, level, score, onAddScore, onLoseLife, onLevelCleared } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  // virtual resolution and scale
  const VIRTUAL_W = 480
  const VIRTUAL_H = 270
  const scaleRef = useRef(1)
  // sound refs
  const shootPoolRef = useRef<{ play: () => Promise<void>; dispose: () => void } | null>(null)
  const explosionPoolRef = useRef<{ play: () => Promise<void>; dispose: () => void } | null>(null)
  const levelUpPoolRef = useRef<{ play: () => Promise<void>; dispose: () => void } | null>(null)
  const bossPoolRef = useRef<{ play: () => Promise<void>; dispose: () => void } | null>(null)
  const powerupPoolRef = useRef<{ play: () => Promise<void>; dispose: () => void } | null>(null)
  const upgradePoolRef = useRef<{ play: () => Promise<void>; dispose: () => void } | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  // Player state
  const playerRef = useRef({ pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, w: 40, h: 20, canShoot: true })
  const keysRef = useRef<Record<string, boolean>>({})
  const bulletsRef = useRef<Bullet[]>([])
  const birdsRef = useRef<Bird[]>([])
  const lastSpawnRef = useRef(0)
  const powerUpsRef = useRef<PowerUp[]>([])
  const particlesRef = useRef<Particle[]>([])
  const levelStartScoreRef = useRef(0)
  const levelProgressRef = useRef(0)
  const clearingLevelRef = useRef(false)
  const bossAliveRef = useRef(false)
  const comboRef = useRef({ lastHit: 0, count: 0 })
  const comboTextRef = useRef<{ x: number; y: number; until: number; text: string } | null>(null)
  const bannerRef = useRef<{ text: string; until: number } | null>(null)
  const laserUntilRef = useRef(0)
  const laserNextAtRef = useRef(0)

  // Shooting cooldown and upgrades
  const shootCooldownRef = useRef(0) // ms
  const rapidUntilRef = useRef(0)
  const doubleUntilRef = useRef(0)
  const shieldChargesRef = useRef(0)

  // touch/virtual input helpers
  const setKey = (k: string, v: boolean) => { keysRef.current[k] = v }
  const pressShoot = () => { setKey(' ', true); setKey('space', true) }
  const releaseShoot = () => { setKey(' ', false); setKey('space', false) }
  const axisRef = useRef(0) // -1..1 for joystick/swipe
  const swipeActiveRef = useRef(false)
  const swipeStartXRef = useRef(0)
  const [oneHand, setOneHand] = useState(false)
  // vibration helpers
  const nextShootBuzzAtRef = useRef(0)
  const vibrate = (pat: number | number[]) => {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) (navigator as any).vibrate(pat)
    } catch { /* ignore */ }
  }

  // Responsive resize: fit window while preserving aspect, scale draw only
  useEffect(() => {
    const canvas = canvasRef.current!
    const onResize = () => {
      const dpr = window.devicePixelRatio || 1
      const ww = window.innerWidth
      const wh = window.innerHeight
      const scale = Math.max(0.5, Math.min(ww / VIRTUAL_W, wh / VIRTUAL_H))
      scaleRef.current = scale
      canvas.width = Math.floor(VIRTUAL_W * scale * dpr)
      canvas.height = Math.floor(VIRTUAL_H * scale * dpr)
      canvas.style.width = Math.floor(VIRTUAL_W * scale) + 'px'
      canvas.style.height = Math.floor(VIRTUAL_H * scale) + 'px'
      // center canvas if parent is larger
      const parent = canvas.parentElement
      if (parent) {
        parent.style.display = 'flex'
        parent.style.alignItems = 'center'
        parent.style.justifyContent = 'center'
      }
      const player = playerRef.current
      player.pos.x = VIRTUAL_W / 2
      player.pos.y = VIRTUAL_H - 40
    }
    onResize()
    window.addEventListener('resize', onResize)
    screen.orientation?.addEventListener?.('change', onResize as any)
    return () => {
      window.removeEventListener('resize', onResize)
      screen.orientation?.removeEventListener?.('change', onResize as any)
    }
  }, [])

  // Shooter upgrade helpers
  type ShooterUpgrade = {
    cooldown: number
    pattern: 'single' | 'double' | 'spread3' | 'pierce' | 'quad' | 'spread6' | 'rapid' | 'ultimate' | 'homing'
    bullet: { w: number; h: number; speed: number; pierce: number; kind: BulletKind }
    angles?: number[]
    sideBySide?: boolean
  }
  function getUpgrade(lv: number): ShooterUpgrade {
    if (lv >= 50) return { cooldown: 60, pattern: 'ultimate', bullet: { w: 6, h: 12, speed: 12, pierce: 3, kind: 'strong' }, angles: [-18,-12,-6,6,12,18] }
    if (lv >= 45) return { cooldown: 160, pattern: 'spread6', bullet: { w: 4, h: 10, speed: 10, pierce: 1, kind: 'normal' }, angles: [-18,-12,-6,6,12,18] }
    if (lv >= 40) return { cooldown: 60, pattern: 'rapid', bullet: { w: 4, h: 10, speed: 9, pierce: 1, kind: 'normal' } }
    if (lv >= 35) return { cooldown: 120, pattern: 'homing', bullet: { w: 4, h: 10, speed: 10, pierce: 1, kind: 'homing' }, angles: [-6,6] }
    if (lv >= 30) return { cooldown: 140, pattern: 'quad', bullet: { w: 4, h: 10, speed: 10, pierce: 1, kind: 'normal' }, angles: [-12,-4,4,12] }
    if (lv >= 25) return { cooldown: 150, pattern: 'quad', bullet: { w: 4, h: 10, speed: 10, pierce: 1, kind: 'normal' }, angles: [-12,-4,4,12] }
    if (lv >= 20) return { cooldown: 120, pattern: 'pierce', bullet: { w: 6, h: 12, speed: 12, pierce: 2, kind: 'strong' } }
    if (lv >= 15) return { cooldown: 150, pattern: 'spread3', bullet: { w: 4, h: 10, speed: 10, pierce: 1, kind: 'normal' }, angles: [-10,0,10] }
    if (lv >= 10) return { cooldown: 130, pattern: 'double', bullet: { w: 4, h: 10, speed: 10, pierce: 1, kind: 'normal' }, sideBySide: true }
    if (lv >= 5) return { cooldown: 130, pattern: 'single', bullet: { w: 4, h: 10, speed: 10, pierce: 1, kind: 'normal' } }
    return { cooldown: 200, pattern: 'single', bullet: { w: 4, h: 10, speed: 9, pierce: 1, kind: 'normal' } }
  }

  // Input handling
  useEffect(() => {
    const down = (e: KeyboardEvent) => { keysRef.current[e.key.toLowerCase()] = true }
    const up = (e: KeyboardEvent) => { keysRef.current[e.key.toLowerCase()] = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // No shooting interval; handled in update() via cooldown

  // Reset entities when a new session starts (Restart or new level)
  useEffect(() => {
    // clear all entities and reset player
    bulletsRef.current = []
    birdsRef.current = []
    powerUpsRef.current = []
    particlesRef.current = []
    const canvas = canvasRef.current
    if (canvas) {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.width / dpr
      const h = canvas.height / dpr
      const player = playerRef.current
      player.pos.x = w / 2
      player.pos.y = h - 40
      player.vel.x = 0
    }
    lastSpawnRef.current = performance.now()
    shootCooldownRef.current = 0
    rapidUntilRef.current = 0
    doubleUntilRef.current = 0
    shieldChargesRef.current = 0
    levelStartScoreRef.current = score
    levelProgressRef.current = 0
    clearingLevelRef.current = false
    bossAliveRef.current = false
    bannerRef.current = null
    laserUntilRef.current = 0
    laserNextAtRef.current = 0
  }, [session])

  // Initialize audio pools once
  useEffect(() => {
    const shoot = createAudioPool('/shoot.mp3', 8, 0.25)
    const boom = createAudioPool('/explosion.mp3', 6, 0.3)
  const levelup = createAudioPool('/levelup.mp3', 4, 0.35)
  const boss = createAudioPool('/boss.mp3', 4, 0.35)
  const powerup = createAudioPool('/powerup.mp3', 6, 0.35)
  const upgrade = createAudioPool('/upgrade.mp3', 4, 0.35)
    const playShoot = async () => { try { await shoot.play() } catch { playBeep(audioCtxRef, 950, 0.05, 0.18) } }
    const playBoom = async () => { try { await boom.play() } catch { playExplosionSweep(audioCtxRef, 0.22, 0.25) } }
    const playLevelUp = async () => { try { await levelup.play() } catch { playBeep(audioCtxRef, 1200, 0.08, 0.25) } }
    const playBoss = async () => { try { await boss.play() } catch { playExplosionSweep(audioCtxRef, 0.35, 0.2) } }
    shootPoolRef.current = { play: playShoot, dispose: () => shoot.dispose() }
    explosionPoolRef.current = { play: playBoom, dispose: () => boom.dispose() }
  levelUpPoolRef.current = { play: playLevelUp, dispose: () => levelup.dispose() }
  bossPoolRef.current = { play: playBoss, dispose: () => boss.dispose() }
  powerupPoolRef.current = { play: async () => { try { await powerup.play() } catch { playBeep(audioCtxRef, 1500, 0.06, 0.22) } }, dispose: () => powerup.dispose() }
  upgradePoolRef.current = { play: async () => { try { await upgrade.play() } catch { playBeep(audioCtxRef, 1800, 0.07, 0.25) } }, dispose: () => upgrade.dispose() }
    return () => {
      shootPoolRef.current?.dispose()
      explosionPoolRef.current?.dispose()
  levelUpPoolRef.current?.dispose()
  bossPoolRef.current?.dispose()
  powerupPoolRef.current?.dispose()
  upgradePoolRef.current?.dispose()
      shootPoolRef.current = null
      explosionPoolRef.current = null
  levelUpPoolRef.current = null
  bossPoolRef.current = null
  powerupPoolRef.current = null
  upgradePoolRef.current = null
    }
  }, [])

  // Main loop (depends on running and level to reconfigure spawn/behavior)
  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let last = performance.now()
    const cfg = levelConfig[Math.min(levelConfig.length, Math.max(1, level)) - 1]

    // laser cadence setup from level 30
    if (level >= 30 && laserNextAtRef.current === 0) laserNextAtRef.current = performance.now() + 30000

    // upgrade banner and sound on milestone levels
    if (level > 1) {
      const milestones = [5,10,15,20,25,30,35,40,45,50]
      if (milestones.includes(level)) {
        bannerRef.current = { text: 'SHOOTER UPGRADED!', until: performance.now() + 1500 }
        upgradePoolRef.current?.play()
      }
    }

    // helpers
    function pickType(types: BirdType[]): BirdType {
      const pool: BirdType[] = []
      for (const t of types) {
        let weight = 0
        if (t === 'simple') weight = 4
        else if (t === 'fast') weight = 3
        else if (t === 'zigzag') weight = 2
        else if (t === 'tanky') weight = 1
        for (let i = 0; i < weight; i++) pool.push(t)
      }
      return pool.length ? pool[Math.floor(rand(0, pool.length))] : 'simple'
    }

    function spawnBoss(w: number, speedScale: number) {
      bossAliveRef.current = true
      const bx = w / 2
      const by = -50
      const hp = level === 50 ? 22 : Math.max(6, 4 + Math.floor(level / 5))
      birdsRef.current.push({ pos: { x: bx, y: by }, vel: { x: 0, y: 40 * speedScale }, w: 70, h: 48, t: 0, hp, type: 'boss' })
      bossPoolRef.current?.play()
    }

    function spawnFromTop(type: BirdType, w: number, speedScale: number) {
      const x = rand(20, w - 20)
      const y = -20
      const vx = (type === 'zigzag' ? rand(-40, 40) : rand(-30, 30)) * speedScale
      const vy = (type === 'fast' ? rand(80, 140) : rand(30, 90)) * speedScale
      const hp = type === 'tanky' ? 3 : 1
      const size = type === 'tanky' ? { w: 28, h: 20 } : { w: 24, h: 16 }
      birdsRef.current.push({ pos: { x, y }, vel: { x: vx, y: vy }, w: size.w, h: size.h, t: 0, hp, type })
    }

    function spawnFromSide(type: BirdType, w: number, speedScale: number) {
      const side = Math.random() < 0.5 ? -1 : 1
      const x = side < 0 ? -20 : w + 20
      const y = rand(40, 200)
      const vx = side * (type === 'fast' ? rand(120, 180) : rand(60, 120)) * speedScale
      const vy = (type === 'zigzag' ? rand(-20, 40) : rand(-10, 30)) * speedScale
      const hp = type === 'tanky' ? 3 : 1
      const size = type === 'tanky' ? { w: 28, h: 20 } : { w: 24, h: 16 }
      birdsRef.current.push({ pos: { x, y }, vel: { x: vx, y: vy }, w: size.w, h: size.h, t: 0, hp, type })
    }

    function spawnNormalBird(type: BirdType, w: number, speedScale: number) {
      if (Math.random() < 0.4) spawnFromTop(type, w, speedScale)
      else spawnFromSide(type, w, speedScale)
    }

  const step = (now: number) => {
      const dt = Math.min(1 / 30, (now - last) / 1000)
      last = now
      update(dt)
      draw(ctx)
      rafRef.current = requestAnimationFrame(step)
    }

    function spawnBird(now: number) {
      const w = VIRTUAL_W
      const speedScale = cfg.birdSpeed
      const types = cfg.birdTypes
      const spawnBossOnly = types.length === 1 && types[0] === 'boss'
      if (types.includes('boss') && !bossAliveRef.current) {
        spawnBoss(w, speedScale)
      }
      if (spawnBossOnly) { lastSpawnRef.current = now; return }
      const type = pickType(types)
      spawnNormalBird(type, w, speedScale)
      lastSpawnRef.current = now
    }

    function fireBullets(px: number, py: number, up: ReturnType<typeof getUpgrade>) {
      const pushBullet = (vx: number, vy: number, offsetX = 0) => {
        bulletsRef.current.push({ pos: { x: px + offsetX, y: py }, vel: { x: vx, y: vy }, w: up.bullet.w, h: up.bullet.h, pierce: up.bullet.pierce, kind: up.bullet.kind })
      }
      const vy = -up.bullet.speed
      switch (up.pattern) {
        case 'single':
        case 'pierce': pushBullet(0, vy); break
        case 'double':
          if (up.sideBySide) { pushBullet(0, vy, -10); pushBullet(0, vy, 10) } else { pushBullet(0, vy) }
          break
        case 'spread3':
        case 'quad':
        case 'spread6':
        case 'ultimate': {
          const angles = up.angles || [0]
          for (const ang of angles) {
            const rad = ang * Math.PI / 180
            const vx = Math.sin(rad) * Math.abs(vy)
            const vyy = vy * Math.cos(rad)
            pushBullet(vx, vyy)
          }
          if (up.pattern === 'ultimate') pushBullet(0, vy)
          break
        }
        case 'homing': {
          const angles = up.angles || [0]
          for (const ang of angles) {
            const rad = ang * Math.PI / 180
            const vx = Math.sin(rad) * Math.abs(vy)
            const vyy = vy * Math.cos(rad)
            pushBullet(vx, vyy)
          }
          break
        }
        case 'rapid': pushBullet(0, vy); break
      }
    }

    function computeAxis(keys: Record<string, boolean>) {
      let axis = axisRef.current
      if (keys['arrowleft'] || keys['a']) axis -= 1
      if (keys['arrowright'] || keys['d']) axis += 1
      return clamp(axis, -1, 1)
    }

    function updateLaserCadence(now: number) {
      if (level >= 30 && now >= laserNextAtRef.current && laserUntilRef.current < now) {
        laserUntilRef.current = now + (level >= 50 ? 6000 : 3000)
        laserNextAtRef.current = now + 30000
      }
    }

    function tryShoot(p: typeof playerRef.current, up: ReturnType<typeof getUpgrade>, now: number, cooldownMs: number) {
      const keys = keysRef.current
      if (shootCooldownRef.current > 0 || !(keys[' '] || keys['space'])) return
      const px = p.pos.x, py = p.pos.y - p.h / 2
      fireBullets(px, py, up)
      if (now < doubleUntilRef.current && up.pattern === 'single') {
        bulletsRef.current.push({ pos: { x: px - 10, y: py }, vel: { x: 0, y: -up.bullet.speed }, w: up.bullet.w, h: up.bullet.h, pierce: up.bullet.pierce, kind: up.bullet.kind })
        bulletsRef.current.push({ pos: { x: px + 10, y: py }, vel: { x: 0, y: -up.bullet.speed }, w: up.bullet.w, h: up.bullet.h, pierce: up.bullet.pierce, kind: up.bullet.kind })
      }
      for (let i = 0; i < 4; i++) {
        particlesRef.current.push({ pos: { x: px, y: py }, vel: { x: rand(-0.5, 0.5), y: rand(-1.5, -0.5) }, life: 0.25, color: '#ffffff' })
      }
      shootPoolRef.current?.play()
      const nowMs = performance.now()
      if (nowMs > nextShootBuzzAtRef.current) { vibrate(5); nextShootBuzzAtRef.current = nowMs + 120 }
      shootCooldownRef.current = cooldownMs
    }

    function handlePlayerAndShooting(dt: number, cw: number) {
      const p = playerRef.current
      const keys = keysRef.current
      const acc = 0.45
      const friction = 0.9
      const axis = computeAxis(keys)
      if (axis !== 0) { p.vel.x += acc * axis * 1.2 }
      p.vel.x *= friction
      p.pos.x += p.vel.x
      p.pos.x = clamp(p.pos.x, p.w / 2, cw - p.w / 2)

      const now = performance.now()
      const up = getUpgrade(level)
      updateLaserCadence(now)
      const rapidActive = now < rapidUntilRef.current || up.pattern === 'rapid'
      const baseCooldown = up.cooldown
      const cooldownMs = rapidActive ? Math.max(40, baseCooldown * 0.5) : baseCooldown
      shootCooldownRef.current -= dt * 1000
      tryShoot(p, up, now, cooldownMs)
    }

    function handleSpawningAndBirdMotion(dt: number, cw: number, ch: number) {
      const now = performance.now()
      if (!clearingLevelRef.current) {
        const since = now - lastSpawnRef.current
        const base = cfg.spawnRate
        const jitter = rand(0.7, 1.3)
        const interval = base * jitter
        if (since > interval) spawnBird(now)
      }
      birdsRef.current.forEach((b) => {
        b.t += dt
        if (b.type === 'boss') {
          b.pos.x += Math.sin(b.t * 1.5) * 40 * dt
          b.pos.y += Math.min(80 * dt, 0.9)
        } else {
          const zig = b.type === 'zigzag' ? 18 : 10
          b.pos.x += b.vel.x * dt + Math.sin(b.t * 4) * zig * dt
          b.pos.y += b.vel.y * dt + Math.cos(b.t * 3) * (zig * 0.4) * dt
        }
      })
      birdsRef.current = birdsRef.current.filter((b) => {
        const off = b.pos.x < -40 || b.pos.x > cw + 40 || b.pos.y > ch + 40
        if (off) {
          if (b.type === 'boss') bossAliveRef.current = false
          if (shieldChargesRef.current > 0) { shieldChargesRef.current -= 1 } else { onLoseLife() }
        }
        return !off
      })
    }

  function updateBullets(_dt: number) {
      bulletsRef.current.forEach((m) => {
        if (m.kind === 'homing') {
          let nearest: Bird | null = null
          let best = Infinity
          for (const b of birdsRef.current) {
            const dy = m.pos.y - b.pos.y
            if (dy > 0) continue
            const dx = b.pos.x - m.pos.x
            const dist = Math.abs(dx) + Math.abs(dy)
            if (dist < best) { best = dist; nearest = b }
          }
          if (nearest) {
            const steer = Math.sign(nearest.pos.x - m.pos.x) * 0.25
            m.vel.x = clamp(m.vel.x + steer, -4, 4)
          }
        }
        m.pos.x += m.vel.x
        m.pos.y += m.vel.y
        if (m.kind === 'strong' || m.kind === 'homing') {
          particlesRef.current.push({ pos: { x: m.pos.x, y: m.pos.y + m.h / 2 }, vel: { x: 0, y: 0.6 }, life: 0.2, color: '#88ccff' })
        }
      })
      bulletsRef.current = bulletsRef.current.filter((m) => m.pos.y + m.h > 0)
    }

    function computeBulletBirdImpacts() {
      const bullets = bulletsRef.current
      const birds = birdsRef.current
      const bulletHits = new Set<number>()
      const birdHitCount = new Map<number, number>()
      for (let i = 0; i < bullets.length; i++) {
        const m = bullets[i]
        for (let j = 0; j < birds.length; j++) {
          const b = birds[j]
          if (rectsIntersect(
            { x: m.pos.x - m.w / 2, y: m.pos.y - m.h / 2, w: m.w, h: m.h },
            { x: b.pos.x - b.w / 2, y: b.pos.y - b.h / 2, w: b.w, h: b.h }
          )) {
            bulletHits.add(i)
            birdHitCount.set(j, (birdHitCount.get(j) || 0) + 1)
            break
          }
        }
      }
      return { bulletHits, birdHitCount }
    }

    function emitHitParticles(b: Bird) {
      for (let h = 0; h < 8; h++) {
  particlesRef.current.push({ pos: { x: b.pos.x, y: b.pos.y }, vel: { x: rand(-1.2, 1.2), y: rand(-1.2, 1.2) }, life: 0.4, color: '#ffaa00' })
      }
    }

    function awardOnKill(b: Bird) {
      // scoring per level: +10 * multiplier per kill
      const cfg = levelConfig[Math.min(levelConfig.length, Math.max(1, level)) - 1]
      let pts = 10 * cfg.scoreMultiplier
      if (performance.now() < doubleUntilRef.current) pts *= 2
      onAddScore(pts)
      levelProgressRef.current += pts
      // combo text
      const nowT = performance.now()
      if (nowT - comboRef.current.lastHit < 800) comboRef.current.count += 1
      else comboRef.current.count = 1
      comboRef.current.lastHit = nowT
      if (comboRef.current.count >= 2) {
        comboTextRef.current = { x: b.pos.x, y: b.pos.y - 12, until: nowT + 600, text: `COMBO x${comboRef.current.count}!` }
      }
      // play explosion sound
      explosionPoolRef.current?.play()
  // haptic on kill
  vibrate([0, 12])
      if (b.type === 'boss') bossAliveRef.current = false
      if (Math.random() < cfg.powerUpRate) {
        const types: PowerUpType[] = ['double', 'rapid', 'shield']
        const type = types[Math.floor(Math.random() * types.length)]
        powerUpsRef.current.push({ pos: { x: b.pos.x, y: b.pos.y }, vel: { x: rand(-20, 20), y: rand(-40, -10) }, w: 10, h: 10, type })
      }
      // Check level clear
      if (!clearingLevelRef.current && levelProgressRef.current >= cfg.targetScore) {
        clearingLevelRef.current = true
        // clear remaining birds/bullets to pause action
        birdsRef.current = []
        bulletsRef.current = []
        const bonus = Math.floor(cfg.targetScore * 0.1)
        if (bonus > 0) onAddScore(bonus)
        levelUpPoolRef.current?.play()
  vibrate([0, 25])
        // delay and then notify app
        setTimeout(() => { onLevelCleared() }, 1200)
      }
    }

    function applyDamageAndRewards(birdHitCount: Map<number, number>) {
      const birds = birdsRef.current
      const survivors: Bird[] = []
      for (let j = 0; j < birds.length; j++) {
        const b = birds[j]
        const hits = birdHitCount.get(j) || 0
        if (hits > 0) emitHitParticles(b)
        b.hp -= hits
        if (b.hp > 0) survivors.push(b)
        else awardOnKill(b)
      }
      birdsRef.current = survivors
    }

  function filterHitBullets(bulletHits: Set<number>) {
      const bullets = bulletsRef.current
      const keep: Bullet[] = []
      for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i]
    if (!bulletHits.has(i)) { keep.push(b); continue }
    const pierce = b.pierce ?? 1
    if (pierce > 1) { b.pierce = pierce - 1; keep.push(b) }
      }
      bulletsRef.current = keep
    }

    function resolveBulletBirdCollisions() {
      const { bulletHits, birdHitCount } = computeBulletBirdImpacts()
      filterHitBullets(bulletHits)
      applyDamageAndRewards(birdHitCount)
    }

    function updatePowerUpsAndPickups(dt: number, ch: number) {
      powerUpsRef.current.forEach((pu) => { pu.pos.x += pu.vel.x * dt; pu.pos.y += pu.vel.y * dt; pu.vel.y += 20 * dt })
      const p = playerRef.current
      powerUpsRef.current = powerUpsRef.current.filter((pu) => {
        const hit = rectsIntersect(
          { x: p.pos.x - p.w / 2, y: p.pos.y - p.h / 2, w: p.w, h: p.h },
          { x: pu.pos.x - pu.w / 2, y: pu.pos.y - pu.h / 2, w: pu.w, h: pu.h }
        )
        if (hit) {
          const nowT = performance.now()
          if (pu.type === 'rapid') rapidUntilRef.current = Math.max(rapidUntilRef.current, nowT + 10000)
          if (pu.type === 'double') doubleUntilRef.current = Math.max(doubleUntilRef.current, nowT + 15000)
          if (pu.type === 'shield') shieldChargesRef.current += 1
          powerupPoolRef.current?.play()
          vibrate(16)
          return false
        }
        return pu.pos.y < ch + 20
      })
    }

    function updateParticles(dt: number) {
      particlesRef.current.forEach((pt) => { pt.pos.x += pt.vel.x; pt.pos.y += pt.vel.y; pt.life -= dt })
      particlesRef.current = particlesRef.current.filter((pt) => pt.life > 0)
    }

    function handleBulletsCollisionsAndPickups(dt: number, ch: number) {
      updateBullets(dt)
      resolveBulletBirdCollisions()
      updatePowerUpsAndPickups(dt, ch)
      updateParticles(dt)
    }

    function applyLaserDamageIfActive() {
      const now = performance.now()
      if (now >= laserUntilRef.current) return
      const px = playerRef.current.pos.x
      const beamW = level >= 50 ? 14 : 8
      const minX = px - beamW / 2, maxX = px + beamW / 2
      const survivors: Bird[] = []
      for (const b of birdsRef.current) {
        if (b.pos.x >= minX && b.pos.x <= maxX && b.pos.y < playerRef.current.pos.y) {
          b.hp -= 1
          if (b.hp <= 0) { awardOnKill(b); continue }
        }
        survivors.push(b)
      }
      birdsRef.current = survivors
    }

    function update(dt: number) {
      if (!running) { return }
      const cw = VIRTUAL_W
      const ch = VIRTUAL_H
  applyLaserDamageIfActive()
      handlePlayerAndShooting(dt, cw)
      if (!clearingLevelRef.current) {
        handleSpawningAndBirdMotion(dt, cw, ch)
        handleBulletsCollisionsAndPickups(dt, ch)
      } else {
        // during clear banner, keep particles fading
        updateParticles(dt)
      }
    }

    function draw(ctx: CanvasRenderingContext2D) {
      const dpr = window.devicePixelRatio || 1
      const scale = scaleRef.current
      ctx.save()
      ctx.scale(dpr * scale, dpr * scale)
      const w = VIRTUAL_W
      const h = VIRTUAL_H
      // background
      ctx.fillStyle = '#0b1021'
      ctx.fillRect(0, 0, w, h)
      // pixel clouds
      ctx.fillStyle = '#1a2244'
      for (let i = 0; i < 6; i++) {
        const x = ((i * 150 + (performance.now() / 40)) % (w + 200)) - 200
        const y = 40 + (i % 3) * 30
        ctx.fillRect(x, y, 80, 8)
        ctx.fillRect(x + 20, y + 8, 60, 8)
      }

      // player (cannon)
      const p = playerRef.current
      ctx.fillStyle = '#39ff14'
  // player (cannon) grows slightly with level tiers
  const grow = Math.min(12, Math.floor(level / 5) * 2)
  const pw = p.w + grow
  ctx.fillRect(p.pos.x - pw / 2, p.pos.y - p.h / 2, pw, p.h)
  ctx.fillRect(p.pos.x - 4, p.pos.y - p.h / 2 - 10, 8, 10)

      // bullets
      ctx.fillStyle = '#ffffff'
      bulletsRef.current.forEach((m) => {
        let color = '#ffffff'
        if (m.kind === 'strong') color = '#88ccff'
        else if (m.kind === 'homing') color = '#ff66cc'
        ctx.fillStyle = color
        ctx.shadowColor = color
        ctx.shadowBlur = m.kind === 'strong' ? 6 : 0
        ctx.fillRect(m.pos.x - m.w / 2, m.pos.y - m.h / 2, m.w, m.h)
        ctx.shadowBlur = 0
      })

      // birds
      ctx.fillStyle = '#ffcc00'
      birdsRef.current.forEach((b) => {
  ctx.fillStyle = '#ffcc00'
        ctx.fillRect(b.pos.x - b.w / 2, b.pos.y - b.h / 2, b.w, b.h)
        // flap accent
  ctx.fillStyle = '#ffaa00'
        ctx.fillRect(b.pos.x - b.w / 2, b.pos.y - b.h / 2 - 3 - Math.sin(b.t * 20) * 2, Math.min(10, b.w / 3), 3)
      })

      // power-ups
      powerUpsRef.current.forEach((pu) => {
        let color = '#ff00ff'
        if (pu.type === 'rapid') color = '#00e1ff'
        else if (pu.type === 'double') color = '#39ff14'
        ctx.fillStyle = color
        ctx.fillRect(pu.pos.x - pu.w / 2, pu.pos.y - pu.h / 2, pu.w, pu.h)
        // glow effect
        ctx.globalAlpha = 0.35
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.strokeRect(pu.pos.x - pu.w / 2 - 2, pu.pos.y - pu.h / 2 - 2, pu.w + 4, pu.h + 4)
        ctx.globalAlpha = 1
      })

      // particles
      particlesRef.current.forEach((pt) => {
        ctx.globalAlpha = Math.max(0, pt.life * 2)
        ctx.fillStyle = pt.color
        ctx.fillRect(pt.pos.x, pt.pos.y, 2, 2)
      })
      ctx.globalAlpha = 1

      // combo floating text
      if (comboTextRef.current && performance.now() < comboTextRef.current.until) {
        const c = comboTextRef.current
        ctx.fillStyle = '#39ff14'
        ctx.font = '10px "Press Start 2P", cursive'
        ctx.textAlign = 'center'
        ctx.fillText(c.text, c.x, c.y)
      }

      // level cleared banner
      if (clearingLevelRef.current) {
        ctx.fillStyle = '#39ff14'
        ctx.font = '12px "Press Start 2P", cursive'
        ctx.textAlign = 'center'
        ctx.fillText('LEVEL UP! LIVES DOUBLED!', w / 2, h / 2)
      }
      // laser beam render
      if (performance.now() < laserUntilRef.current) {
        const px = p.pos.x
        ctx.globalAlpha = 0.6
        ctx.fillStyle = '#00e1ff'
        const bw = level >= 50 ? 14 : 8
        ctx.fillRect(px - bw / 2, 0, bw, p.pos.y - p.h / 2)
        ctx.globalAlpha = 1
      }
      // shooter upgrade banner
      if (bannerRef.current && performance.now() < bannerRef.current.until) {
        ctx.fillStyle = '#39ff14'
        ctx.font = '12px "Press Start 2P", cursive'
        ctx.textAlign = 'center'
        ctx.fillText(bannerRef.current.text, w / 2, h * 0.3)
      }

      ctx.restore()
    }

    if (running) rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [running, level])

  // One-hand toggle helper used by button
  const toggleOneHand = () => { setOneHand(v => !v) }

  // Swipe helpers
  const eventClientX = (e: any) => (e?.clientX ?? e?.touches?.[0]?.clientX ?? 0) as number
  const handleSwipeStart = (e: React.PointerEvent | React.TouchEvent) => {
    const x = eventClientX(e)
    swipeActiveRef.current = true; swipeStartXRef.current = x
  }
  const handleSwipeMove = (e: React.PointerEvent | React.TouchEvent) => {
    if (!swipeActiveRef.current) return
    const x = eventClientX(e) || swipeStartXRef.current
    const dx = x - swipeStartXRef.current
    axisRef.current = clamp(dx / 60, -1, 1)
  }
  const handleSwipeEnd = () => { swipeActiveRef.current = false; axisRef.current = 0 }

  return (
    <div
      className="relative w-full h-full select-none"
      onPointerDown={(e) => {
        // tap-to-shoot if above HUD (top ~56px) and not pressing buttons
        if ((e.target as HTMLElement).tagName === 'CANVAS') { if (e.clientY > 56) { pressShoot() } }
        handleSwipeStart(e)
      }}
      onPointerMove={handleSwipeMove}
      onPointerUp={() => { releaseShoot(); handleSwipeEnd() }}
      onPointerCancel={() => { releaseShoot(); handleSwipeEnd() }}
    >
      <canvas ref={canvasRef} className="block mx-auto" style={{ touchAction: 'none' }} />
      {/* Mobile controls: show on small screens, hide on md+ */}
      <div className="md:hidden absolute inset-0 pointer-events-none">
        {/* Quick pause & music in top-right */}
        <div className="absolute top-3 right-3 flex gap-2 pointer-events-auto">
          <button
            aria-label="Pause"
            className="text-[10px] rounded border px-2 py-1"
            style={{ borderColor: '#39ff14', color: '#39ff14', background: 'rgba(0,0,0,0.25)' }}
            onClick={() => props.onPause?.()}
          >PAUSE</button>
          <button
            aria-label="Music"
            className="text-[10px] rounded border px-2 py-1"
            style={{ borderColor: '#39ff14', color: '#39ff14', background: 'rgba(0,0,0,0.25)' }}
            onClick={() => props.onToggleMusic?.()}
          >{props.musicOn ? 'MUSIC: ON' : 'MUSIC: OFF'}</button>
        </div>
        {/* Joystick area */}
        <div
          className={`absolute bottom-4 left-4 pointer-events-auto`}
          style={{ width: 120, height: 120 }}
          onPointerDown={(e) => {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
            const cx = rect.left + rect.width / 2
            const dx = e.clientX - cx
            axisRef.current = clamp(dx / (rect.width / 2), -1, 1)
          }}
          onPointerMove={(e) => {
            if (e.buttons === 0) return
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
            const cx = rect.left + rect.width / 2
            const dx = e.clientX - cx
            axisRef.current = clamp(dx / (rect.width / 2), -1, 1)
          }}
          onPointerUp={() => { axisRef.current = 0 }}
        >
          <div className="w-full h-full rounded-full border" style={{ borderColor: '#39ff14', borderWidth: 2, background: 'rgba(0,0,0,0.15)' }} />
        </div>
        {/* Shoot button */}
        <div className={`absolute ${oneHand ? 'bottom-4 left-40' : 'bottom-4 right-4'} pointer-events-auto`}>
          <button
            aria-label="Shoot"
            className="rounded-full text-white"
            style={{ width: 72, height: 72, border: '2px solid #39ff14', background: 'rgba(0,0,0,0.15)' }}
            onPointerDown={pressShoot}
            onPointerUp={releaseShoot}
            onPointerCancel={releaseShoot}
            onPointerLeave={releaseShoot}
          >SHOOT</button>
        </div>
        {/* One-hand toggle */}
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 pointer-events-auto">
          <button className="text-[10px] rounded border px-2 py-1" style={{ borderColor: '#39ff14', color: '#39ff14', background: 'rgba(0,0,0,0.2)' }} onClick={toggleOneHand}>HAND</button>
        </div>
      </div>
    </div>
  )
}

function rectsIntersect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const ax = a.x, ay = a.y, aw = a.w, ah = a.h
  const bx = b.x, by = b.y, bw = b.w, bh = b.h
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
}
