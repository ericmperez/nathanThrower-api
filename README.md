# PitchCoach AI - API Backend

Node.js + Express + TypeScript backend for PitchCoach AI.

## Features

- ✅ RESTful API with Express
- ✅ PostgreSQL database with Prisma ORM
- ✅ JWT authentication
- ✅ S3-compatible storage for videos (presigned uploads)
- ✅ BullMQ job queue for video analysis
- ✅ Pluggable analysis provider (mock included)
- ✅ Course management & purchases
- ✅ Admin routes for content management

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis 6+ (for job queue)
- AWS S3 or compatible storage (Cloudflare R2, MinIO, etc.)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Key variables:

- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: Secret for JWT tokens (change in production!)
- `AWS_*`: S3 credentials and bucket
- `REDIS_HOST`/`REDIS_PORT`: Redis connection
- `OPENAI_API_KEY`: (optional) for real LLM coaching

### 3. Database Setup

```bash
# Generate Prisma client
npm run db:generate

# Push schema to database
npm run db:push

# Seed initial data
npm run db:seed
```

This creates:

- Admin user: `admin@pitchcoach.ai` / `admin123`
- Demo user: `demo@example.com` / `demo123`
- 3 sample courses with lessons
- Drill library

### 4. Start Services

**Terminal 1 - API Server:**

```bash
npm run dev
```

**Terminal 2 - Worker:**

```bash
npm run worker
```

API runs on `http://localhost:4000`

## API Endpoints

### Authentication

- `POST /auth/register` - Register new user
- `POST /auth/login` - Login
- `GET /auth/me` - Get current user (requires auth)

### Videos

- `POST /videos/presign` - Get presigned S3 upload URL (requires auth)

### Analyses

- `POST /analyses` - Create analysis job (requires auth)
- `GET /analyses` - List user's analyses (requires auth)
- `GET /analyses/:id` - Get specific analysis (requires auth)

### Courses

- `GET /courses` - List published courses
- `GET /courses/:id` - Get course details
- `GET /courses/:courseId/lessons/:lessonId` - Get lesson (requires auth)
- `POST /courses/:id/purchase` - Mock purchase (requires auth)

### Admin (requires admin role)

- `POST /admin/courses` - Create course
- `PATCH /admin/courses/:id` - Update course
- `DELETE /admin/courses/:id` - Delete course
- `POST /admin/lessons` - Create lesson
- `PATCH /admin/lessons/:id` - Update lesson
- `DELETE /admin/lessons/:id` - Delete lesson
- `POST /admin/drills` - Create drill
- `GET /admin/drills` - List drills

### Webhooks

- `POST /webhooks/stripe` - Stripe webhook handler (placeholder)

## Analysis Pipeline

1. User uploads video → receives presigned S3 URL
2. User creates analysis with `videoKey` + metadata
3. Analysis job queued in Redis (BullMQ)
4. Worker processes job:
   - Downloads video from S3 (optional for mock)
   - Runs pose estimation (mock returns realistic data)
   - Generates coaching report
   - Stores results in DB
5. User polls `GET /analyses/:id` for status/results

## Mock Analysis Provider

The `MockAnalysisProvider` returns realistic metrics and coaching cues without requiring actual video processing. Perfect for MVP development.

To swap for real analysis:

1. Implement `IAnalysisProvider` interface
2. Update `src/services/analysisProvider.ts`

Example metrics generated:

- Stride length %
- Trunk tilt degrees
- Shoulder-hip separation
- Arm slot angle
- Release point consistency
- Lead leg block timing
- Head stability

## Database Schema

Key models:

- **User**: email, password, role
- **VideoAsset**: S3 key, URL
- **Analysis**: user, video, metadata, status
- **AnalysisMetrics**: JSON metrics
- **CoachingReport**: JSON report (cues, routine, flags)
- **Course**: title, description, price
- **Lesson**: course, order, free/paid
- **Purchase**: user, course, status
- **Drill**: library of exercises

## Rate Limiting

Free users: 2 analyses per week
Admin users: unlimited

Configurable in `src/routes/analyses.ts`

## Scripts

- `npm run dev` - Start dev server with hot reload
- `npm run build` - Build for production
- `npm start` - Run production build
- `npm run worker` - Start background worker
- `npm run db:generate` - Generate Prisma client
- `npm run db:push` - Push schema to DB
- `npm run db:migrate` - Create migration
- `npm run db:seed` - Seed database

## Production Considerations

1. **Security:**

   - Change `JWT_SECRET`
   - Use environment-specific secrets
   - Enable CORS whitelist
   - Add rate limiting (express-rate-limit)
   - Validate file uploads (size, type)

2. **Storage:**

   - Configure S3 bucket policies
   - Set up lifecycle rules for old videos
   - Generate thumbnails

3. **Queue:**

   - Scale Redis for production
   - Monitor queue length
   - Add failure alerting

4. **Database:**

   - Run migrations (not `db:push`)
   - Set up backups
   - Add indexes for performance

5. **AI Provider:**
   - Implement real pose estimation (MediaPipe)
   - Add OpenAI integration for coaching
   - Cache expensive computations

## License

MIT
