-- Legal documents (provider-managed privacy, terms, impressum)
CREATE TYPE "LegalDocumentType" AS ENUM ('privacy_policy', 'terms_conditions', 'impressum');

CREATE TABLE "legal_documents" (
    "id" TEXT NOT NULL,
    "type" "LegalDocumentType" NOT NULL,
    "language" VARCHAR(8) NOT NULL DEFAULT 'en',
    "title" TEXT NOT NULL,
    "content_html" TEXT NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "legal_documents_type_language_key" ON "legal_documents"("type", "language");
