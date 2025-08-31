type Props = {
  score: number
  highScore: number
  onRestart: () => void
  onQuit: () => void
}

export default function GameOverScreen({ score, highScore, onRestart, onQuit }: Props) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-black/70">
      <div className="space-y-4 rounded border border-[#39ff14] bg-[#0b1021]/90 p-6 text-center">
  <div className="text-[#39ff14]" style={{ fontFamily: '"Press Start 2P", cursive' }}>GAME OVER</div>
        <div className="text-xs">Score: {score}</div>
        <div className="text-xs">High Score: {highScore}</div>
        <div className="flex gap-3 justify-center pt-2">
          <button className="rounded border border-[#39ff14] px-3 py-2 text-[10px] text-[#39ff14] hover:bg-[#39ff14] hover:text-black" onClick={onRestart}>RESTART</button>
          <button className="rounded border border-[#39ff14] px-3 py-2 text-[10px] text-[#39ff14] hover:bg-[#39ff14] hover:text-black" onClick={onQuit}>QUIT</button>
        </div>
      </div>
    </div>
  )
}
