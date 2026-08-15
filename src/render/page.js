import { shell, SITE_ORIGIN } from './shell.js'
import { SECTIONS } from './sections.js'

/** Compose the shell with whatever sections have data. Nothing else decides layout. */
export function renderEntity(vm) {
  const latest = vm.history?.[0]
  const kind = vm.level === 'district' ? 'district' : 'school'

  const crumbs = [
    { href: '/', label: 'Texas schools' },
    { href: `/region/${vm.regionId}`, label: vm.regionName },
    { href: `/county/${vm.countySlug}`, label: `${vm.county} County` },
    vm.level === 'campus' ? { href: `/district/${vm.districtSlug}`, label: vm.districtName } : null,
  ].filter(Boolean)
  crumbs.at(-1).current = vm.name

  const compare =
    vm.peerAvg != null && latest?.score != null
      ? ` — ${latest.score > vm.peerAvg ? 'above' : 'below'} ${kind === 'district' ? 'districts' : 'schools'} serving similar students`
      : ''

  return shell({
    title: `${vm.name} — ratings, student outcomes and spending`,
    description:
      `${vm.name}: rated ${latest?.rating ?? 'not rated'}${latest?.score != null ? ` (${latest.score})` : ''} for ${latest?.year ?? ''}${compare}. ` +
      `${vm.history?.length ?? 0} years of ratings, domain scores, STAAR results, demographics and per-student spending compared with peer ${kind === 'district' ? 'districts' : 'schools'}.`,
    canonical: `${SITE_ORIGIN}/${vm.level}/${vm.slug}`,
    crumbs,
    sections: SECTIONS.map((s) => s(vm)),
  })
}
