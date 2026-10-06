-- AlterTable
ALTER TABLE "sds_documents" ADD COLUMN     "country_code" VARCHAR(2),
ALTER COLUMN "country_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "substance_source_data" ADD COLUMN     "content_hash" CHAR(64),
ADD COLUMN     "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "substance_source_data_history" (
    "id" UUID NOT NULL,
    "cas" VARCHAR(12) NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "source_status" NOT NULL,
    "records" JSONB NOT NULL,
    "content_hash" CHAR(64),
    "valid_from" TIMESTAMPTZ(3) NOT NULL,
    "valid_to" TIMESTAMPTZ(3) NOT NULL,
    "raw_snapshot_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "substance_source_data_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "cas" VARCHAR(12),
    "source" VARCHAR(40) NOT NULL,
    "chunk_key" VARCHAR(120) NOT NULL,
    "source_version" INTEGER NOT NULL DEFAULT 1,
    "sds_sections" INTEGER[],
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "language" VARCHAR(5) NOT NULL DEFAULT 'en',
    "source_url" TEXT,
    "content_hash" CHAR(64) NOT NULL,
    "embedding" vector(1536),
    "embedding_model" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "substance_source_data_history_cas_source_valid_to_idx" ON "substance_source_data_history"("cas", "source", "valid_to");

-- CreateIndex
CREATE UNIQUE INDEX "substance_source_data_history_cas_source_version_key" ON "substance_source_data_history"("cas", "source", "version");

-- CreateIndex
CREATE INDEX "knowledge_chunks_cas_idx" ON "knowledge_chunks"("cas");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_cas_source_chunk_key_key" ON "knowledge_chunks"("cas", "source", "chunk_key");


-- Índices que Prisma no expresa en el schema --------------------------------------------------

-- Búsqueda semántica por similitud de coseno (HNSW: rápido y sin entrenamiento previo).
CREATE INDEX "knowledge_chunks_embedding_hnsw_idx"
  ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- Filtro por sección de la FDS (operador && de arrays).
CREATE INDEX "knowledge_chunks_sds_sections_gin_idx"
  ON "knowledge_chunks" USING gin ("sds_sections");
