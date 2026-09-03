# AI Election Transparency Platform

An AI-powered web platform that makes election candidate information transparent and easy to understand for voters. It ingests candidate affidavit data, scores candidates on credibility and financial transparency, and presents everything through an intuitive dashboard — including candidate profiles, side-by-side comparisons, data insights, and an AI chatbot.

Built with the **Next.js 15 App Router** and **React 18**.

## Features

- **Candidate Directory** — Browse and search candidates across constituencies and states, with filters for no criminal cases, high assets, and experience.
- **Candidate Profiles** — Detailed affidavits: criminal cases, assets, liabilities, education, age, and experience, plus AI-derived credibility, criminal-risk, financial-transparency, and performance scores.
- **Comparison** — Put candidates side by side to make informed decisions.
- **Insights** — Aggregated charts and analytics (top offenders, wealth distribution, criminal cases by party/constituency, etc.).
- **AI Chatbot** — Ask questions about candidates and get plain-language answers.
- **Affidavit OCR** — Upload a candidate's affidavit PDF; the platform extracts and cross-validates the text automatically using OCR (Google Cloud Vision + Tesseract).

## Tech Stack

| Area          | Technology                                                              |
| ------------- | ----------------------------------------------------------------------- |
| Framework     | Next.js 15 (App Router), React 18, TypeScript                           |
| UI            | Material UI (MUI), Tailwind CSS 4, shadcn/ui (Radix), Framer Motion     |
| Charts        | Recharts                                                                 |
| Database      | PostgreSQL via Neon + Drizzle ORM                                       |
| OCR           | Google Cloud Vision, Tesseract.js, pdf.js, pdf-parse                     |
| Other         | Canvas, xlsx (Excel parsing), date-fns, react-hook-form                 |

## Getting Started

### Prerequisites

- Node.js (18+ recommended)
- npm (or pnpm/yarn)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example env file and fill in the values:

```bash
cp .env.local.example .env.local
```

| Variable                        | Purpose                                              | Required |
| ------------------------------- | ---------------------------------------------------- | -------- |
| `DATABASE_URL`                  | PostgreSQL (Neon) connection string for persistence  | Optional |
| `GOOGLE_CLOUD_PROJECT`          | Google Cloud project ID for Vision OCR               | Optional |
| `GOOGLE_APPLICATION_CREDENTIALS`| Path to your Google Cloud service-account JSON       | Optional |

> The app works out of the box with a bundled verified demo dataset. The database and OCR integrations are **optional** — without their environment variables, database-backed API endpoints return `HTTP 503` and the UI gracefully falls back to the demo data.

### 3. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the app.

### 4. (Optional) Set up the database

Apply the Drizzle schema and load demo candidates from the provided Excel data:

```bash
npm run db:push    # apply the schema
npm run db:seed    # load candidates from the Excel source
```

## Database & OCR

To run the bulk OCR pipeline that reads all candidate affidavit PDFs, extracts their text, matches them to candidates in the database, and stores cross-validated scan records:

```bash
npm run db:ocr
```

Useful options:

```bash
npm run db:ocr -- --limit=20 --state=Delhi --ocr-pages=3
```

## Available Scripts

| Script         | Description                                                       |
| -------------- | ----------------------------------------------------------------- |
| `npm run dev`  | Start the Next.js development server                              |
| `npm run build`| Create a production build                                         |
| `npm run start`| Start the production server (after `build`)                       |
| `npm run db:push` | Apply the Drizzle schema to the database                     |
| `npm run db:seed` | Load demo candidates from the Excel source into the database  |
| `npm run db:ocr`  | Run the bulk affidavit OCR pipeline                          |

## Project Structure

```
├── app/                    # Next.js App Router (routes + API endpoints)
│   ├── page.tsx            # Home page
│   ├── candidate/          # Candidate profile pages
│   ├── chat/               # AI chatbot page
│   ├── compare/            # Candidate comparison page
│   ├── insights/           # Insights / analytics page
│   └── api/                # API routes (candidates, constituencies, insights, ocr)
├── src/
│   ├── app/
│   │   ├── components/     # Reusable React components (UI + feature)
│   │   ├── data/           # Mock / demo data
│   │   └── pages/          # Feature page implementations
│   └── lib/
│       ├── db.ts           # Database client (Drizzle + Neon)
│       ├── schema.ts       # Drizzle table definitions
│       ├── seed.ts         # Database seeding script
│       ├── parseCandidates.ts # Excel → candidate data parser
│       └── ocr/            # OCR pipeline (service + parser)
├── guidelines/             # Project guidelines
├── Candidate Affidavits/   # Raw affidavit source data (Excel)
├── drizzle.config.ts       # Drizzle Kit configuration
└── .env.local.example      # Example environment variables
```

## Design Reference

The original UI design for this platform is available on Figma:
[Ai Election Transparency Platform (Figma)](https://www.figma.com/design/QXVjKQ5hSKJ7vqE2Z3oLzQ/AI-Election-Transparency-Platform)

## License

Private / educational project. See [ATTRIBUTIONS.md](./ATTRIBUTIONS.md) for third-party attributions.
