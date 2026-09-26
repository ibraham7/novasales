import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyPermissions } from "@/modules/identity";

export function useMyPermissions() {
  const fn = useServerFn(getMyPermissions);
  return useQuery({
    queryKey: ["my-permissions"],
    queryFn: () => fn(),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

export function usePermission(key: string): boolean {
  const q = useMyPermissions();
  return (q.data ?? []).includes(key);
}
