export const PROCESSES = [
  ['laser_engraving', 'Laser engraving'],
  ['laser_cutting', 'Laser cutting'],
  ['cnc_machining', 'CNC machining'],
  ['3d_printing', '3D printing'],
  ['prototyping', 'Prototyping'],
]

export const MATERIALS = [
  ['plywood', 'Plywood'],
  ['wood', 'Wood'],
  ['metal', 'Metal'],
  ['plastic', 'Plastic'],
  ['acrylic', 'Acrylic'],
  ['other', 'Other'],
]

export const SCORE_CATEGORIES = [
  ['process_match', 'Process match', 40],
  ['material_signal', 'Material signal', 20],
  ['equipment_signal', 'Equipment signal', 15],
  ['business_specialization', 'Business specialization', 10],
  ['location_suitability', 'Location suitability', 10],
  ['public_activity_signal', 'Public activity signal', 5],
]

export const INITIAL_REQUEST = {
  title: 'Wooden logo pendant',
  description: 'I need 30 wooden pendants, 5 cm diameter, with an engraved logo.',
  location: 'Belgrade, Serbia',
  quantity: '30',
}

export function humanize(value) {
  return String(value)
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase())
}

export function processLabel(value) {
  return (
    PROCESSES.find(([id]) => id === value)?.[1] ||
    (value === 'cnc_milling' ? 'CNC milling' : humanize(value))
  )
}

function quantityError(value) {
  return !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1
    ? 'Enter a whole quantity of at least 1.'
    : ''
}

function textError(value, max, required = true) {
  if (required && !value.trim()) return 'This field is required.'
  return value.trim().length > max ? `Use no more than ${max} characters.` : ''
}

export function validateRequest(values) {
  return Object.fromEntries(
    Object.entries({
      title: textError(values.title, 120),
      description: textError(values.description, 8000),
      location: textError(values.location, 240),
      quantity: quantityError(values.quantity),
    }).filter(([, error]) => error),
  )
}

export function requestPayload(values) {
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    location_text: values.location.trim(),
    quantity: Number(values.quantity),
  }
}

export function prefillSpecification(values) {
  // Split only the explicit location fields; never infer dimensions or processes from prose.
  const [city = '', ...countryParts] = values.location.split(',')
  const country = countryParts.join(',').trim()
  return {
    process: 'laser_engraving',
    material: 'plywood',
    customMaterial: '',
    quantity: values.quantity,
    width: '',
    height: '',
    thickness: '',
    requirements: '',
    city: city.trim(),
    country: /^(serbia|srbija|rs)$/i.test(country) ? 'RS' : country,
  }
}

export function validateSpecification(values) {
  const errors = {}
  if (!PROCESSES.some(([id]) => id === values.process)) errors.process = 'Select a process.'
  if (!MATERIALS.some(([id]) => id === values.material)) errors.material = 'Select a material.'
  if (values.material === 'other') errors.customMaterial = textError(values.customMaterial, 120)
  errors.quantity = quantityError(values.quantity)
  for (const key of ['width', 'height', 'thickness']) {
    if (values[key].trim() && (!Number.isFinite(Number(values[key])) || Number(values[key]) <= 0)) {
      errors[key] = 'Enter a positive dimension in mm or leave it empty.'
    }
  }
  errors.city = textError(values.city, 120, false)
  errors.country = textError(values.country, 120, false)
  const requirements = values.requirements
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
  if (requirements.length > 100 || requirements.some((item) => item.length > 500)) {
    errors.requirements = 'Use up to 100 requirements, each no more than 500 characters.'
  }
  return Object.fromEntries(Object.entries(errors).filter(([, error]) => error))
}

export function specificationPayload(values) {
  const dimensions = Object.fromEntries(
    ['width', 'height', 'thickness']
      .filter((key) => values[key].trim())
      .map((key) => [key, Number(values[key])]),
  )
  const location = Object.fromEntries(
    ['city', 'country']
      .filter((key) => values[key].trim())
      .map((key) => [
        key,
        key === 'country' && /^(serbia|srbija|rs)$/i.test(values[key].trim())
          ? 'RS'
          : values[key].trim(),
      ]),
  )
  return {
    process: [values.process],
    materials: [values.material === 'other' ? values.customMaterial.trim() : values.material],
    quantity: Number(values.quantity),
    ...(Object.keys(dimensions).length ? { dimensions_mm: dimensions } : {}),
    requirements: values.requirements
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean),
    ...(Object.keys(location).length ? { location } : {}),
  }
}
