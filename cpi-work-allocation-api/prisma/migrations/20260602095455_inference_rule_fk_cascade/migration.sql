-- AlterTable
ALTER TABLE "InferenceRule" ADD COLUMN     "subCategoryId" INTEGER,
ADD COLUMN     "workTypeId" INTEGER;

-- CreateIndex
CREATE INDEX "InferenceRule_subCategoryId_idx" ON "InferenceRule"("subCategoryId");

-- CreateIndex
CREATE INDEX "InferenceRule_workTypeId_idx" ON "InferenceRule"("workTypeId");

-- AddForeignKey
ALTER TABLE "InferenceRule" ADD CONSTRAINT "InferenceRule_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InferenceRule" ADD CONSTRAINT "InferenceRule_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "WorkType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
