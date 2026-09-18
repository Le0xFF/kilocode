import type { ProviderUsage } from "@opencode-ai/schema/kilocode/provider-usage"

// The online Kilo coding-plan/BYOK fetchers (and their response shapes) were
// removed with @kilocode/kilo-gateway. Neutralized to no-op async stubs so the
// managed adapter keeps compiling; it always resolves to empty state and the
// provider-usage surface degrades to "no sources".
export async function fetchByokEntries(_token: string): Promise<unknown[]> {
  return []
}
export async function fetchCodingPlanSubscriptions(_token: string): Promise<unknown[]> {
  return []
}
export async function fetchCodingPlanUsage(
  _token: string,
  _subscriptionId: string,
): Promise<{ subscription: any; fetchedAt: string }> {
  return { subscription: {}, fetchedAt: "" }
}

type CodingPlanSubscription = any
type ByokEntry = any
type CodingPlanQuotaWindow = any

export interface CloudState {
  plans: Result<CodingPlanSubscription[]>
  byok: Result<ByokEntry[]>
}

type Result<T> = { ok: true; value: T } | { ok: false }

const safe = async <T>(promise: Promise<T>): Promise<Result<T>> =>
  promise.then(
    (value) => ({ ok: true, value }),
    () => ({ ok: false }),
  )

export async function load(
  token: string,
  transport: {
    plans: typeof fetchCodingPlanSubscriptions
    byok: typeof fetchByokEntries
  } = { plans: fetchCodingPlanSubscriptions, byok: fetchByokEntries },
): Promise<CloudState> {
  const [plans, byok] = await Promise.all([safe(transport.plans(token)), safe(transport.byok(token))])
  return { plans, byok }
}

const error = (code: string, message: string) => ({ code, message, retryable: true })

function installed(subscription: CodingPlanSubscription, state: Result<ByokEntry[]>) {
  if (!state.ok || !subscription.canQueryUsage || !subscription.hasInstalledByokKey) return false
  return state.value.some(
    (item) =>
      item.provider_id === subscription.providerId && item.management_source === "coding_plan" && item.is_enabled,
  )
}

export function plans(state: CloudState) {
  if (!state.plans.ok) return []
  return state.plans.value
    .filter((item) => (item.status === "active" || item.status === "past_due") && installed(item, state.byok))
    .sort((a, b) => a.id.localeCompare(b.id))
}

function durationMs(period: CodingPlanQuotaWindow["period"]) {
  const multipliers = {
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  } as const
  if (period.unit === "month") return undefined
  return period.value * multipliers[period.unit as keyof typeof multipliers]
}

function window(subscriptionId: string, value: CodingPlanQuotaWindow): ProviderUsage.UsageWindow {
  const remaining = value.remainingPercent
  const duration = durationMs(value.period)
  return {
    id: `${subscriptionId}:${value.id}`,
    resource: "subscription",
    unit: "percent",
    orientation: "remaining_percent",
    used: Math.max(0, 100 - remaining),
    remaining,
    limit: 100,
    period: value.period,
    ...(duration !== undefined ? { durationMs: duration } : {}),
    resetAt: value.resetsAt,
    state: remaining <= 0 ? "exhausted" : "active",
  }
}

export async function managed(
  token: string,
  subscription: CodingPlanSubscription,
  usage: typeof fetchCodingPlanUsage = fetchCodingPlanUsage,
): Promise<ProviderUsage.UsageSnapshot> {
  const fetchedAt = new Date().toISOString()
  const planState = subscription.cancelAtPeriodEnd
    ? "canceling"
    : subscription.status === "past_due"
      ? "past_due"
      : "active"
  const id = `kilo-managed:${subscription.id}`

  return usage(token, subscription.id)
    .then((usage) => {
      const windows = usage.subscription.windows.map((item: any) => window(usage.subscription.id, item))
      return {
        id,
        providerID: usage.subscription.providerId,
        sourceKind: "kilo_managed",
        providerLabel: usage.subscription.providerName,
        planLabel: usage.subscription.planName,
        sourceLabel: "via Kilo",
        fetchState: "ready",
        planState,
        routingState: "active",
        fetchedAt: usage.fetchedAt,
        windows,
      } satisfies ProviderUsage.UsageSnapshot
    })
    .catch(() => ({
      id,
      providerID: subscription.providerId,
      sourceKind: "kilo_managed",
      providerLabel: subscription.providerName,
      planLabel: subscription.planName,
      sourceLabel: "via Kilo",
      fetchState: "unavailable",
      planState,
      routingState: "active",
      fetchedAt,
      windows: [],
      error: error("managed_subscription_unavailable", "Usage unavailable."),
    }))
}
