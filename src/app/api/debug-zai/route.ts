/**
 * GET /api/debug-zai
 *
 * Temporary debug endpoint to verify ZAI env vars are reaching the
 * Vercel serverless runtime. Safe to call publicly — only reports
 * presence/length, never the actual secret values.
 *
 * Delete this file once the math solver is working in production.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const vars = ["ZAI_BASE_URL", "ZAI_API_KEY", "ZAI_TOKEN", "ZAI_USER_ID", "ZAI_CHAT_ID"];

  const status = vars.map((name) => {
    const value = process.env[name];
    return {
      name,
      present: Boolean(value),
      length: value ? value.length : 0,
      preview: value ? `${value.slice(0, 8)}...${value.slice(-4)}` : null,
    };
  });

  const allPresent = vars.every((v) => Boolean(process.env[v]));

  return NextResponse.json(
    {
      ok: allPresent,
      message: allPresent
        ? "All ZAI env vars present — math solver should work."
        : "Some ZAI env vars missing — check Vercel project settings.",
      variables: status,
      timestamp: new Date().toISOString(),
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV ?? "not-on-vercel",
    },
    { status: allPresent ? 200 : 500 }
  );
}
