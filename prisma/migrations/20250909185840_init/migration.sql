-- CreateEnum
CREATE TYPE "public"."AsrProvider" AS ENUM ('TRANSCRIBE', 'NOVA_REALTIME', 'WEBSPEECH_FALLBACK');

-- CreateEnum
CREATE TYPE "public"."FailoverMode" AS ENUM ('FIXED', 'AUTO_SWITCH');

-- CreateEnum
CREATE TYPE "public"."ExperienceLevel" AS ENUM ('FRESHER', 'JUNIOR', 'MID_LEVEL', 'SENIOR');

-- CreateEnum
CREATE TYPE "public"."InterviewType" AS ENUM ('HR_BEHAVIORAL', 'TECHNICAL', 'CASE_STUDY', 'GROUP_DISCUSSION', 'PRESENTATION');

-- CreateEnum
CREATE TYPE "public"."BadgeType" AS ENUM ('FIRST_SESSION', 'WEEK_STREAK', 'MONTH_STREAK', 'PERFECT_SCORE', 'FLUENCY_MASTER', 'CONFIDENCE_BOOST', 'GRAMMAR_GURU');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "profileImage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resumeUrl" TEXT,
    "targetRole" TEXT,
    "experienceLevel" "public"."ExperienceLevel" NOT NULL DEFAULT 'FRESHER',
    "streakCount" INTEGER NOT NULL DEFAULT 0,
    "lastSessionDate" TIMESTAMP(3),
    "totalPoints" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."interview_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "public"."InterviewType" NOT NULL,
    "duration" INTEGER NOT NULL,
    "jobDescription" TEXT,
    "questions" JSONB NOT NULL,
    "audioUrl" TEXT,
    "videoUrl" TEXT,
    "transcription" TEXT,
    "overallScore" DOUBLE PRECISION,
    "fluencyScore" DOUBLE PRECISION,
    "confidenceScore" DOUBLE PRECISION,
    "clarityScore" DOUBLE PRECISION,
    "fillerWords" JSONB,
    "speakingPace" DOUBLE PRECISION,
    "suggestions" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "interview_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_badges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeType" "public"."BadgeType" NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."feature_config" (
    "id" INTEGER NOT NULL,
    "asrProvider" "public"."AsrProvider" NOT NULL DEFAULT 'TRANSCRIBE',
    "failoverMode" "public"."FailoverMode" NOT NULL DEFAULT 'FIXED',
    "language" TEXT NOT NULL DEFAULT 'en-US',
    "nudgesRateLimitPerMin" INTEGER NOT NULL DEFAULT 20,
    "reportPerSessionLimit" INTEGER NOT NULL DEFAULT 2,
    "dataRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "piiRedactionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "auditEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."admin_audit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."session_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,

    CONSTRAINT "session_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_clerkId_key" ON "public"."users"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_badges_userId_badgeType_key" ON "public"."user_badges"("userId", "badgeType");

-- CreateIndex
CREATE INDEX "admin_audit_actorId_createdAt_idx" ON "public"."admin_audit"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "session_events_sessionId_ts_idx" ON "public"."session_events"("sessionId", "ts");

-- AddForeignKey
ALTER TABLE "public"."interview_sessions" ADD CONSTRAINT "interview_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_badges" ADD CONSTRAINT "user_badges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."session_events" ADD CONSTRAINT "session_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."interview_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
