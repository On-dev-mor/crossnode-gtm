import type { GTMOSConfig } from '../config/types'

/** Unipile `from` line from ~/.gtm-os/config.yaml email.* fields. */
export function resolveEmailFrom(
  config: GTMOSConfig,
  fallbackMailbox?: string,
): { display_name: string; identifier: string } | undefined {
  const displayName = config.email?.from_display_name?.trim()
  const identifier = (config.email?.from_identifier ?? fallbackMailbox)?.trim()
  if (!identifier || !displayName) return undefined
  return { display_name: displayName, identifier }
}
