import { WaitingError, type Worker } from "bullmq";

export const researchLockLostReason =
  "Research job lock was lost; awaiting stalled-job recovery.";

export function cancelLostLocks(
  worker: Pick<Worker, "cancelJob">,
  jobIds: string[],
) {
  for (const id of jobIds) {
    worker.cancelJob(id, researchLockLostReason);
  }
}

// Do not attempt a failed/delayed transition without a lock, or overwrite
// checkpoint state that the next owner will use to resume the job.
export function deferLostLock(signal?: AbortSignal): void {
  if (signal?.aborted && signal.reason === researchLockLostReason) {
    throw new WaitingError();
  }
}
