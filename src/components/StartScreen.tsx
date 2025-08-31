type Props = {
  highScore: number
  onPlay: () => void
}

export default function StartScreen({ highScore, onPlay }: Props) {
  return (
    <div className="grid h-dvh place-items-center bg-[#0b1021] text-white">
      <div className="text-center space-y-6 p-6">
  <h1 className="text-[#39ff14] text-xl md:text-3xl" style={{ fontFamily: '"Press Start 2P", cursive' }}>Bird Shooter</h1>
        <p className="text-xs md:text-sm opacity-80">High Score: {highScore}</p>
        <button
          className="mx-auto block rounded border border-[#39ff14] px-4 py-3 text-[10px] md:text-xs text-[#39ff14] hover:bg-[#39ff14] hover:text-black"
          onClick={onPlay}
        >
          PLAY
        </button>
        <p className="text-[9px] md:text-xs opacity-70">Arrows: Move • Space: Fire • P: Pause</p>
      </div>
    </div>
  )
}
