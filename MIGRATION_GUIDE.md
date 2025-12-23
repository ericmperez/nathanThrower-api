# Database Migration Guide

## Current Status

The application currently uses `prisma db push` for schema changes. For production, you should use Prisma Migrations which provide:
- Version control for schema changes
- Safe, reversible migrations
- Team collaboration
- Production-safe deployments

## Switching to Migrations

### Step 1: Create Initial Migration (Baseline)

If your database already exists (from `db:push`), create a baseline migration:

```bash
cd apps/api

# This creates a migration that matches your current database state
npx prisma migrate dev --name init --create-only

# Review the generated migration file in prisma/migrations/
# If it looks correct, apply it:
npx prisma migrate resolve --applied init
```

**Note:** If you're starting fresh, use:
```bash
npx prisma migrate dev --name init
```

### Step 2: Update Deployment Process

Replace `npm run db:push` with `npm run db:migrate` in your deployment pipeline.

**Before (development):**
```bash
npm run db:push  # ❌ Not for production
```

**After (development):**
```bash
npm run db:migrate  # ✅ Creates a new migration
```

**Production deployment:**
```bash
npx prisma migrate deploy  # ✅ Applies pending migrations
```

### Step 3: Update Package.json Scripts

Add a production migration script:

```json
{
  "scripts": {
    "db:migrate:deploy": "prisma migrate deploy"
  }
}
```

### Step 4: Update Render.yaml / Deployment Config

In `render.yaml` or your deployment config, update the build command:

```yaml
buildCommand: npm install && npx prisma generate && npm run build
startCommand: npm run db:migrate:deploy && npm run start
```

Or use a separate migration step before starting the server.

## Going Forward

### For Schema Changes:

1. **Modify `schema.prisma`**
2. **Create migration:**
   ```bash
   npm run db:migrate -- --name describe-your-change
   ```
3. **Review the migration file** in `prisma/migrations/`
4. **Test locally** - migrations are automatically applied in dev mode
5. **Commit** the migration file with your code
6. **Deploy** - migrations are automatically applied on production startup

### Important Notes:

- ✅ **Always commit migration files** to version control
- ✅ **Never edit existing migration files** - create new ones instead
- ✅ **Test migrations** on a copy of production data before deploying
- ✅ **Back up your database** before running migrations in production
- ❌ **Don't use `db:push` in production** - it's destructive and not versioned

## Troubleshooting

### Migration conflicts:
If you have schema drift, use `prisma migrate reset` (⚠️ **deletes all data**) or manually reconcile differences.

### Failed migrations:
Use `prisma migrate resolve --rolled-back <migration_name>` to mark a failed migration as rolled back, then fix and retry.

### Database already migrated:
If your database is already up-to-date, use `prisma migrate resolve --applied <migration_name>` to mark migrations as applied without running them.

