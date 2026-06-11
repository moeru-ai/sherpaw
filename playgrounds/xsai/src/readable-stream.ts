interface ReduceReadableStreamOptions {
  onError?: (error: unknown) => void
}

export function reduceReadableStream<T, TState>(
  stream: ReadableStream<T>,
  initialState: TState,
  reducer: (state: TState, value: T) => TState | void | Promise<TState | void>,
  options: ReduceReadableStreamOptions = {},
): () => void {
  const reader = stream.getReader()
  let aborted = false

  const abort = () => {
    aborted = true
    void reader.cancel().catch(() => {})
  }

  void (async () => {
    let state = initialState

    try {
      while (true) {
        if (aborted) {
          break
        }

        const { done, value } = await reader.read()

        if (done || aborted) {
          break
        }

        const nextState = await reducer(state, value)
        if (nextState !== undefined) {
          state = nextState
        }
      }
    }
    catch (error) {
      if (!aborted) {
        options.onError?.(error)
      }
    }
    finally {
      reader.releaseLock()
    }
  })()

  return abort
}
