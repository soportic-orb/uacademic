/**
 * The order somebody keeps their own menu in.
 *
 * The product decides what a role may reach; the person decides where it sits.
 * Those are different questions, and conflating them is how a menu ends up
 * with fifteen entries in the order they happened to be written in.
 *
 * A layout is a list of what to draw, not a copy of the menu: an item the
 * layout does not mention is still drawn, at the end, because an update that
 * adds a screen must not hide it from everybody who has ever arranged their
 * menu — and an item the layout names but the person can no longer reach is
 * dropped, because a role can be taken away.
 */
export interface MenuItemEntry {
  kind: 'item'
  /** The `NavItem.key` this refers to. */
  key: string
}

export interface MenuSeparatorEntry {
  kind: 'separator'
  /** Stable across reorderings, so React and the buttons can address it. */
  id: string
  /** Written by the person. Empty is allowed: a plain rule is a real choice. */
  label: string
}

export type MenuEntry = MenuItemEntry | MenuSeparatorEntry

/** What a person may reach, in the order the product declares it. */
export interface MenuAvailable {
  key: string
}

/**
 * The menu as it should be drawn.
 *
 * Everything available appears exactly once: the layout decides the order of
 * what it names, and whatever it does not name follows in the product's own
 * order. Separators are kept where they were put, minus the ones that would
 * render as a rule against nothing — leading, trailing, or two in a row.
 */
export function applyMenuLayout(
  available: readonly MenuAvailable[],
  layout: readonly MenuEntry[],
): MenuEntry[] {
  return tidySeparators(orderMenuEntries(available, layout))
}

/**
 * The same, without dropping anything.
 *
 * What the editor works on. Tidying is right for *drawing* a menu — a rule
 * against nothing is a mistake on screen — but it is wrong while somebody is
 * arranging one: a separator added above another is momentarily adjacent to
 * it, and quietly deleting one of the two makes a new separator look like it
 * overwrote the last. Nothing should disappear under the hands of the person
 * moving it; the sidebar tidies when it draws.
 */
export function orderMenuEntries(
  available: readonly MenuAvailable[],
  layout: readonly MenuEntry[],
): MenuEntry[] {
  const reachable = new Set(available.map((item) => item.key))
  const placed = new Set<string>()
  const ordered: MenuEntry[] = []

  for (const entry of layout) {
    if (entry.kind === 'separator') {
      ordered.push(entry)
      continue
    }
    // Not reachable any more (a role was taken away), or named twice.
    if (!reachable.has(entry.key) || placed.has(entry.key)) continue
    placed.add(entry.key)
    ordered.push(entry)
  }

  for (const item of available) {
    if (!placed.has(item.key)) ordered.push({ kind: 'item', key: item.key })
  }

  return ordered
}

/** Drops the separators that would draw a rule against nothing. */
export function tidySeparators(entries: readonly MenuEntry[]): MenuEntry[] {
  const kept: MenuEntry[] = []

  for (const entry of entries) {
    if (entry.kind !== 'separator') {
      kept.push(entry)
      continue
    }
    // Nothing above it yet, or the thing above it is another separator.
    if (kept.length === 0 || kept.at(-1)?.kind === 'separator') continue
    kept.push(entry)
  }

  while (kept.at(-1)?.kind === 'separator') kept.pop()
  return kept
}

/**
 * One step up or down.
 *
 * Returns the list unchanged at the ends rather than wrapping around: a button
 * that sends the top entry to the bottom is a button somebody presses once by
 * accident and then has to undo eleven times.
 */
export function moveEntry(
  entries: readonly MenuEntry[],
  index: number,
  direction: -1 | 1,
): MenuEntry[] {
  const target = index + direction
  if (index < 0 || index >= entries.length || target < 0 || target >= entries.length) {
    return [...entries]
  }

  const next = [...entries]
  const moved = next[index] as MenuEntry
  next[index] = next[target] as MenuEntry
  next[target] = moved
  return next
}

export function insertSeparator(
  entries: readonly MenuEntry[],
  index: number,
  separator: MenuSeparatorEntry,
): MenuEntry[] {
  const at = Math.min(Math.max(index, 0), entries.length)
  return [...entries.slice(0, at), separator, ...entries.slice(at)]
}

/** Removes a separator. Items are never removed: they are what the menu is. */
export function removeSeparator(entries: readonly MenuEntry[], id: string): MenuEntry[] {
  return entries.filter((entry) => entry.kind !== 'separator' || entry.id !== id)
}

export function renameSeparator(
  entries: readonly MenuEntry[],
  id: string,
  label: string,
): MenuEntry[] {
  return entries.map((entry) =>
    entry.kind === 'separator' && entry.id === id ? { ...entry, label } : entry,
  )
}
