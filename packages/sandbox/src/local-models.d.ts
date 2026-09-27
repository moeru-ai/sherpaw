declare module 'virtual:local-models' {
  /** Fetch a path relative to the local models directory. Rejects outside Vite dev. */
  export function fetchLocalModel(path: string): Promise<Response>
}
