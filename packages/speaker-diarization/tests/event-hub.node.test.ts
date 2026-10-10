import { describe, expect, it } from 'vitest'

import { createEventHub } from '../src/event-hub'

interface Event { type: 'tick', value: number }

describe('event hub iterator', () => {
  it('gives each waiting call of next its own event, in order', async () => {
    const hub = createEventHub<Event>()
    const iterator = hub[Symbol.asyncIterator]()
    const first = iterator.next()
    const second = iterator.next()

    hub.emit({ type: 'tick', value: 1 })
    hub.emit({ type: 'tick', value: 2 })

    expect(await first).toEqual({ done: false, value: { type: 'tick', value: 1 } })
    expect(await second).toEqual({ done: false, value: { type: 'tick', value: 2 } })
  })

  it('keeps events that arrive before next is called', async () => {
    const hub = createEventHub<Event>()
    const iterator = hub[Symbol.asyncIterator]()

    hub.emit({ type: 'tick', value: 1 })

    expect(await iterator.next()).toEqual({ done: false, value: { type: 'tick', value: 1 } })
  })

  it('ends every waiting call when the hub closes or the iterator returns', async () => {
    const hub = createEventHub<Event>()
    const closing = hub[Symbol.asyncIterator]()
    const returning = hub[Symbol.asyncIterator]()
    const waiting = [closing.next(), closing.next()]
    const pending = returning.next()

    await returning.return!()
    expect(await pending).toEqual({ done: true, value: undefined })

    hub.close()
    expect(await Promise.all(waiting)).toEqual([{ done: true, value: undefined }, { done: true, value: undefined }])
    expect(await closing.next()).toEqual({ done: true, value: undefined })
  })
})
