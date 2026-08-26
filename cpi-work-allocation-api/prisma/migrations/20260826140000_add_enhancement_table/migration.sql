-- Admin-maintainable Enhancement roster.
--
-- Replaces the hardcoded const list in cpi-work-allocation-shared so Finance
-- can extend it without a deploy. Seeded with the original six so the switch
-- is a no-op for existing behaviour.
CREATE TABLE "Enhancement" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Enhancement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Enhancement_name_key" ON "Enhancement"("name");

INSERT INTO "Enhancement" ("name", "sortOrder") VALUES
    ('MTC API', 0),
    ('Smart Claims', 1),
    ('OAuth/OIDC', 2),
    ('Plate Number Validation', 3),
    ('Treaty Limit', 4),
    ('GISTP2.5', 5)
ON CONFLICT ("name") DO NOTHING;
