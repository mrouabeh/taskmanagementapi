DROP INDEX "memberships_organization_id_idx";--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_user_id_users_id_fkey", ADD CONSTRAINT "memberships_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");