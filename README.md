# AI Election Transparency Platform

An AI-powered web platform that makes election candidate information transparent and easy to understand for voters. It ingests candidate affidavit data, scores candidates on credibility and financial transparency, and presents everything through an intuitive dashboard — including candidate profiles, side-by-side comparisons, data insights, and an AI chatbot.

Built with the **Next.js 15 App Router** and **React 18**.

## Features

- **Candidate Directory** — Browse and search candidates across constituencies and states, with filters for no criminal cases, high assets, and experience.
- **Candidate Profiles** — Detailed affidavits: criminal cases, assets, liabilities, education, age, and experience, plus AI-derived credibility, criminal-risk, financial-transparency, and performance scores.
- **Comparison** — Put candidates side by side to make informed decisions.
- **Insights** — Aggregated charts and analytics (top offenders, wealth distribution, criminal cases by party/constituency, etc.).
- **AI Chatbot** — Ask questions about candidates and get plain-language answers.
- **Affidavit OCR** — Upload a candidate's affidavit PDF; a vision LLM (OpenRouter Qwen3-VL) reads it page by page and returns the Form 26 fields as structured JSON, cross-validated against the candidate record. If OpenRouter is not configured, the endpoint falls back to OCR (Baidu Cloud, self-hosted Unlimited-OCR, Google Cloud Vision + Tesseract).

## Tech Stack

| Area          | Technology                                                              |
| ------------- | ----------------------------------------------------------------------- |
| Framework     | Next.js 15 (App Router), React 18, TypeScript                           |
| UI            | Material UI (MUI), Tailwind CSS 4, shadcn/ui (Radix), Framer Motion     |
| Charts        | Recharts                                                                 |
| Database      | PostgreSQL via Neon + Drizzle ORM                                       |
| OCR           | OpenRouter (Qwen3-VL), Google Gemini, Baidu Cloud Unlimited-OCR API, Baidu Unlimited-OCR (self-hosted), Google Cloud Vision, Tesseract.js, pdf.js, pdf-parse |
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
| `GEMINI_API_KEY`                | Google Gemini key for structured Form 26 extraction (bulk pipeline) | Optional |
| `GEMINI_OCR_MODEL`              | Gemini model (default `gemini-3-flash-preview`)      | Optional |
| `OPENROUTER_API_KEY`            | OpenRouter key used by both the upload endpoint and the bulk pipeline | Optional |
| `OPENROUTER_OCR_MODEL`          | OpenRouter model (default `qwen/qwen3-vl-32b-instruct`) | Optional |
| `GOOGLE_CLOUD_PROJECT`          | Google Cloud project ID for Vision OCR               | Optional |
| `GOOGLE_APPLICATION_CREDENTIALS`| Path to your Google Cloud service-account JSON       | Optional |
| `UNLIMITED_OCR_URL`             | Base URL of a self-hosted Baidu Unlimited-OCR server (OpenAI-compatible SGLang/vLLM) | Optional |
| `UNLIMITED_OCR_BACKEND`         | `sglang` or `vllm` (defaults to `vllm`)            | Optional |
| `UNLIMITED_OCR_MODEL`           | Model name served by the server (default `Unlimited-OCR`) | Optional |
| `BAIDU_API_KEY` / `BAIDU_SECRET_KEY` | Baidu Cloud OCR credentials for the fully managed Unlimited-OCR API | Optional |

> The app works out of the box with a bundled verified demo dataset. The database and OCR integrations are **optional** — without their environment variables, database-backed API endpoints return `HTTP 503` and the UI gracefully falls back to the demo data.
>
> There are two OCR paths:
>
> - **Upload endpoint** (`app/api/ocr`, used by the UI): **OpenRouter Qwen3-VL → Baidu Cloud (managed) → self-hosted Unlimited-OCR → Google Vision / pdf-text**. The Qwen step applies to PDFs and needs `OPENROUTER_API_KEY` plus prepaid OpenRouter credits; images still use the OCR providers below.
> - **Bulk pipeline** (`npm run db:ocr`, structured Form 26 JSON): **OpenRouter → Gemini → Baidu → self-hosted Unlimited-OCR → Tesseract**, selected automatically from which keys are set.
>
> Both paths store the same row shape: `_source`, `_model`, token counts, and `_estimatedCostUsd` sit in `parsedData` as `_`-prefixed meta keys alongside the Form 26 fields.

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

To run the bulk OCR pipeline that reads all candidate affidavit PDFs, extracts their Form 26 fields, matches them to candidates in the database, and stores scan records:

```bash
npm run db:ocr
```

`--engine` selects the extraction engine:

| Engine       | What it does                                                                 | Cost                                     |
| ------------ | ---------------------------------------------------------------------------- | ---------------------------------------- |
| `openrouter` | A vision LLM (default Qwen3-VL-32B) reads the whole PDF and returns Form 26 fields as JSON | ~$0.002/document; use a model ending in `:free` for the free tier |
| `gemini`     | Gemini reads the whole PDF with structured output                            | Free tier, quota-limited                 |
| `baidu`      | Managed Baidu Cloud Unlimited-OCR API (text OCR)                             | Free tier: 200–1000 pages                |
| `unlimited`  | Self-hosted Baidu Unlimited-OCR (SGLang/vLLM)                                | Your GPU                                 |
| `tesseract`  | Local Tesseract.js fallback                                                  | Free                                     |

With no `--engine` the pipeline picks the first configured engine in that order. `openrouter` and `gemini` store the structured extraction directly (only these report key-field coverage); the others store OCR text that is then parsed with regexes.

Useful options:

```bash
npm run db:ocr -- --engine=openrouter --limit=20 --state=Delhi --budget-cap=0.50 --concurrency=4
```

| Flag                      | Effect                                                              |
| ------------------------- | ------------------------------------------------------------------- |
| `--engine=<name>`         | Select the extraction engine (table above)                          |
| `--limit=N`, `--state=X`  | Cap the queue / restrict to one state folder                        |
| `--force`                 | Re-scan files that already have a scan from this engine             |
| `--replace`               | Hard-delete existing rows for a file before inserting               |
| `--budget-cap=<usd>`      | Hard-stop before projected OpenRouter spend passes this amount      |
| `--concurrency=N`         | Parallel workers (default 4)                                        |
| `--keep-pan`              | Keep the PAN field (redaction is on by default)                     |
| `--max-pages=N`, `--scale=X` | Pages rendered / render scale for page-image engines            |
| `--verbose`               | Print every retry                                                   |

A VLM engine only skips files **it** has already read, so `--engine=openrouter` re-reads anything last processed by Tesseract or Gemini instead of inheriting those rows. PDFs whose filename matches no candidate in the database fail with `no DB match` and are listed at the end of the run.

### Comparing engines and diagnosing a bad extraction

```bash
npm run db:ocr:shootout -- --file=Delhi/Adv. Krupal.pdf   # try several Gemini models on one PDF
npm run db:ocr:compare                                     # field-by-field agreement across stored engines
npm run db:ocr:inspect -- "A. Gopala Krishna.pdf"          # dump the newest stored scan for a file
npm run db:ocr:probe -- "A. Gopala Krishna.pdf" qwen/qwen3-vl-32b-instruct 4   # raw model response, no DB write
```

### Interesting: use the managed Baidu Cloud API

The exact Unlimited-OCR model is hosted on Baidu Cloud — no GPU, no Python server. Sign up at [Baidu Cloud](https://cloud.baidu.com/product/ocr), create an OCR application, then set:

```
BAIDU_API_KEY=your-api-key
BAIDU_SECRET_KEY=your-secret-key
```

Free tier: 200 pages (personal) / 1000 pages (business verification). This works on any machine — the bulk pipeline becomes simply:

```bash
npm run db:ocr -- --engine=baidu
```

### Running self-hosted Baidu Unlimited-OCR (optional)

**Local GPU or cloud GPU required.** Open [`colab/Unlimited-OCR-server.ipynb`](./colab/Unlimited-OCR-server.ipynb) in Google Colab (free T4 GPU), run all cells, and copy the printed tunnel URL into `.env.local`.

```bash
# SGLang (omit --attention-backend on T4/Ampere GPUs; SGLang picks the right one)
python -m sglang.launch_server \
  --model baidu/Unlimited-OCR \
  --served-model-name Unlimited-OCR \
  --page-size 1 --mem-fraction-static 0.8 \
  --context-length 32768 --enable-custom-logit-processor \
  --host 0.0.0.0 --port 10000
```

```bash
# vLLM (also set UNLIMITED_OCR_BACKEND=vllm)
docker run --rm --gpus all --network host --ipc host \
  vllm/vllm-openai:unlimited-ocr \
  baidu/Unlimited-OCR --trust-remote-code \
  --logits_processors vllm.model_executor.models.unlimited_ocr:NGramPerReqLogitsProcessor \
  --no-enable-prefix-caching --mm-processor-cache-gb 0
```

Single-image requests use the `gundam` mode (`image_size=640`); multi-page/PDF requests use `base` mode (`image_size=1024`).

## Available Scripts

| Script         | Description                                                       |
| -------------- | ----------------------------------------------------------------- |
| `npm run dev`  | Start the Next.js development server                              |
| `npm run build`| Create a production build                                         |
| `npm run start`| Start the production server (after `build`)                       |
| `npm run db:push` | Apply the Drizzle schema to the database                     |
| `npm run db:seed` | Load demo candidates from the Excel source into the database  |
| `npm run db:ocr`  | Run the bulk affidavit OCR pipeline                          |
| `npm run db:ocr:shootout` | Compare Gemini models on one affidavit PDF            |
| `npm run db:ocr:compare`   | Field-by-field agreement report across stored scans  |
| `npm run db:ocr:inspect`   | Dump the newest stored scan for a filename           |
| `npm run db:ocr:probe`     | Print a raw model response for one PDF (no DB write) |
| `npm run test`       | Run the OCR extraction unit tests (`src/lib/ocr/vlm.test.ts`) |

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
│       ├── ocrBulk.ts      # Bulk pipeline: queue, candidate matching, storage
│       ├── ocrCompare.ts   # Cross-engine field agreement report
│       ├── ocrShootout.ts  # Gemini model shootout on one PDF
│       ├── ocrProbe.ts     # Raw model response for one PDF (no DB write)
│       ├── ocrInspect.ts   # Dump the newest stored scan for a file
│       └── ocr/            # Extraction engines + shared layer
│           ├── vlm.ts      # Engine interface, Form 26 prompt/schema, JSON repair, tests
│           ├── gemini.ts   # Gemini engine (whole-PDF structured output)
│           ├── openrouter.ts # OpenRouter vision-LLM engine
│           ├── baidu.ts    # Managed Baidu Cloud OCR client
│           ├── unlimited.ts # Self-hosted Unlimited-OCR client
│           ├── service.ts  # Extraction chain used by the upload endpoint
│           ├── parser.ts   # Regex parser for OCR text
│           ├── pdf.ts      # PDF page rendering
│           └── privacy.ts  # PAN / PII redaction
├── guidelines/             # Project guidelines
├── colab/                  # Google Colab notebook for running Unlimited-OCR on a free GPU
├── Candidate Affidavits/   # Raw affidavit source data (Excel)
├── drizzle.config.ts       # Drizzle Kit configuration
└── .env.local.example      # Example environment variables
```

## Design Reference

The original UI design for this platform is available on Figma:
[Ai Election Transparency Platform (Figma)](https://www.figma.com/design/QXVjKQ5hSKJ7vqE2Z3oLzQ/AI-Election-Transparency-Platform)

## License

Private / educational project. See [ATTRIBUTIONS.md](./ATTRIBUTIONS.md) for third-party attributions.
