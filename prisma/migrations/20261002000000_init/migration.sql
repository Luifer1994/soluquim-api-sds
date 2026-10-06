-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "source_status" AS ENUM ('OK', 'NOT_FOUND', 'FAILED', 'CIRCUIT_OPEN', 'SKIPPED');

-- CreateEnum
CREATE TYPE "sds_generation_status" AS ENUM ('QUEUED', 'EXTRACTING', 'CLASSIFYING', 'DRAFTING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "sds_document_status" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "sds_review_action" AS ENUM ('SECTION_EDITED', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "substances" (
    "cas" VARCHAR(12) NOT NULL,
    "name" VARCHAR(500),
    "iupac_name" TEXT,
    "formula" VARCHAR(255),
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "substances_pkey" PRIMARY KEY ("cas")
);

-- CreateTable
CREATE TABLE "substance_source_data" (
    "id" UUID NOT NULL,
    "cas" VARCHAR(12) NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "status" "source_status" NOT NULL,
    "records" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "duration_ms" INTEGER,
    "retrieved_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "raw_snapshot_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "substance_source_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_snapshots" (
    "id" UUID NOT NULL,
    "cas" VARCHAR(12) NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "url" TEXT NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "content" BYTEA NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sds_generation_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(64) NOT NULL,
    "mixture_key" CHAR(64) NOT NULL,
    "request" JSONB NOT NULL,
    "status" "sds_generation_status" NOT NULL DEFAULT 'QUEUED',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "document_id" UUID,
    "requested_by" VARCHAR(64),
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sds_generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sds_documents" (
    "id" UUID NOT NULL,
    "tenant_id" VARCHAR(64) NOT NULL,
    "product_id" UUID,
    "mixture_key" CHAR(64) NOT NULL,
    "country_id" INTEGER NOT NULL,
    "language" VARCHAR(5) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "sds_document_status" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "missing_data" JSONB NOT NULL DEFAULT '[]',
    "rules_version" VARCHAR(40) NOT NULL,
    "llm_model" VARCHAR(100),
    "prompt_version" VARCHAR(40),
    "created_by" VARCHAR(64),
    "approved_by" VARCHAR(64),
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sds_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sds_document_reviews" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "action" "sds_review_action" NOT NULL,
    "section" INTEGER,
    "comment" TEXT,
    "changes" JSONB,
    "user_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sds_document_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "substance_source_data_expires_at_idx" ON "substance_source_data"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "substance_source_data_cas_source_key" ON "substance_source_data"("cas", "source");

-- CreateIndex
CREATE INDEX "raw_snapshots_cas_source_idx" ON "raw_snapshots"("cas", "source");

-- CreateIndex
CREATE INDEX "sds_generation_jobs_tenant_id_mixture_key_status_idx" ON "sds_generation_jobs"("tenant_id", "mixture_key", "status");

-- CreateIndex
CREATE INDEX "sds_generation_jobs_tenant_id_created_at_idx" ON "sds_generation_jobs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "sds_documents_tenant_id_mixture_key_idx" ON "sds_documents"("tenant_id", "mixture_key");

-- CreateIndex
CREATE INDEX "sds_documents_tenant_id_status_idx" ON "sds_documents"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "sds_documents_tenant_id_product_id_idx" ON "sds_documents"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "sds_document_reviews_document_id_created_at_idx" ON "sds_document_reviews"("document_id", "created_at");

-- AddForeignKey
ALTER TABLE "substance_source_data" ADD CONSTRAINT "substance_source_data_cas_fkey" FOREIGN KEY ("cas") REFERENCES "substances"("cas") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substance_source_data" ADD CONSTRAINT "substance_source_data_raw_snapshot_id_fkey" FOREIGN KEY ("raw_snapshot_id") REFERENCES "raw_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sds_generation_jobs" ADD CONSTRAINT "sds_generation_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "sds_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sds_document_reviews" ADD CONSTRAINT "sds_document_reviews_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "sds_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

