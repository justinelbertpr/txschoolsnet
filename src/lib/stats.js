const finite = (xs) => xs.filter((x) => typeof x === 'number' && Number.isFinite(x))

export function mean(values) {
  const xs = finite(values)
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length
}

export function weightedMean(pairs) {
  let num = 0
  let den = 0
  for (const { v, w } of pairs) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) continue
    num += v * w
    den += w
  }
  return den === 0 ? null : num / den
}

export function median(values) {
  const xs = finite(values).slice().sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = xs.length >> 1
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}
