import { processLabel } from './forms.js'

export function matchLabel(candidate) {
  if (candidate.fit_label === 'Strong potential fit') return 'Strong potential match'
  if (candidate.fit_label === 'Potential fit') return 'Potential match'
  return 'Possible match'
}

export function formatDistance(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return `${value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString('en-GB')} km`
}

export function evidenceSummary(candidate, specification) {
  const score = candidate.score_breakdown || {}
  const process = processLabel(specification.process).toLowerCase()
  if (score.process_match >= 40) return `Public business data suggests ${process}.`
  if (score.process_match > 0) return `A related public process signal was found. ${processLabel(specification.process)} is not confirmed.`
  if (score.material_signal > 0) {
    const material = ['wood', 'plywood'].includes(specification.material) ? 'Wood' :
      specification.material === 'other' ? specification.customMaterial : specification.material
    return `${material.charAt(0).toUpperCase() + material.slice(1)}-related manufacturing signal found. ${processLabel(specification.process)} is not confirmed.`
  }
  if (score.equipment_signal > 0) return `A relevant public equipment signal was found. ${processLabel(specification.process)} is not confirmed.`
  if (score.business_specialization > 0) return `A related workshop specialization was found. ${processLabel(specification.process)} is not confirmed.`
  return 'No matching manufacturing signal was recorded in the available public data.'
}
