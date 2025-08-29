spasht – AI Interview Coach

Quick start
- Copy env vars (Clerk, AWS credentials): create .env.local with NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, DATABASE_URL.
- Install deps and run dev:
  - npm install
  - npm run dev

Admin & flags
- Admin page: /admin (requires Clerk and role=admin in publicMetadata).
- Choose ASR provider (Transcribe, Nova Realtime stub, WebSpeech fallback), failover mode, rates/retention.
- Analytics: /admin/analytics (dynamic, needs DB for full stats).
  - Shows totals and p95 latency (ASR/Coach) from SessionEvent metrics.

ASR
- Transcribe streaming path implemented via /api/asr/transcribe + client provider.
- Nova Realtime provider scaffolded; AUTO_SWITCH failover falls back to Transcribe/WebSpeech.

Coaching
- Bedrock Nova text integration for nudges (/api/coach/nudges) and reports (/api/coach/report) with rate limits and optional PII redaction.

Sessions
- Start/end APIs and event logging added. Apply Prisma migrations to enable SessionEvent.
  - npx prisma migrate dev
  - npx prisma generate

Retention
- Admin route to run cleanup now: POST /api/admin/retention/run (uses FeatureConfig.dataRetentionDays).
 - Consider scheduling a cron to call this endpoint in production.

Build
- npm run build
# spasht - AI Interview & Communication Coach

Master job interviews with AI-powered coaching, real-time feedback, and fluency training designed specifically for college students and young professionals.

## 🚀 Features

- **Mock Interviews**: AI-generated questions tailored to your target role
- **Real-time Feedback**: Instant nudges on pacing, filler words, and confidence
- **Fluency Training**: Pronunciation and communication clarity coaching  
- **Progress Tracking**: Detailed analytics and achievement badges
- **AWS Powered**: Built on scalable AWS infrastructure (Bedrock, Transcribe, S3)

## 🛠️ Tech Stack

- **Frontend**: Next.js 14+, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes, tRPC
- **Database**: PostgreSQL with Prisma ORM
- **AI/ML**: AWS Bedrock (Nova), Transcribe, Rekognition
- **Auth**: Clerk
- **Storage**: AWS S3
- **Real-time**: Socket.io

## 📋 Prerequisites

- Node.js 18+ 
- PostgreSQL database
- AWS Account with access to Bedrock, Transcribe, S3
- Clerk account for authentication

## ⚙️ Setup Instructions

### 1. Clone and Install Dependencies

```bash
git clone <your-repo-url>
cd spasht
npm install
```

### Admin panel
- Clerk admin role: set `publicMetadata.role` to `"admin"` for your user.
- Visit `/admin` to toggle ASR provider, failover, rate limits, retention, and audit.
- Flags API: `GET/POST /api/admin/flags` (admin only).
- Client config: `GET /api/config/asr` returns provider/failover/language.

### Database (Prisma)
- Set `DATABASE_URL` in `.env.local` to run migrations.
- Create migration: `npx prisma migrate dev --name add_feature_config`
- Generate client: `npx prisma generate`

### 2. Environment Variables

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

Required environment variables:
- `AWS_ACCESS_KEY_ID` - Your AWS access key
- `AWS_SECRET_ACCESS_KEY` - Your AWS secret key  
- `AWS_REGION` - AWS region (e.g., us-east-1)
- `DATABASE_URL` - PostgreSQL connection string
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk publishable key
- `CLERK_SECRET_KEY` - Clerk secret key
- `AWS_S3_BUCKET_NAME` - S3 bucket for file uploads

### 3. Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# (Optional) Seed database
npx prisma db seed
```

### 4. AWS Configuration

Ensure your AWS account has access to:
- AWS Bedrock (Nova models)
- AWS Transcribe
- AWS Rekognition  
- AWS S3
- Proper IAM permissions

### 5. Run Development Server

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
