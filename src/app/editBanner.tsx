import { useId } from 'react'

/**
 * The edit banner's texture (owner 2026-10-18, after 1Password 8's striped "Editing" bar): one SVG tile per item
 * category, so each category edits under its own pattern, drawn in currentColor — the banner sets `color` to the
 * category's accent, the same hue as its sidebar glyph. Hand-drawn here, no artwork from anywhere else.
 */
type Tile = { size: number; draw: string; fill?: boolean }

const tiles: Readonly<Record<string, Tile>> = {
  // Diagonal stripes: the plain login.
  login: { draw: 'M-4 4 L4 -4 M0 24 L24 0 M20 28 L28 20', size: 24 },
  // Ruled lines, like a notebook page.
  secure_note: { draw: 'M0 10 H20', size: 20 },
  // Small dots on a grid, like an embossed card.
  credit_card: { draw: 'M8 8 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0', fill: true, size: 16 },
  // Offset rings.
  identity: { draw: 'M12 12 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0', size: 24 },
  // Crosshatch.
  password: { draw: 'M0 0 L20 20 M20 0 L0 20', size: 20 },
  // Prompt chevrons.
  ssh_key: { draw: 'M6 6 L12 12 L6 18', size: 24 },
  // Bricks.
  bank_account: { draw: 'M0 0 H28 M0 14 H28 M14 0 V14 M0 14 V28 M28 14 V28', size: 28 },
  // Wave lines, like a passport's guilloché.
  passport: { draw: 'M0 12 Q6 4 12 12 T24 12', size: 24 },
  // Road dashes.
  driver_license: { draw: 'M4 12 H14', size: 24 },
  // Concentric arcs, like a signal.
  wifi: { draw: 'M4 20 A16 16 0 0 1 20 4 M4 14 A10 10 0 0 1 14 4', size: 24 },
  // Curly braces' plus signs.
  api_credential: { draw: 'M12 6 V18 M6 12 H18', size: 24 },
  // Rack rows: horizontal bars with a light.
  server: { draw: 'M2 6 H18 M2 16 H18 M21 6 h0.01 M21 16 h0.01', size: 24 },
  // Stacked discs.
  database: { draw: 'M4 8 Q12 14 20 8 M4 16 Q12 22 20 16', size: 24 },
  // Envelope chevrons.
  email: { draw: 'M2 6 L12 14 L22 6', size: 24 },
  // Square grid.
  router: { draw: 'M0 0 H20 M0 0 V20', size: 20 },
  // Diamonds, like a seal.
  software_license: { draw: 'M12 2 L22 12 L12 22 L2 12 Z', size: 24 },
  // Hexagon outline, like a chain block.
  crypto_wallet: { draw: 'M7 2 H17 L22 12 L17 22 H7 L2 12 Z', size: 24 },
}

const fallbackTile = tiles.login

export function editBannerTileFor(itemType: string): Tile {
  return tiles[itemType] ?? fallbackTile
}

export const editBannerTypes = Object.keys(tiles)

export function EditBannerPattern({ itemType }: { itemType: string }) {
  const id = `edit-banner-${useId().replace(/:/g, '')}`
  const tile = editBannerTileFor(itemType)
  return (
    <svg aria-hidden="true" className="edit-banner-pattern" data-pattern={itemType} focusable="false">
      <defs>
        <pattern height={tile.size} id={id} patternUnits="userSpaceOnUse" width={tile.size}>
          <path
            d={tile.draw}
            fill={tile.fill ? 'currentColor' : 'none'}
            stroke={tile.fill ? 'none' : 'currentColor'}
            strokeLinecap="round"
            strokeWidth={tile.fill ? 0 : 2}
          />
        </pattern>
      </defs>
      <rect fill={`url(#${id})`} height="100%" width="100%" />
    </svg>
  )
}
