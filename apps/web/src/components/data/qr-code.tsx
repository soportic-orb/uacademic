import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

/**
 * A subscription address as something a phone can read.
 *
 * Typing a URL with a 64-character token into a phone is not a thing anybody
 * does twice, and mailing it to yourself to tap the link is the workaround
 * people invent when this is missing. The camera app reads this and hands the
 * address to whichever calendar the phone uses.
 *
 * Drawn as one SVG path rather than a grid of rectangles: a QR code is around
 * a thousand modules, and a thousand DOM nodes to render a square of dots is
 * the kind of thing that makes a phone browser stutter.
 */
export function QrCode({ value, size = 176 }: { value: string; size?: number }) {
  const { path, modules } = useMemo(() => {
    // Error correction M: readable with a logo-sized chunk missing, and still
    // compact enough for a long URL to stay scannable on a phone screen.
    const code = qrcode(0, 'M')
    code.addData(value)
    code.make()

    const count = code.getModuleCount()
    const parts: string[] = []
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (code.isDark(row, column)) parts.push(`M${column} ${row}h1v1h-1z`)
      }
    }

    return { path: parts.join(''), modules: count }
  }, [value])

  return (
    <svg
      viewBox={`-2 -2 ${modules + 4} ${modules + 4}`}
      width={size}
      height={size}
      role="img"
      // The address is beside it in a field somebody can read and copy; the
      // code itself is a second route to the same thing, not information a
      // screen reader has any use for.
      aria-hidden="true"
      className="rounded-control bg-white p-2"
      shapeRendering="crispEdges"
    >
      <path d={path} fill="#000000" />
    </svg>
  )
}
