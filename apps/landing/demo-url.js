import { BlockList, isIP } from 'node:net'

const nonPublicAddresses = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) nonPublicAddresses.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [
  ['::', 96], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32],
]) nonPublicAddresses.addSubnet(address, prefix, 'ipv6')

export function resolveDemoUrl(value, production) {
  const candidate = value?.trim() || ''
  if (!production || !candidate) return candidate

  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || url.username || url.password) return ''

    const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
    const version = isIP(hostname)
    if (version) {
      return nonPublicAddresses.check(hostname, `ipv${version}`) ? '' : url.href
    }

    const labels = hostname.split('.')
    const localSuffixes = ['localhost', 'localdomain', 'local', 'internal', 'invalid', 'test', 'example', 'home', 'lan']
    const validLabels = labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    if (labels.length < 2 || hostname.length > 253 || !validLabels ||
      localSuffixes.includes(labels.at(-1)) || hostname.endsWith('.home.arpa')) return ''

    return url.href
  } catch {
    return ''
  }
}
