export const ReferenceTaskTypes = {
  /** Se subió (o se pidió reindexar) un documento de referencia: el worker lo indexa. Payload: { documentId }. */
  INDEX_REQUESTED: 'sds.reference.index',
} as const;
