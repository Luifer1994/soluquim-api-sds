export interface SdsGenerationJobResponseDTO {
  jobId: string;
  status: string;
  documentId: string | null;
  progress: unknown;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
