# Incentive OS POC

A Next.js 14 application for managing retail employee incentive programs. Migrated from Vercel to Replit.

## Architecture

- **Framework**: Next.js 14 (App Router) with TypeScript
- **Styling**: Tailwind CSS
- **ORM**: Prisma with PostgreSQL
- **Package Manager**: npm

## Project Structure

```
src/
  app/          # Next.js App Router pages and API routes
  components/   # Shared React components
  lib/          # Utility functions and shared logic
  server/       # Server-side services and calculations
prisma/
  schema.prisma # Database schema
  seed.ts       # Database seed script
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (required) |

## Running the App

The app starts via the "Start application" workflow, which runs `npm run dev` on port 5000.

## Database Setup

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Seed the database
npm run db:seed
```

## Key Features

- Incentive plan management
- Target tracking for stores and employees
- Campaign configuration
- Sales transaction processing
- Approval workflows
- Audit logging
