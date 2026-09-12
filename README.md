# MaiaekHub

Internal Product & Pricing Management + Price Request Tracking.

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Stack
Next.js App Router, Supabase Auth/Postgres, Vercel API routes, Sentry, Stripe, Resend.

## Database
Run `supabase/migrations/001_initial.sql` in Supabase SQL Editor.

## Production checklist
- Configure Supabase Auth redirect URLs.
- Set all environment variables in Vercel.
- Configure Stripe webhook to `/api/stripe/webhook`.
- Configure Sentry DSN and source maps.
- Configure Resend verified sender domain.
