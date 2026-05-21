export interface NotionConfig {
  campaigns_ds: string
  /** Raw scraped leads (Skool, engagers, CSV) — no lifecycle. */
  leads_ds: string
  /** Qualified prospects + outreach lifecycle (sync, campaigns). */
  prospects_ds: string
  variants_ds: string
  parent_page: string
}

export interface UnipileConfig {
  daily_connect_limit: number
  sequence_timing: {
    connect_to_dm1_days: number
    dm1_to_dm2_days: number
  }
  rate_limit_ms: number
  /** Unipile account id for Gmail/Outlook/IMAP outreach (distinct from LinkedIn). */
  email_account_id?: string
}

export interface LinkedInConfig {
  /** Provider id resolved against the registry for any `linkedin_send` step. */
  provider: string
}

export interface EmailConfig {
  /** Provider id resolved against the registry for any `email_send` step. */
  provider: string
  /** Shown in the recipient's inbox (Unipile `from.display_name`). */
  from_display_name?: string
  /** Mailbox address for `from.identifier`; defaults to the connected account email. */
  from_identifier?: string
}

export interface QualificationConfig {
  rules_path: string
  exclusion_path: string
  disqualifiers_path: string
  cache_ttl_days: number
}

export interface CrustdataConfig {
  max_results_per_query: number
}

export interface FullEnrichConfig {
  poll_interval_ms: number
  poll_timeout_ms: number
}

export interface SlackConfig {
  webhook_url: string
  notify_on: string[] // ['reply', 'demo_booked', 'deal_created', 'winner_declared', 'campaign_completed']
}

export interface GTMOSConfig {
  notion: NotionConfig
  unipile: UnipileConfig
  qualification: QualificationConfig
  crustdata?: CrustdataConfig
  fullenrich?: FullEnrichConfig
  slack?: SlackConfig
  /** Outbound email channel selection (registry provider id). */
  email?: EmailConfig
  /** Outbound LinkedIn channel selection (registry provider id). */
  linkedin?: LinkedInConfig
}
