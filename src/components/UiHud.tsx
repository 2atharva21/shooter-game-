type Props = Readonly<{ score: number; level: number; lives: number; highScore: number }>

export default function UiHud({ score, level, lives, highScore }: Props) {
  return (
    <div className="pointer-events-none absolute left-0 top-0 flex w-full items-center justify-between p-4 text-[#39ff14]">
      <div className="text-[10px] md:text-xs flex gap-3" style={{ fontFamily: '"Press Start 2P", cursive' }}>
        <span>LEVEL {level}</span>
        <span>Lives: {lives}</span>
      </div>
      <div className="text-center text-[10px] md:text-xs" style={{ fontFamily: '"Press Start 2P", cursive' }}>
        <span className="text-[#39ff14]">SCORE</span>
        <div className="text-lg md:text-2xl">{score}</div>
      </div>
      <div className="text-[10px] md:text-xs" style={{ fontFamily: '"Press Start 2P", cursive' }}>
        High: {highScore}
      </div>
    </div>
  )
}
