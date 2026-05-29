import { NextResponse } from 'next/server';
const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:7410';

export async function POST(req: Request) {
  const body = await req.text();
  const target = new URL(req.url).searchParams.get('path') || '/';
  const res = await fetch(`${BASE}${target}`, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
  return new NextResponse(await res.text(), { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'application/json' } });
}
