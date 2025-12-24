# Troubleshooting 500 Error in Production

## Common Causes of 500 Errors During Login

### 1. Missing JWT_SECRET
**Symptom:** 500 error when trying to login
**Check:** Verify `JWT_SECRET` is set in production environment variables
**Fix:** Set a strong JWT_SECRET (32+ characters):
```bash
# Generate a secure secret
openssl rand -base64 32

# Set in Railway/Render environment variables
JWT_SECRET=<generated-secret>
```

### 2. Database Connection Issues
**Symptom:** 500 error, database queries failing
**Check:** Verify `DATABASE_URL` is set correctly in production
**Fix:** 
- Check Railway/Render database connection string
- Ensure database is accessible from API server
- Verify SSL mode is correct (`?sslmode=require`)

### 3. Prisma Client Not Generated
**Symptom:** 500 error with "PrismaClient" errors
**Check:** Verify Prisma client is generated in production build
**Fix:** Ensure build command includes `npx prisma generate`:
```json
"build": "prisma generate && tsc"
```

### 4. Missing Environment Variables
**Symptom:** 500 error, undefined variable errors
**Check:** Verify all required environment variables are set:
- `DATABASE_URL`
- `JWT_SECRET`
- `NODE_ENV=production`
- `ALLOWED_ORIGINS` (for CORS)

### 5. Database Migrations Not Applied
**Symptom:** 500 error when querying new fields (firstName, lastName, etc.)
**Check:** Verify migrations are applied in production
**Fix:** Ensure start command includes migration:
```json
"startCommand": "npm run db:migrate:deploy && npm run start"
```

## How to Debug

### Check Railway/Render Logs
1. Go to your Railway/Render dashboard
2. Navigate to your API service
3. Check the "Logs" tab
4. Look for error messages around the time of the 500 error

### Test API Directly
```bash
# Test login endpoint
curl -X POST https://your-api-url.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"nathan@nathanthrower.com","password":"your-password"}'
```

### Check Environment Variables
In Railway/Render:
1. Go to your API service
2. Navigate to "Variables" or "Environment"
3. Verify all required variables are set

## Quick Fix Checklist

- [ ] `JWT_SECRET` is set (32+ characters)
- [ ] `DATABASE_URL` is set and correct
- [ ] `NODE_ENV=production` is set
- [ ] Database migrations are applied (`db:migrate:deploy`)
- [ ] Prisma client is generated (`prisma generate`)
- [ ] API server can connect to database
- [ ] CORS is configured (`ALLOWED_ORIGINS`)

