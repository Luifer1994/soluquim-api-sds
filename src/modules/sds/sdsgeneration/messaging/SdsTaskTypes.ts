export const SdsTaskTypes = {
  /** Se pidió una FDS: el worker la genera. Payload: { jobId }. */
  GENERATION_REQUESTED: 'sds.generation.requested',
} as const;
