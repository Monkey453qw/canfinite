# Canfinite

> A premium infinite whiteboard with ultra-smooth inking and AI-powered problem solving.

Canfinite is a browser-based infinite canvas where you can sketch, write, and solve. Draw freehand with a pressure-sensitive pen, drop text notes anywhere on the infinite plane, and solve handwritten or typed math expressions in-place using an AI-powered solver. Your work auto-saves locally and restores on the next session — no account required.

Built as a Progressive Web App (PWA), Canfinite can be installed on desktop and mobile for an app-like experience.

---

## ✨ Features

- **Infinite canvas** — pan and zoom across an unbounded 2D workspace; never run out of room.
- **Smooth inking** — pressure-aware freehand strokes with a configurable pen (size, opacity, color via a hue wheel).
- **Eraser & selection** — erase strokes or select, move, and transform existing objects.
- **Text notes** — drop rich text anywhere on the canvas with an inline editor overlay.
- **AI math solver** — write or type a math expression and get an instant answer with step-by-step reasoning. Accepts both **handwritten input** (via image / OCR) and **typed expressions**.
- **Auto-save & session restore** — your canvas is debounced-saved to local persistence and rehydrated on the next visit.
- **Dark mode** — follows the system color scheme on first load, then respects your manual toggle.
- **PWA installable** — add to home screen on mobile or install on desktop for a standalone app experience.
- **Boot animation** — a brief branded launch sequence on first load.

## 🧰 Tech Stack

| Layer | Technology |
|------|------------|
| Framework | [Next.js 16](https://nextjs.org/) (App Router, standalone output) |
| Language | [TypeScript 5](https://www.typescriptlang.org/) |
| UI | [React 19](https://react.dev/), [Tailwind CSS 4](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/) |
| State | [Zustand](https://github.com/pmndrs/zustand) |
| Database | [Prisma ORM](https://www.prisma.io/) with SQLite |
| AI | [z-ai-web-dev-sdk](https://www.npmjs.com/package/z-ai-web-dev-sdk) for math solving |
| Drag & Resize | [@dnd-kit](https://dndkit.com/), [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) |
| Charts | [Recharts](https://recharts.org/) |
| Forms | [React Hook Form](https://react-hook-form.com/) + [Zod](https://zod.dev/) |
| PWA | Web App Manifest + custom service worker |

## 🚀 Getting Started

### Prerequisites

- **Node.js 18.18+** (recommended 20+)
- A package manager: `npm`, `pnpm`, `yarn`, or `bun` (the project ships with `bun-types` in devDependencies and is optimized for Bun, but any will work)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Monkey453qw/canfinite.git
cd canfinite

# 2. Install dependencies
npm install        # or: pnpm install / yarn install / bun install

# 3. Set up environment variables
cp .env.example .env   # then edit .env if you need a custom database path
#    The default DATABASE_URL points to a local SQLite file at ./db/custom.db

# 4. Initialize the database
npx prisma db push
npx prisma generate

# 5. Run the development server
npm run dev
```

Open **http://localhost:3000** in your browser. You should see the boot animation, then the empty canvas ready to draw on.

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the dev server on port 3000 (logs to `dev.log`) |
| `npm run build` | Production build (outputs standalone to `.next/standalone/`) |
| `npm run start` | Run the production build |
| `npm run lint` | Run ESLint |
| `npm run db:push` | Push Prisma schema to the database |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:migrate` | Create and apply a new Prisma migration |
| `npm run db:reset` | Reset the database (destroys all data) |

## 📁 Project Structure

```
canfinite/
├── prisma/
│   └── schema.prisma          # Data models (User, Post — extend as needed)
├── public/
│   ├── icons/                 # PWA icons (192 / 512)
│   ├── logo.svg
│   ├── manifest.json          # PWA manifest
│   ├── sw.js                  # Service worker
│   └── robots.txt
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Root layout
│   │   ├── page.tsx           # Main page — composes canvas + toolbar + solver
│   │   └── api/
│   │       ├── route.ts       # Health check endpoint
│   │       └── math-solve/
│   │           └── route.ts   # AI math solver (image OCR + expressions)
│   ├── components/
│   │   ├── canvas/
│   │   │   ├── infinite-canvas.tsx     # Core pannable/zoomable canvas
│   │   │   ├── text-editor-overlay.tsx # Inline rich text editor
│   │   │   └── boot-animation.tsx      # Launch animation
│   │   ├── toolbar/
│   │   │   ├── toolbar.tsx             # Top toolbar
│   │   │   ├── pen-panel.tsx           # Pen settings
│   │   │   ├── eraser-panel.tsx        # Eraser settings
│   │   │   ├── text-panel.tsx          # Text settings
│   │   │   ├── hue-wheel-picker.tsx    # Color wheel
│   │   │   ├── selection-actions.tsx   # Selection toolbar
│   │   │   ├── selection-floating-bar.tsx
│   │   │   └── zoom-indicator.tsx
│   │   ├── math/
│   │   │   └── math-solver.tsx         # Math solver UI
│   │   └── ui/                         # shadcn/ui primitives
│   ├── hooks/                          # Custom React hooks
│   ├── lib/
│   │   ├── canvas/                     # Geometry, constants, answer formatting
│   │   ├── persistence/                # Local persistence layer
│   │   ├── store/                      # Zustand stores
│   │   ├── db.ts                       # Prisma client
│   │   └── utils.ts                    # Helpers (cn, etc.)
│   └── ...
├── .env.example                # Template for environment variables (create your own .env)
├── .gitignore
├── components.json             # shadcn/ui config
├── next.config.ts              # standalone output, strict mode off
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

## 🔌 API Reference

### `POST /api/math-solve`

Unified math solver — handles both **handwritten image input** (OCR) and **typed expressions**.

**Request body:**

```jsonc
{
  "image": "data:image/png;base64,...",  // optional — handwritten math
  "expression": "2x + 5 = 13",            // optional — typed math
  "context": "solve for x"                // optional — extra instructions
}
```

**Response:**

```jsonc
{
  "recognized": "2x + 5 = 13",
  "result": "x = 4",
  "steps": ["Subtract 5 from both sides: 2x = 8", "Divide by 2: x = 4"]
}
```

**Implementation notes:**
- A local evaluator handles simple arithmetic instantly (no API call)
- Results are cached for 30 minutes
- Retry with exponential backoff (1s → 3s → 6s) on transient failures
- Rate limited to 20 requests per minute per client

### `GET /api`

Health-check endpoint.

## ⚙️ Environment Variables

| Name | Required | Description |
|------|----------|-------------|
| `DATABASE_URL` | yes | Prisma connection string. Default: `file:./db/custom.db` (local SQLite) |

No other environment variables are required for local development. The z-ai-web-dev-sdk reads its credentials from the runtime environment automatically.

> **Note:** If no `.env.example` exists in the repo, you can create your `.env` from scratch with the line above. The `.env*` pattern is gitignored — your local config will never be committed.

## ☁️ Deployment

Canfinite is configured with `output: "standalone"` in `next.config.ts`, which produces a self-contained production build under `.next/standalone/`. This works on any Node.js-capable host.

### Vercel (recommended for Next.js)

1. Sign up at [vercel.com](https://vercel.com) with your GitHub account
2. **Add New → Project → Import** this repository
3. Vercel auto-detects Next.js — accept the defaults
4. Under **Environment Variables**, add:
   - `DATABASE_URL` — for a quick demo use `file:./tmp/custom.db` (data is ephemeral on serverless). For persistent data, use a hosted Postgres (Vercel Postgres, Neon, Supabase) and update the Prisma `datasource` provider from `sqlite` to `postgresql` accordingly.
5. Click **Deploy** — you'll get a live URL in ~60 seconds. Every future `git push` to `main` auto-redeploys.

### Self-hosted (Docker / VPS)

```bash
npm run build
npm run start    # serves the standalone build
```

Place behind a reverse proxy (Caddy / Nginx) — a sample `Caddyfile` is included in the repo.

## 🤝 Contributing

Contributions are welcome! This is a personal project, but issues and pull requests are appreciated.

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit your changes with a clear message
4. Open a pull request against `main`

Please run `npm run lint` before submitting.

## 📝 License

[MIT](./LICENSE) © 2026 Monkey453qw

## 🙏 Acknowledgements

- [Next.js](https://nextjs.org/) — the React framework
- [shadcn/ui](https://ui.shadcn.com/) — beautiful, accessible component library
- [Zustand](https://github.com/pmndrs/zustand) — lightweight state management
- [Prisma](https://www.prisma.io/) — type-safe database ORM
- [z-ai-web-dev-sdk](https://www.npmjs.com/package/z-ai-web-dev-sdk) — AI math solving
- [Tailwind CSS](https://tailwindcss.com/) — utility-first styling
