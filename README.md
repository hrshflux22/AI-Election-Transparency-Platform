
  # AI Election Transparency Platform

  This is a code bundle for AI Election Transparency Platform. The original project is available at https://www.figma.com/design/QXVjKQ5hSKJ7vqE2Z3oLzQ/AI-Election-Transparency-Platform.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.

  The app uses the Next.js 15 App Router. Copy `.env.local.example` to
  `.env.local` to enable Neon/Drizzle persistence and Google Vision OCR.
  Without those variables, database endpoints return HTTP 503 and the UI
  continues to use its verified demo data.

  Use `npm run db:push` to apply the Drizzle schema and `npm run db:seed` to
  load the demo candidates.
  