import "server-only";

import type { NextRequest } from "next/server";

import { getUser, type User } from "@/lib/auth";

export function getRequestUser(request: NextRequest): Promise<User | null> {
  return getUser(request.headers, (name) => request.cookies.get(name)?.value);
}
