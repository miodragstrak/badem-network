import { humanize, processLabel } from './forms.js'

export const PUBLIC_DATA_STATUS = 'PUBLIC_DATA_ONLY'
export const PUBLIC_DATA_DISCLAIMER =
  'Potential fit based on public data. Production capability has not been verified.'

export function publicWebsite(value) {
  if (typeof value !== 'string' || value.length > 2048 || value.includes('\\') ||
      [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return null
  const text = value.trim()
  if (!/^https?:\/\/[^/]/i.test(text) || /\s/.test(text)) return null
  try {
    const url = new URL(text)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname ||
        /^\.+$/.test(url.hostname) || url.username || url.password) return null
    return { href: url.href, label: url.hostname }
  } catch {
    return null
  }
}

export function publicPhone(value) {
  // Consume the backend's normalized value unchanged; do not guess a dialing prefix.
  return typeof value === 'string' && !/\s/.test(value) && /^\+?[0-9]{3,15}$/.test(value)
    ? { href: `tel:${value}`, label: value } : null
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function strings(values) {
  return Array.isArray(values) ? [...new Set(values.map(text).filter(Boolean))] : []
}

const BUSINESS_STATUS = {
  OPERATIONAL: 'Listed operational',
  CLOSED_TEMPORARILY: 'Listed temporarily closed',
  CLOSED_PERMANENTLY: 'Listed permanently closed',
  FUTURE_OPENING: 'Listed as not yet open',
  LISTED_OPERATIONAL: 'Listed operational',
  LISTED_NON_OPERATIONAL: 'Listed non-operational',
}
const LISTING_ACTIVITY = { LIMITED: 'Limited public listing activity', ESTABLISHED: 'Established public listing activity' }

export function publicPartnerDetails(data) {
  const profile = data.partner_profile || {}
  const evidence = profile.enrichment?.public_evidence || {}
  const rating = data.rating ?? profile.rating
  const count = data.review_count ?? profile.review_count
  const status = data.business_status ?? profile.business_status ?? evidence.business_operational_signal
  const activity = evidence.public_activity_signal_strength
  return {
    address: text(data.address ?? profile.address),
    location: text(profile.location_summary),
    website: publicWebsite(data.website ?? profile.website),
    phone: publicPhone(data.phone ?? profile.phone),
    rating: typeof rating === 'number' && Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating : null,
    reviewCount: Number.isSafeInteger(count) && count >= 0 ? count : null,
    businessStatus: typeof status === 'string' && Object.hasOwn(BUSINESS_STATUS, status) ? BUSINESS_STATUS[status] : '',
    ratingPresent: evidence.rating_present === true,
    websitePresent: evidence.website_present === true || profile.signals?.website_signal === true,
    activity: typeof activity === 'string' && Object.hasOwn(LISTING_ACTIVITY, activity) ? LISTING_ACTIVITY[activity] : '',
  }
}

const GENERIC_TYPES = new Set(['manufacturer', 'establishment', 'point_of_interest', 'store'])

export function qualificationEvidence(data) {
  const profile = data.partner_profile || {}
  const signals = profile.signals || {}
  const score = data.score_breakdown || profile.score_breakdown || {}
  const positive = (category) => typeof score[category] === 'number' && Number.isFinite(score[category]) && score[category] > 0
  const capabilities = Array.isArray(profile.inferred_capabilities)
    ? profile.inferred_capabilities.filter((item) => text(item?.capability) && strings(item?.evidence).length) : []
  const rows = []
  if (positive('process_match') && capabilities.length) rows.push({
    label: 'Process', items: capabilities.map((item) => ({
      label: `${processLabel(item.capability)} (public inference)`, evidence: strings(item.evidence),
    })),
  })
  for (const [category, label, field] of [
    ['material_signal', 'Material', 'material_signals'],
    ['equipment_signal', 'Equipment', 'equipment_signals'],
  ]) {
    const values = strings(signals[field])
    if (positive(category) && values.length) rows.push({ label, items: values.map((value) => ({ label: humanize(value), evidence: [] })) })
  }
  if (positive('business_specialization')) {
    const specific = strings(signals.specialization_signals).filter((value) => !GENERIC_TYPES.has(value.toLowerCase()))
    const values = specific.length ? specific.map(processLabel) : strings(capabilities.flatMap((item) => item.evidence))
    if (values.length) rows.push({ label: 'Specialization', items: values.map((value) => ({ label: value, evidence: [] })) })
  }
  return rows
}
