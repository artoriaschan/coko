// Errors thrown by the runtime's control methods (re-exported from runtime.ts).

export class RuntimeBusyError extends Error {
  override readonly name = 'RuntimeBusyError'
  constructor() {
    super('A Run is already in progress')
  }
}

export class NothingToRetryError extends Error {
  override readonly name = 'NothingToRetryError'
  constructor() {
    super('The last turn did not fail; there is nothing to retry')
  }
}

export class NoActiveRunError extends Error {
  override readonly name = 'NoActiveRunError'
  constructor() {
    super('There is no Run in progress')
  }
}

export class NothingToContinueError extends Error {
  override readonly name = 'NothingToContinueError'
  constructor() {
    super('The last Run was not paused or interrupted; there is nothing to continue')
  }
}

/** Thrown inside prepareRequest when the host withholds a request; the runtime drops the failure message pi records for it. */
export const REQUEST_WITHHELD_TEXT = 'Request withheld by the host'
