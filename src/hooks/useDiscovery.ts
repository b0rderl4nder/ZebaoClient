import { useCallback, useState } from 'react'
import { DEFAULT_DAEMON_PORT } from '../api/client'
import { loadRecentRobots } from '../utils/storage'

interface Service { name?: string; host: string; port: number }
interface ScanResult {
  devices: Service[]
  localIps: string[]
  scannedSubnets: string[]
  customSubnet: string | null
  invalidCustomSubnet: boolean
  usedFallbackSubnets: boolean
}

const KNOWN_HOSTS = ['192.168.3.83', '192.168.2.95', '192.168.10.74', '192.167.123.1', 'reachy-mini.local', 'reachy_mini.local', 'zebao.local']
const FALLBACK_SUBNETS = ['192.168.3', '192.168.2', '192.168.10', '192.168.12', '192.168.15', '192.168.1', '192.168.0']
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g

function isIpv4(value: string): boolean {
  const parts = value.split('.').map(Number)
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
}

function isPrivateIpv4(value: string): boolean {
  if (!isIpv4(value)) return false
  const [first, second] = value.split('.').map(Number)
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
}

function subnetFromIp(ip: string): string | null {
  if (!isPrivateIpv4(ip)) return null
  return ip.split('.').slice(0, 3).join('.')
}

function hostsFromSubnet(subnet: string): string[] {
  return Array.from({ length: 254 }, (_, index) => `${subnet}.${index + 1}`)
}

function normalizeSubnet(value: string): string | null {
  const trimmed = value.trim().replace(/\/24$/, '')
  if (!trimmed) return null

  const ip = trimmed.endsWith('.0') ? trimmed.slice(0, -2) : trimmed
  const parts = ip.split('.')
  if (parts.length === 3 && parts.every(part => /^\d{1,3}$/.test(part))) {
    const subnet = parts.map(Number)
    return subnet.every(part => part >= 0 && part <= 255) ? subnet.join('.') : null
  }

  return subnetFromIp(ip)
}

function addHostSource(host: string, hosts: Set<string>, subnets: Set<string>) {
  const cleanHost = host.trim().replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
  if (!cleanHost) return
  hosts.add(cleanHost)
  const subnet = subnetFromIp(cleanHost)
  if (subnet) subnets.add(subnet)
}

async function probe(host: string, port: number): Promise<Service | null> {
  try {
    const response = await fetch(`http://${host}:${port}/api/daemon/status`, {
      signal: AbortSignal.timeout(900),
    })
    return response.ok ? { host, port } : null
  } catch {
    return null
  }
}

async function runLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let index = 0
  const workers = Array.from({ length: limit }, async () => {
    while (index < items.length) {
      const item = items[index++]
      await fn(item)
    }
  })
  await Promise.all(workers)
}

async function getWebRtcLocalIps(): Promise<string[]> {
  if (typeof RTCPeerConnection === 'undefined') return []

  const ips = new Set<string>()
  const peer = new RTCPeerConnection({ iceServers: [] })

  try {
    peer.createDataChannel('zebao-discovery')
    peer.onicecandidate = event => {
      const candidate = event.candidate?.candidate ?? ''
      for (const match of candidate.match(IPV4_PATTERN) ?? []) {
        if (isPrivateIpv4(match)) ips.add(match)
      }
    }

    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    await new Promise<void>(resolve => window.setTimeout(resolve, 800))
  } catch {
    // Some browsers hide local ICE candidates; fixed hosts and subnet probes still work.
  } finally {
    peer.close()
  }

  return Array.from(ips)
}

async function collectTargets(customSubnet?: string): Promise<{ hosts: string[]; localIps: string[]; subnets: string[]; customSubnet: string | null; invalidCustomSubnet: boolean; usedFallbackSubnets: boolean }> {
  const hosts = new Set<string>(KNOWN_HOSTS)
  const subnets = new Set<string>()
  const normalizedCustomSubnet = customSubnet ? normalizeSubnet(customSubnet) : null
  const invalidCustomSubnet = Boolean(customSubnet?.trim() && !normalizedCustomSubnet)

  if (invalidCustomSubnet) {
    return {
      hosts: [],
      localIps: [],
      subnets: [],
      customSubnet: null,
      invalidCustomSubnet,
      usedFallbackSubnets: false,
    }
  }

  let localIps: string[] = []
  if (normalizedCustomSubnet) {
    subnets.add(normalizedCustomSubnet)
  } else {
    addHostSource(window.location.hostname, hosts, subnets)
    for (const robot of loadRecentRobots()) {
      addHostSource(robot.host, hosts, subnets)
    }

    localIps = await getWebRtcLocalIps()
    for (const ip of localIps) {
      addHostSource(ip, hosts, subnets)
    }

    for (const subnet of FALLBACK_SUBNETS) {
      subnets.add(subnet)
    }
  }

  for (const subnet of subnets) {
    for (const host of hostsFromSubnet(subnet)) hosts.add(host)
  }

  return {
    hosts: Array.from(hosts),
    localIps,
    subnets: Array.from(subnets),
    customSubnet: normalizedCustomSubnet,
    invalidCustomSubnet,
    usedFallbackSubnets: !normalizedCustomSubnet,
  }
}

async function scanNetwork(customSubnet?: string): Promise<ScanResult> {
  const found: Service[] = []
  const seen = new Set<string>()
  const { hosts, localIps, subnets, customSubnet: normalizedCustomSubnet, invalidCustomSubnet, usedFallbackSubnets } = await collectTargets(customSubnet)
  if (invalidCustomSubnet) {
    return {
      devices: [],
      localIps,
      scannedSubnets: [],
      customSubnet: null,
      invalidCustomSubnet,
      usedFallbackSubnets,
    }
  }

  const targets = hosts.map(host => ({ host, port: DEFAULT_DAEMON_PORT }))

  await runLimited(targets, 64, async ({ host, port }) => {
    const key = `${host}:${port}`
    if (seen.has(key)) return
    seen.add(key)
    const service = await probe(host, port)
    if (service) found.push(service)
  })

  return {
    devices: found.sort((a, b) => `${a.host}:${a.port}`.localeCompare(`${b.host}:${b.port}`)),
    localIps,
    scannedSubnets: subnets,
    customSubnet: normalizedCustomSubnet,
    invalidCustomSubnet,
    usedFallbackSubnets,
  }
}

export function useDiscovery() {
  const [scanning, setScanning] = useState(false)
  const [devices, setDevices] = useState<Service[]>([])
  const [scanSummary, setScanSummary] = useState<string | null>(null)

  const scan = useCallback(async (customSubnet?: string) => {
    setScanning(true)
    setDevices([])
    setScanSummary(null)
    try {
      const result = await scanNetwork(customSubnet)
      setDevices(result.devices)
      if (result.invalidCustomSubnet) {
        setScanSummary('网段格式不正确，请输入类似 192.168.3 或 192.168.3.0/24 的地址。')
        return
      }
      const source = result.customSubnet ? '指定网段' : result.localIps.length > 0 ? `本机地址 ${result.localIps.join('、')}` : result.usedFallbackSubnets ? '固定主机和兜底网段' : '当前页面和最近连接'
      const prefix = result.devices.length > 0 ? '已发现设备。' : '未发现设备。'
      setScanSummary(`${prefix}已根据${source}扫描：${result.scannedSubnets.join('、')}`)
    } finally {
      setScanning(false)
    }
  }, [])

  return { scanning, devices, scan, scanSummary }
}
