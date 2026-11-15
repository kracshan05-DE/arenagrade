// ArenaGrade shield emblem (public/brand/arenagrade-mark.png, 128 px source).
// Decorative by default: every place it is used also shows the name
// "ArenaGrade" as text, so screen readers should not read it twice.
export default function BrandMark({ size = 30, label }: { size?: number; label?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny static file; no optimisation needed
    <img
      src="/brand/arenagrade-mark.png"
      width={size}
      height={size}
      alt={label ?? ''}
      style={{ display: 'block', width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size * 0.22)}px`, flexShrink: 0 }}
    />
  )
}
