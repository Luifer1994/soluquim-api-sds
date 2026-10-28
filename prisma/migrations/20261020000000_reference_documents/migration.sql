-- Documentación de referencia: la biblioteca que el agente consulta siempre (SGA, GRE, Reglamentación
-- Modelo, Manual de Pruebas, procedimientos internos) y los documentos de cada producto (FDS de las
-- materias primas, de productos análogos, fichas de bases de datos), con su archivo original y sus
-- fragmentos vectorizados.

-- CreateEnum
CREATE TYPE "reference_document_status" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "reference_document_category" AS ENUM ('REGULATION', 'GUIDE', 'MANUAL', 'PROCEDURE', 'DATABASE', 'SUPPLIER_SDS', 'ANALOGOUS_SDS', 'DATABASE_EXTRACT', 'PRODUCT_DATA', 'OTHER');

-- CreateEnum
CREATE TYPE "reference_document_scope" AS ENUM ('LIBRARY', 'PRODUCT');

-- CreateTable
CREATE TABLE "reference_documents" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(64),
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "category" "reference_document_category" NOT NULL DEFAULT 'OTHER',
    "scope" "reference_document_scope" NOT NULL DEFAULT 'LIBRARY',
    "cas" VARCHAR(20),
    "language" VARCHAR(5) NOT NULL DEFAULT 'es',
    "sds_sections" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(150) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "status" "reference_document_status" NOT NULL DEFAULT 'PENDING',
    "page_count" INTEGER,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "embedded_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "indexed_at" TIMESTAMPTZ(3),
    "created_by" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reference_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_document_files" (
    "document_id" UUID NOT NULL,
    "content" BYTEA NOT NULL,

    CONSTRAINT "reference_document_files_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "reference_chunks" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "page_from" INTEGER,
    "page_to" INTEGER,
    "content" TEXT NOT NULL,
    "sds_sections" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "embedding" vector(1536),
    "embedding_model" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reference_documents_scope_status_idx" ON "reference_documents"("scope", "status");

-- CreateIndex
CREATE INDEX "reference_documents_content_hash_idx" ON "reference_documents"("content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "reference_chunks_document_id_position_key" ON "reference_chunks"("document_id", "position");

-- AddForeignKey
ALTER TABLE "reference_document_files" ADD CONSTRAINT "reference_document_files_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "reference_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_chunks" ADD CONSTRAINT "reference_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "reference_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Índices que Prisma no expresa en el schema --------------------------------------------------

-- Búsqueda semántica por similitud de coseno (HNSW).
CREATE INDEX "reference_chunks_embedding_hnsw_idx"
  ON "reference_chunks" USING hnsw ("embedding" vector_cosine_ops);
