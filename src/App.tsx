import { useEffect, useReducer, useRef } from 'react'
import GameCanvas from './components/GameCanvas.tsx'
import UiHud from './components/UiHud.tsx'
import StartScreen from './components/StartScreen.tsx'
import PauseMenu from './components/PauseMenu.tsx'

type GameMode = 'start' | 'playing' | 'paused' | 'gameover' | 'victory'

type State = {
  mode: GameMode
  score: number
  highScore: number
  session: number
  level: number
  lives: number
}

type Action =
  | { type: 'START' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'ADD_SCORE'; amount: number }
  | { type: 'RESET' }
  | { type: 'LOSE_LIFE' }
  | { type: 'LEVEL_CLEARED' }
  | { type: 'ADVANCE_LEVEL' }
  | { type: 'GAME_OVER' }
  | { type: 'VICTORY' }
  

function getHighScore() {
  const v = localStorage.getItem('highScore')
  return v ? parseInt(v) : 0
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'START':
      // Start/Restart a new session: reset score and bump session to reset canvas entities
  return { ...state, mode: 'playing', score: 0, session: state.session + 1, level: 1, lives: 100 }
    case 'PAUSE':
      return { ...state, mode: 'paused' }
    case 'RESUME':
      return { ...state, mode: 'playing' }
    case 'ADD_SCORE': {
      // Clamp to non-negative score and update high score in real-time
      const next = Math.max(0, state.score + action.amount)
      let highScore = state.highScore
      if (next > highScore) {
        highScore = next
        localStorage.setItem('highScore', String(highScore))
      }
      return { ...state, score: next, highScore }
    }
    case 'LOSE_LIFE': {
      const lives = Math.max(0, state.lives - 1)
      if (lives <= 0) {
        return { ...state, lives, mode: 'gameover' }
      }
      return { ...state, lives }
    }
    case 'LEVEL_CLEARED': {
      // Canvas will play level-cleared splash; App advances level
      const isFinal = state.level >= 50
      if (isFinal) {
        return { ...state, mode: 'victory' }
      }
  return { ...state, level: state.level + 1, session: state.session + 1, lives: state.lives * 2 }
    }
    case 'ADVANCE_LEVEL': {
      const isFinal = state.level >= 50
      if (isFinal) return { ...state, mode: 'victory' }
      return { ...state, level: state.level + 1, session: state.session + 1 }
    }
    case 'GAME_OVER':
      return { ...state, mode: 'gameover' }
    case 'VICTORY':
      return { ...state, mode: 'victory' }
    case 'RESET':
      // Quit to Start: unmounts canvas, reset basics; keep session as-is
  return { mode: 'start' as GameMode, score: 0, highScore: getHighScore(), session: state.session, level: 1, lives: 100 }
    default:
      return state
  }
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined as any, () => ({
    mode: 'start' as GameMode,
    score: 0,
    highScore: getHighScore(),
    session: 0,
  level: 1,
  lives: 100,
  }))

  // Background music that plays only during gameplay
  const bgRef = useRef<HTMLAudioElement | null>(null)
  useEffect(() => {
    if (!bgRef.current) {
      const a = new Audio('/bg.mp3')
      a.loop = true
      a.volume = 0.2
      bgRef.current = a
    }
    const a = bgRef.current
    if (state.mode === 'playing') {
      a?.play().catch(() => {})
    } else {
      try { a?.pause() } catch { /* ignore */ }
    }
  }, [state.mode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'p' && (state.mode === 'playing' || state.mode === 'paused')) {
        dispatch({ type: state.mode === 'playing' ? 'PAUSE' : 'RESUME' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.mode])

  return (
    <div className="min-h-dvh w-full bg-[#0b1021] text-white" style={{ fontFamily: '"Press Start 2P", cursive' }}>
      {state.mode === 'start' && (
        <StartScreen onPlay={() => dispatch({ type: 'START' })} highScore={state.highScore} />
      )}
      {state.mode !== 'start' && state.mode !== 'victory' && state.mode !== 'gameover' && (
        <div className="relative h-dvh w-full overflow-hidden">
          <GameCanvas
            running={state.mode === 'playing'}
            session={state.session}
            level={state.level}
            score={state.score}
            onAddScore={(amount: number) => dispatch({ type: 'ADD_SCORE', amount })}
            onLoseLife={() => dispatch({ type: 'LOSE_LIFE' })}
            onLevelCleared={() => dispatch({ type: 'LEVEL_CLEARED' })}
          />
          <UiHud score={state.score} level={state.level} lives={state.lives} highScore={state.highScore} />
          {state.mode === 'paused' && (
            <PauseMenu onResume={() => dispatch({ type: 'RESUME' })} onQuit={() => dispatch({ type: 'RESET' })} />
          )}
        </div>
      )}
      {state.mode === 'victory' && (
        <div className="grid place-items-center h-dvh">
          <div className="text-center space-y-6">
            <div className="text-2xl md:text-3xl text-green-400">YOU WON! GAME COMPLETE</div>
            <div className="text-sm md:text-base">Final Score: {state.score}</div>
            <div className="text-sm md:text-base">High Score: {state.highScore}</div>
            <button className="px-4 py-2 bg-green-600 hover:bg-green-500" onClick={() => dispatch({ type: 'RESET' })}>Restart</button>
          </div>
        </div>
      )}
      {state.mode === 'gameover' && (
        <div className="grid place-items-center h-dvh">
          <div className="text-center space-y-6">
            <div className="text-2xl md:text-3xl text-red-400">GAME OVER</div>
            <div className="text-sm md:text-base">Score: {state.score}</div>
            <div className="text-sm md:text-base">High Score: {state.highScore}</div>
            <div className="space-x-3">
              <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500" onClick={() => dispatch({ type: 'START' })}>Restart</button>
              <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600" onClick={() => dispatch({ type: 'RESET' })}>Quit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


