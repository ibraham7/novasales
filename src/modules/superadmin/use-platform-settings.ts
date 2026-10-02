import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicPlatformSettings } from "./settings.functions";
import { DEFAULT_PLATFORM_SETTINGS } from "./platform-settings";
export function usePlatformSettings() {
  const load = useServerFn(getPublicPlatformSettings);
  const query = useQuery({ queryKey: ["public-platform-settings"], queryFn: () => load(), staleTime: 60_000 });
  return query.data ?? DEFAULT_PLATFORM_SETTINGS;
}
