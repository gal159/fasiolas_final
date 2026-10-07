// Vienodo storio linijines SVG ikonos mygtukams. Spalva seka `currentColor`;
// mygtukas VISADA turi aria-label + title, ikona yra tik dekoratyvi (aria-hidden).

export type IconName =
  | 'close'
  | 'info'
  | 'volume'
  | 'volumeOff'
  | 'plus'
  | 'minus'
  | 'logout'
  | 'back'
  | 'hand'
  | 'take'
  | 'swap'
  | 'check'
  | 'play'
  | 'sortSuit'
  | 'sortRank'
  | 'cart'
  | 'trophy'

const PATHS: Record<IconName, string[]> = {
  close: ['M6 6l12 12', 'M18 6L6 18'],
  info: ['M12 11v5', 'M12 8h.01', 'M12 3a9 9 0 100 18 9 9 0 000-18z'],
  volume: ['M4 9v6h4l5 4V5L8 9H4z', 'M16.5 9a4 4 0 010 6', 'M19 6.5a8 8 0 010 11'],
  volumeOff: ['M4 9v6h4l5 4V5L8 9H4z', 'M17 9.5l5 5', 'M22 9.5l-5 5'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  logout: ['M9 4H5v16h4', 'M16 8l4 4-4 4', 'M20 12H9'],
  back: ['M15 6l-6 6 6 6'],
  hand: ['M8 4h8a2 2 0 012 2v10a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2z', 'M9 20h9a2 2 0 002-2V8'],
  take: ['M12 4v10', 'M8 10l4 4 4-4', 'M5 19h14'],
  swap: ['M7 7h11', 'M15 4l3 3-3 3', 'M17 17H6', 'M9 14l-3 3 3 3'],
  check: ['M5 12.5l4.5 4.5L19 7'],
  play: ['M8 5l11 7-11 7V5z'],
  sortSuit: ['M12 3l7 9-7 9-7-9 7-9z'],
  sortRank: ['M6 19v-4', 'M12 19v-8', 'M18 19V5'],
  cart: ['M3 4h2l2.2 10.5h9.6L19 8H6.2', 'M10 19.5h.01', 'M17 19.5h.01'],
  trophy: ['M8 4h8v5a4 4 0 01-8 0V4z', 'M8 6H5v1a3 3 0 003 3', 'M16 6h3v1a3 3 0 01-3 3', 'M12 13v4', 'M9 20h6'],
}

type IconProps = {
  name: IconName
  size?: number
}

export function Icon({ name, size = 20 }: IconProps) {
  return (
    <svg
      className="iconGlyph"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
