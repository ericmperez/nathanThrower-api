-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "hasImage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "imageKey" TEXT,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "thumbnailUrl" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "tier" TEXT NOT NULL DEFAULT 'free';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "currentVelocity" INTEGER,
ADD COLUMN     "emailVerificationExpiry" TIMESTAMP(3),
ADD COLUMN     "emailVerificationToken" TEXT,
ADD COLUMN     "emailVerified" BOOLEAN DEFAULT false,
ADD COLUMN     "endGoal" TEXT,
ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "goals" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "handedness" TEXT,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "oauthId" TEXT,
ADD COLUMN     "oauthProvider" TEXT,
ADD COLUMN     "passwordResetExpiry" TIMESTAMP(3),
ADD COLUMN     "passwordResetToken" TEXT,
ADD COLUMN     "profilePicture" TEXT,
ADD COLUMN     "targetVelocity" INTEGER,
ALTER COLUMN "password" DROP NOT NULL;

-- CreateTable
CREATE TABLE "MessageReaction" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageBookmark" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT,
    "lessonId" TEXT,
    "activityType" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserStreak" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActivityDate" TIMESTAMP(3),
    "streakStartDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserStreak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingProgram" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "durationWeeks" INTEGER NOT NULL DEFAULT 4,
    "thumbnailUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPremium" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingProgramWeek" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingProgramWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingProgramDay" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "drillIds" TEXT[],
    "notes" TEXT,
    "restDay" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingProgramDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProgramEnrollment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentWeek" INTEGER NOT NULL DEFAULT 1,
    "currentDay" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "completedDays" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProgramEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipOfTheWeek" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "videoUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipOfTheWeek_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageReaction_messageId_idx" ON "MessageReaction"("messageId");

-- CreateIndex
CREATE INDEX "MessageReaction_userId_idx" ON "MessageReaction"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageReaction_messageId_userId_emoji_key" ON "MessageReaction"("messageId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "MessageBookmark_userId_idx" ON "MessageBookmark"("userId");

-- CreateIndex
CREATE INDEX "MessageBookmark_messageId_idx" ON "MessageBookmark"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageBookmark_messageId_userId_key" ON "MessageBookmark"("messageId", "userId");

-- CreateIndex
CREATE INDEX "WorkoutLog_userId_date_idx" ON "WorkoutLog"("userId", "date");

-- CreateIndex
CREATE INDEX "WorkoutLog_userId_createdAt_idx" ON "WorkoutLog"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutLog_userId_date_courseId_lessonId_activityType_key" ON "WorkoutLog"("userId", "date", "courseId", "lessonId", "activityType");

-- CreateIndex
CREATE UNIQUE INDEX "UserStreak_userId_key" ON "UserStreak"("userId");

-- CreateIndex
CREATE INDEX "UserStreak_userId_idx" ON "UserStreak"("userId");

-- CreateIndex
CREATE INDEX "AuthAuditLog_userId_createdAt_idx" ON "AuthAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthAuditLog_action_createdAt_idx" ON "AuthAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuthAuditLog_createdAt_idx" ON "AuthAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "TrainingProgram_category_idx" ON "TrainingProgram"("category");

-- CreateIndex
CREATE INDEX "TrainingProgram_isActive_idx" ON "TrainingProgram"("isActive");

-- CreateIndex
CREATE INDEX "TrainingProgram_isPremium_idx" ON "TrainingProgram"("isPremium");

-- CreateIndex
CREATE INDEX "TrainingProgramWeek_programId_idx" ON "TrainingProgramWeek"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingProgramWeek_programId_weekNumber_key" ON "TrainingProgramWeek"("programId", "weekNumber");

-- CreateIndex
CREATE INDEX "TrainingProgramDay_weekId_idx" ON "TrainingProgramDay"("weekId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingProgramDay_weekId_dayNumber_key" ON "TrainingProgramDay"("weekId", "dayNumber");

-- CreateIndex
CREATE INDEX "UserProgramEnrollment_userId_status_idx" ON "UserProgramEnrollment"("userId", "status");

-- CreateIndex
CREATE INDEX "UserProgramEnrollment_programId_idx" ON "UserProgramEnrollment"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "UserProgramEnrollment_userId_programId_key" ON "UserProgramEnrollment"("userId", "programId");

-- CreateIndex
CREATE INDEX "TipOfTheWeek_isActive_publishedAt_idx" ON "TipOfTheWeek"("isActive", "publishedAt");

-- CreateIndex
CREATE INDEX "TipOfTheWeek_expiresAt_idx" ON "TipOfTheWeek"("expiresAt");

-- CreateIndex
CREATE INDEX "Subscription_tier_idx" ON "Subscription"("tier");

-- CreateIndex
CREATE INDEX "User_oauthProvider_oauthId_idx" ON "User"("oauthProvider", "oauthId");

-- CreateIndex
CREATE INDEX "User_emailVerificationToken_idx" ON "User"("emailVerificationToken");

-- CreateIndex
CREATE INDEX "User_passwordResetToken_idx" ON "User"("passwordResetToken");

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageBookmark" ADD CONSTRAINT "MessageBookmark_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutLog" ADD CONSTRAINT "WorkoutLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStreak" ADD CONSTRAINT "UserStreak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthAuditLog" ADD CONSTRAINT "AuthAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProgramWeek" ADD CONSTRAINT "TrainingProgramWeek_programId_fkey" FOREIGN KEY ("programId") REFERENCES "TrainingProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProgramDay" ADD CONSTRAINT "TrainingProgramDay_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "TrainingProgramWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProgramEnrollment" ADD CONSTRAINT "UserProgramEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProgramEnrollment" ADD CONSTRAINT "UserProgramEnrollment_programId_fkey" FOREIGN KEY ("programId") REFERENCES "TrainingProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
