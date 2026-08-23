/**
 * A menu somebody has arranged, meeting a product that keeps changing under
 * it: new screens, and roles that come and go.
 */
import { describe, expect, it } from 'vitest'

import type { MenuEntry } from '../src/domain/menu.js'
import {
  applyMenuLayout,
  insertSeparator,
  menuSections,
  moveEntry,
  orderMenuEntries,
  removeSeparator,
  renameSeparator,
  tidySeparators,
} from '../src/domain/menu.js'

const available = [{ key: 'dashboard' }, { key: 'planning' }, { key: 'messages' }]

const item = (key: string): MenuEntry => ({ kind: 'item', key })
const rule = (id: string, label = ''): MenuEntry => ({ kind: 'separator', id, label })

describe('drawing a menu somebody has arranged', () => {
  it('follows the order they put it in', () => {
    const drawn = applyMenuLayout(available, [item('messages'), item('dashboard')])

    expect(drawn.map((entry) => (entry.kind === 'item' ? entry.key : '—'))).toEqual([
      'messages',
      'dashboard',
      // Never mentioned, so it follows in the product's own order rather than
      // disappearing: an update that adds a screen must not hide it.
      'planning',
    ])
  })

  it('drops an entry the person can no longer reach', () => {
    // A role taken away: the layout still names planning, the menu must not.
    const drawn = applyMenuLayout([{ key: 'dashboard' }], [item('planning'), item('dashboard')])

    expect(drawn).toEqual([item('dashboard')])
  })

  it('draws nothing twice, however the layout got written', () => {
    const drawn = applyMenuLayout(available, [item('planning'), item('planning')])

    expect(drawn.filter((entry) => entry.kind === 'item' && entry.key === 'planning')).toHaveLength(
      1,
    )
  })

  it('keeps a separator where it was put, with its label', () => {
    const drawn = applyMenuLayout(available, [
      item('dashboard'),
      rule('s1', 'Docència'),
      item('planning'),
      item('messages'),
    ])

    expect(drawn[1]).toEqual(rule('s1', 'Docència'))
  })

  it('is the product’s own order when the layout is empty', () => {
    expect(applyMenuLayout(available, [])).toEqual([
      item('dashboard'),
      item('planning'),
      item('messages'),
    ])
  })
})

describe('separators that would draw a rule against nothing', () => {
  it('drops one at the top', () => {
    expect(tidySeparators([rule('s1'), item('a')])).toEqual([item('a')])
  })

  it('drops one at the bottom', () => {
    expect(tidySeparators([item('a'), rule('s1')])).toEqual([item('a')])
  })

  it('drops the second of two in a row', () => {
    expect(tidySeparators([item('a'), rule('s1'), rule('s2'), item('b')])).toEqual([
      item('a'),
      rule('s1'),
      item('b'),
    ])
  })

  it('leaves a legitimate one alone', () => {
    const entries = [item('a'), rule('s1', 'Docència'), item('b')]
    expect(tidySeparators(entries)).toEqual(entries)
  })

  it('drops one stranded by an item that is no longer reachable', () => {
    // The only thing under the rule was the screen the role lost.
    const drawn = applyMenuLayout(
      [{ key: 'dashboard' }],
      [item('dashboard'), rule('s1', 'Docència'), item('planning')],
    )

    expect(drawn).toEqual([item('dashboard')])
  })
})

describe('the list the editor works on', () => {
  it('keeps a separator that is momentarily against another', () => {
    // A new separator inserted above an existing one is adjacent to it for
    // exactly as long as it takes to move something between them. Dropping
    // one of the two there makes the new one look like it overwrote the old.
    const layout = [item('dashboard'), rule('s2'), rule('s1'), item('planning')]

    expect(orderMenuEntries(available, layout).filter((e) => e.kind === 'separator')).toHaveLength(
      2,
    )
    // The drawn menu still tidies: a rule against nothing is a mistake there.
    expect(applyMenuLayout(available, layout).filter((e) => e.kind === 'separator')).toHaveLength(1)
  })

  it('keeps one at the very top, which the drawn menu would drop', () => {
    const layout = [rule('s1'), item('dashboard')]

    expect(orderMenuEntries(available, layout)[0]).toEqual(rule('s1'))
    expect(applyMenuLayout(available, layout)[0]).toEqual(item('dashboard'))
  })

  it('still adds what the layout never mentions, and drops what is unreachable', () => {
    const ordered = orderMenuEntries([{ key: 'dashboard' }], [item('planning'), item('dashboard')])

    expect(ordered).toEqual([item('dashboard')])
  })
})

describe('moving an entry', () => {
  const entries = [item('a'), item('b'), item('c')]

  it('swaps it with the one above', () => {
    expect(moveEntry(entries, 1, -1)).toEqual([item('b'), item('a'), item('c')])
  })

  it('swaps it with the one below', () => {
    expect(moveEntry(entries, 1, 1)).toEqual([item('a'), item('c'), item('b')])
  })

  it('does nothing at the ends rather than wrapping around', () => {
    // A button that sends the top entry to the bottom is one somebody presses
    // once by accident and then undoes eleven times.
    expect(moveEntry(entries, 0, -1)).toEqual(entries)
    expect(moveEntry(entries, 2, 1)).toEqual(entries)
  })

  it('never mutates what it was given', () => {
    const before = [...entries]
    moveEntry(entries, 1, -1)
    expect(entries).toEqual(before)
  })
})

describe('the separators somebody adds', () => {
  it('goes in where it was asked for', () => {
    const next = insertSeparator([item('a'), item('b')], 1, {
      kind: 'separator',
      id: 's1',
      label: 'Docència',
    })

    expect(next[1]).toMatchObject({ kind: 'separator', label: 'Docència' })
  })

  it('is renamed without disturbing the order', () => {
    const next = renameSeparator([item('a'), rule('s1', 'Vell'), item('b')], 's1', 'Nou')

    expect(next[1]).toEqual(rule('s1', 'Nou'))
  })

  it('is removed by its own id, leaving the items alone', () => {
    const next = removeSeparator([item('a'), rule('s1'), rule('s2'), item('b')], 's1')

    expect(next).toEqual([item('a'), rule('s2'), item('b')])
  })
})

describe('the menu as sections', () => {
  it('puts what comes before the first separator in a section of its own', () => {
    const sections = menuSections([item('a'), rule('s1', 'Docència'), item('b')])

    expect(sections).toHaveLength(2)
    expect(sections[0]).toEqual({ separator: null, items: [item('a')] })
    expect(sections[1]!.separator).toEqual(rule('s1', 'Docència'))
    expect(sections[1]!.items).toEqual([item('b')])
  })

  it('has no leading section when the menu opens with a separator', () => {
    const sections = menuSections([rule('s1'), item('a')])

    expect(sections).toHaveLength(1)
    expect(sections[0]!.separator).toEqual(rule('s1'))
  })

  it('is one unfoldable section when nobody has made a separator', () => {
    // Somebody who has never arranged their menu should not find it suddenly
    // collapsible.
    const sections = menuSections([item('a'), item('b')])

    expect(sections).toHaveLength(1)
    expect(sections[0]!.separator).toBeNull()
  })

  it('keeps a separator that has nothing under it yet', () => {
    const sections = menuSections([item('a'), rule('s1', 'Buida')])

    expect(sections[1]).toEqual({ separator: rule('s1', 'Buida'), items: [] })
  })

  it('is nothing at all for an empty menu', () => {
    expect(menuSections([])).toEqual([])
  })
})
