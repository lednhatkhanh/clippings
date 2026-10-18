import { getAuth } from "@/lib/auth/auth.ts";

export function GET(request: Request) {
  return getAuth().handler(request);
}

export function POST(request: Request) {
  return getAuth().handler(request);
}
