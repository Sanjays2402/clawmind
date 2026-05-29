import { NextResponse } from 'next/server';
const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:7410';
export async function GET() {
  try {
    const res = await fetch(`${BASE}/health`, { cache: 'no-store' });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 503 });
  }
}
