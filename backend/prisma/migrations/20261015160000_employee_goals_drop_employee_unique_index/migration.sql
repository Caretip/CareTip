-- 20260506102300_employee_goals_crud intended to allow multiple goals per employee but only dropped
-- pg_constraint rows; the init migration created "employee_goals_employee_id_key" as a plain UNIQUE
-- INDEX, so it survived on every database built from migrations.
-- Rollback: CREATE UNIQUE INDEX "employee_goals_employee_id_key" ON "employee_goals"("employee_id");
DROP INDEX IF EXISTS "employee_goals_employee_id_key";
