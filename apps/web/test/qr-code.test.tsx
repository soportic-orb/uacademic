import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { QrCode } from '../src/components/data/qr-code'

/**
 * A subscription URL carries a 64-character token. Typing that into a phone is
 * not a thing anybody does twice, so the code is the route that actually gets
 * used — and a code that does not encode the address is worse than none.
 */
describe('the subscription QR code', () => {
  const url = 'https://uacademic.cat/api/v1/calendar/feed/' + 'a'.repeat(64) + '.ics'

  it('draws one path rather than a thousand rectangles', () => {
    const { container } = render(<QrCode value={url} />)

    expect(container.querySelectorAll('path')).toHaveLength(1)
    expect(container.querySelectorAll('rect')).toHaveLength(0)
  })

  it('grows its grid with the length of what it encodes', () => {
    const short = render(<QrCode value="https://uacademic.cat" />).container
    const long = render(<QrCode value={url} />).container

    const modulesOf = (root: Element) =>
      Number(root.querySelector('svg')?.getAttribute('viewBox')?.split(' ')[2])

    expect(modulesOf(long)).toBeGreaterThan(modulesOf(short))
  })

  it('leaves itself out of the accessibility tree, since the address is beside it', () => {
    const { container } = render(<QrCode value={url} />)

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
