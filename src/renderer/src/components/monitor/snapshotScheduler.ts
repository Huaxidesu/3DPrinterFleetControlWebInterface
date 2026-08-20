/**
 * Global snapshot poll scheduler — limits concurrent fetches across all monitor tiles.
 */
type Job = {
  id: string
  run: () => Promise<void>
  resolve: () => void
  reject: (e: unknown) => void
}

const DEFAULT_CONCURRENCY = 6

let concurrency = DEFAULT_CONCURRENCY
let inflight = 0
const queue: Job[] = []
const nextAllowedAt = new Map<string, number>()

export function setSnapshotConcurrency(n: number): void {
  concurrency = Math.max(1, Math.min(32, Math.floor(n) || DEFAULT_CONCURRENCY))
  pump()
}

function backoffMs(failCount: number): number {
  const table = [0, 2_000, 5_000, 12_000, 30_000]
  return table[Math.min(failCount, table.length - 1)]!
}

/** Record failure for a logical camera key so the next schedule waits. */
export function noteSnapshotFailure(key: string, failCount: number): void {
  nextAllowedAt.set(key, Date.now() + backoffMs(failCount))
}

export function noteSnapshotSuccess(key: string): void {
  nextAllowedAt.delete(key)
}

function pump(): void {
  while (inflight < concurrency && queue.length) {
    const job = queue.shift()!
    const waitUntil = nextAllowedAt.get(job.id) || 0
    const delay = Math.max(0, waitUntil - Date.now())
    inflight += 1
    const start = () => {
      job
        .run()
        .then(() => {
          job.resolve()
        })
        .catch((e) => {
          job.reject(e)
        })
        .finally(() => {
          inflight -= 1
          pump()
        })
    }
    if (delay > 0) setTimeout(start, delay)
    else start()
  }
}

/** Enqueue a snapshot pull; same key shares backoff but not mutual exclusion beyond the queue. */
export function scheduleSnapshot(key: string, run: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    queue.push({ id: key, run, resolve, reject })
    pump()
  })
}
