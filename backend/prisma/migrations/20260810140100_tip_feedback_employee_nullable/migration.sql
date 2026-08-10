-- TipFeedback.employeeId nullable for detached tips (Slice D null-safety follow-up).
ALTER TABLE "tip_feedback" ALTER COLUMN "employee_id" DROP NOT NULL;
