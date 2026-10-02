/** Events that every handler, async iterator and readable stream of a hub receives. */
export interface EventHub<E extends { type: string }> extends AsyncIterable<E> {
  emit: (event: E) => void
  /** Calls `handler` for each later event of one type. Returns a function that stops the calls. */
  on: <K extends E['type']>(type: K, handler: (event: Extract<E, { type: K }>) => void) => () => void
  /** A new stream of the later events. Each call gives a separate stream. */
  readable: () => ReadableStream<E>
  /** Ends every iterator and stream. Later events go nowhere. */
  close: () => void
}

/** A multicast event hub. An iterator or a stream keeps its unread events in memory. */
export function createEventHub<E extends { type: string }>(): EventHub<E> {
  const handlers = new Map<string, Set<(event: E) => void>>()
  // `undefined` tells a listener that the hub closed.
  const listeners = new Set<(event: E | undefined) => void>()
  let closed = false

  function listen(listener: (event: E | undefined) => void) {
    listeners.add(listener)

    return () => void listeners.delete(listener)
  }

  return {
    emit(event) {
      if (closed)
        return

      for (const handler of handlers.get(event.type) ?? []) {
        try {
          handler(event)
        }
        catch (error) {
          // A failing handler must not stop the other consumers.
          queueMicrotask(() => {
            throw error
          })
        }
      }

      for (const listener of listeners)
        listener(event)
    },

    on(type, handler) {
      const set = handlers.get(type) ?? new Set()
      const call = handler as (event: E) => void

      handlers.set(type, set)
      set.add(call)

      return () => void set.delete(call)
    },

    readable() {
      let stop: (() => void) | undefined

      return new ReadableStream<E>({
        start(controller) {
          if (closed) {
            controller.close()

            return
          }

          stop = listen(event => event === undefined ? controller.close() : controller.enqueue(event))
        },
        cancel() {
          stop?.()
        },
      })
    },

    [Symbol.asyncIterator]() {
      const queue: E[] = []
      let done = closed
      let wake: (() => void) | undefined
      const stop = listen((event) => {
        if (event === undefined)
          done = true
        else
          queue.push(event)

        wake?.()
      })

      return {
        async next() {
          // The listener wakes the iterator on each event and when the hub closes.
          if (!queue.length && !done)
            await new Promise<void>(resolve => wake = resolve)

          wake = undefined

          if (queue.length)
            return { done: false, value: queue.shift()! }

          stop()

          return { done: true, value: undefined }
        },
        async return() {
          stop()
          queue.length = 0
          done = true

          return { done: true, value: undefined }
        },
        [Symbol.asyncIterator]() {
          return this
        },
      }
    },

    close() {
      if (closed)
        return

      closed = true

      for (const listener of listeners)
        listener(undefined)

      listeners.clear()
      handlers.clear()
    },
  }
}
