"use client";

import { useParams } from "next/navigation";

/** Resolves `orgId` when the route is under `/founder/organizations/[orgId]/…`. */
export function useFounderRouteOrgId(): string | undefined {
  const p = useParams();
  const id = p?.orgId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}
