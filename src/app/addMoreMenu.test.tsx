import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AddMoreControl } from './addMoreMenu'
import { EditFieldRow, EditSectionCard } from './fieldRows'
import './i18n'

const noop = () => {}

function addMore(context: 'item' | 'section') {
  return <AddMoreControl attachments context={context} onPick={noop} onToggle={noop} open={false} sheet={false} />
}

describe('section Add More', () => {
  it('renders as the last row inside the section card, not after it', () => {
    const markup = renderToStaticMarkup(
      <div className="field-section is-edit">
        <EditSectionCard addMore={addMore('section')}>
          <EditFieldRow label="Section">
            <span>header</span>
          </EditFieldRow>
          <EditFieldRow label="Field">
            <span>value</span>
          </EditFieldRow>
        </EditSectionCard>
      </div>,
    )
    const card = markup.match(
      /^<div class="field-section is-edit"><div class="field-group is-edit">([\s\S]*)<\/div><\/div>$/,
    )
    expect(card).not.toBeNull()
    const inside = card?.[1] ?? ''
    // Both rows, then the Add More — all in the one card, with the Add More last.
    expect(inside.startsWith('<div class="field-slot"')).toBe(true)
    expect(inside.lastIndexOf('class="add-more-wrap is-section"')).toBeGreaterThan(inside.lastIndexOf('field-slot'))
    expect(inside.endsWith('</button></div>')).toBe(true)
  })

  it('marks the bar with its context so only the section one is drawn as a card row', () => {
    expect(renderToStaticMarkup(addMore('section'))).toContain('class="add-more-wrap is-section"')
    expect(renderToStaticMarkup(addMore('item'))).toContain('class="add-more-wrap is-item"')
  })

  it('draws the section bar as the card cell in the stylesheet (no top margin, no own bezel)', () => {
    const css = readFileSync('src/styles.css', 'utf8')
    expect(css).toMatch(
      /\.field-group\.is-edit > \.add-more-wrap\.is-section \{[^}]*rounded-b-large border-x border-b border-t/,
    )
    expect(css).toMatch(/\.add-more-wrap\.is-section > \.add-more-button \{[^}]*mt-0[^}]*border-0 bg-transparent/)
  })
})
