import type { NodeInfo } from './types'

export type SyncStage = 'connecting' | 'headers' | 'blocks' | 'indexing' | 'synced'

export interface SyncView {
  stage: SyncStage
  /** Best known chain height: our headers or the best peer, whichever is higher. */
  target: number
  headers: number
  blocks: number
  indexed: number
}

// A couple of blocks behind still counts as caught up; new blocks arrive every ~2 minutes.
const SLACK = 2

/**
 * Where a node is in its initial sync. Stages happen in order: headers first,
 * then full blocks, then the extra indexer the Lithos Client depends on.
 */
export function syncView(info: NodeInfo): SyncView {
  const headers = info.headersHeight ?? 0
  const blocks = info.fullHeight ?? 0
  const indexed = info.indexedHeight ?? 0
  const target = Math.max(info.maxPeerHeight ?? 0, headers)

  let stage: SyncStage
  // Without a peer we can't know the chain height, so never claim to be synced.
  if (!info.maxPeerHeight || info.peersCount === 0) stage = 'connecting'
  else if (headers < target - SLACK) stage = 'headers'
  else if (blocks < headers - SLACK) stage = 'blocks'
  else if (indexed < blocks - SLACK) stage = 'indexing'
  else stage = 'synced'

  return { stage, target, headers, blocks, indexed }
}
