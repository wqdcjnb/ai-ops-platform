import { request as httpRequest } from 'node:http'
import { z } from 'zod'

/** Only these Compose services can ever be addressed by the control plane. */
export const dockerServiceIdSchema = z.enum(['web', 'server', 'new-api', 'cpa'])
export const dockerRestartTargetSchema = z.enum(['all', 'web', 'server', 'new-api', 'cpa'])

export type DockerServiceId = z.infer<typeof dockerServiceIdSchema>
export type DockerRestartTarget = z.infer<typeof dockerRestartTargetSchema>

export interface DockerContainerSnapshot {
  id: string
  name: string
  image: string
  state: string
  status: string
  health: 'healthy' | 'unhealthy' | 'starting' | 'none' | 'unknown'
  createdAt: number
}

export interface DockerServiceSnapshot {
  id: DockerServiceId
  name: string
  role: string
  container: DockerContainerSnapshot | null
  state: 'healthy' | 'reachable' | 'offline'
  detail: string
  checkedAt: string
}

export interface DockerControlStatus {
  enabled: boolean
  available: boolean
  projectName: string
  notice: string
  services: DockerServiceSnapshot[]
}

export interface DockerControl {
  readonly enabled: boolean
  readonly projectName: string
  status(): Promise<DockerControlStatus>
  restart(target: DockerRestartTarget): Promise<void>
}

interface EngineContainer {
  Id?: unknown
  Names?: unknown
  Image?: unknown
  State?: unknown
  Status?: unknown
  Created?: unknown
  Labels?: unknown
}

const serviceDescriptors: Record<DockerServiceId, { name: string; role: string }> = {
  web: { name: 'AI OPS Web', role: '管理界面' },
  server: { name: 'AI OPS Server', role: 'BFF 与网关' },
  'new-api': { name: 'New API', role: 'Token 与渠道管理' },
  cpa: { name: 'CPA Codex OAuth', role: '账号池与模型上游' },
}

const serviceIds: DockerServiceId[] = ['web', 'server', 'new-api', 'cpa']

class DockerEngineError extends Error {
  constructor(message: string, readonly statusCode?: number) {
    super(message)
    this.name = 'DockerEngineError'
  }
}

function envFlag(value: string | undefined, fallback = false) {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function defaultSocketPath() {
  return process.platform === 'win32' ? '\\\\.\\pipe\\docker_engine' : '/var/run/docker.sock'
}

function engineRequest<T>(socketPath: string, method: 'GET' | 'POST', path: string, timeoutMs = 2_500): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      socketPath,
      method,
      path,
      headers: { accept: 'application/json', 'content-length': '0' },
      timeout: timeoutMs,
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer | string) => {
        const next = Buffer.concat(chunks.concat(Buffer.from(chunk)))
        // A Docker listing is small, but keep a hard ceiling so an unexpected
        // daemon response cannot consume the BFF process memory.
        if (next.length > 2 * 1024 * 1024) {
          request.destroy(new DockerEngineError('Docker 响应过大'))
          return
        }
        chunks.push(Buffer.from(chunk))
      })
      response.on('end', () => {
        const statusCode = response.statusCode ?? 0
        const text = Buffer.concat(chunks).toString('utf8')
        if (statusCode < 200 || statusCode >= 300) {
          reject(new DockerEngineError(`Docker Engine 返回 ${statusCode}`, statusCode))
          return
        }
        if (!text.trim()) {
          resolve(undefined as T)
          return
        }
        try {
          resolve(JSON.parse(text) as T)
        } catch {
          reject(new DockerEngineError('Docker Engine 返回了无法解析的数据'))
        }
      })
    })
    request.on('timeout', () => request.destroy(new DockerEngineError('Docker Engine 请求超时')))
    request.on('error', (error) => reject(error instanceof DockerEngineError ? error : new DockerEngineError('Docker Engine 当前不可达')))
    request.end()
  })
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0
}

function healthFromStatus(state: string, status: string): DockerContainerSnapshot['health'] {
  const match = /\((healthy|unhealthy|starting)\)/i.exec(status)
  if (match?.[1]) return match[1].toLowerCase() as DockerContainerSnapshot['health']
  if (state === 'running') return 'none'
  return 'unknown'
}

function toContainerSnapshot(value: EngineContainer): DockerContainerSnapshot | null {
  const id = stringValue(value.Id)
  if (!id) return null
  const state = stringValue(value.State) || 'unknown'
  const status = stringValue(value.Status) || state
  const names = Array.isArray(value.Names) ? value.Names : []
  const rawName = names.find((name): name is string => typeof name === 'string') ?? id.slice(0, 12)
  return {
    id,
    name: rawName.replace(/^\//, ''),
    image: stringValue(value.Image) || 'unknown',
    state,
    status,
    health: healthFromStatus(state, status),
    createdAt: numberValue(value.Created),
  }
}

function serviceState(container: DockerContainerSnapshot | null): DockerServiceSnapshot['state'] {
  if (!container) return 'offline'
  if (container.state === 'running' && (container.health === 'healthy' || container.health === 'none')) return 'healthy'
  if (['created', 'restarting', 'paused', 'running'].includes(container.state)) return 'reachable'
  return 'offline'
}

function serviceDetail(container: DockerContainerSnapshot | null) {
  if (!container) return '未找到 Compose 容器'
  if (container.health === 'healthy') return `${container.name} · healthcheck 通过`
  if (container.health === 'unhealthy') return `${container.name} · healthcheck 未通过`
  if (container.health === 'starting') return `${container.name} · 正在启动`
  if (container.state === 'running') return `${container.name} · 运行中`
  return `${container.name} · ${container.status}`
}

function emptyServices() {
  const checkedAt = new Date().toISOString()
  return serviceIds.map((id) => ({
    id,
    ...serviceDescriptors[id],
    container: null,
    state: 'offline' as const,
    detail: 'Docker 状态暂不可用',
    checkedAt,
  }))
}

export interface CreateDockerControlOptions {
  enabled?: boolean
  projectName?: string
  socketPath?: string
}

export function createDockerControl(options: CreateDockerControlOptions = {}): DockerControl {
  const enabled = options.enabled ?? envFlag(process.env.AI_OPS_DOCKER_CONTROL, false)
  const projectName = (options.projectName ?? process.env.DOCKER_COMPOSE_PROJECT ?? process.env.COMPOSE_PROJECT_NAME ?? 'ai-ops-platform').trim() || 'ai-ops-platform'
  const socketPath = options.socketPath ?? process.env.DOCKER_SOCKET_PATH ?? defaultSocketPath()

  async function readContainers() {
    const filters = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.project=${projectName}`] }))
    const response = await engineRequest<EngineContainer[]>(socketPath, 'GET', `/containers/json?all=1&filters=${filters}`)
    return Array.isArray(response) ? response : []
  }

  async function status(): Promise<DockerControlStatus> {
    if (!enabled) {
      return { enabled: false, available: false, projectName, notice: 'Docker 控制未启用', services: [] }
    }
    try {
      const containers = await readContainers()
      const byService = new Map<DockerServiceId, DockerContainerSnapshot>()
      for (const raw of containers) {
        const labels = raw.Labels && typeof raw.Labels === 'object' && !Array.isArray(raw.Labels) ? raw.Labels as Record<string, unknown> : {}
        const service = stringValue(labels['com.docker.compose.service'])
        if (!dockerServiceIdSchema.safeParse(service).success) continue
        const snapshot = toContainerSnapshot(raw)
        if (!snapshot) continue
        const existing = byService.get(service as DockerServiceId)
        if (!existing || snapshot.createdAt >= existing.createdAt) byService.set(service as DockerServiceId, snapshot)
      }
      const checkedAt = new Date().toISOString()
      const services = serviceIds.map((id) => {
        const container = byService.get(id) ?? null
        return { id, ...serviceDescriptors[id], container, state: serviceState(container), detail: serviceDetail(container), checkedAt }
      })
      return { enabled: true, available: true, projectName, notice: 'Docker Engine 已连接', services }
    } catch {
      return { enabled: true, available: false, projectName, notice: 'Docker Engine 当前不可达，请检查控制开关和 socket 挂载', services: [] }
    }
  }

  async function restart(target: DockerRestartTarget) {
    if (!enabled) throw new DockerEngineError('Docker 控制未启用')
    const current = await status()
    if (!current.available) throw new DockerEngineError(current.notice)
    const targets = target === 'all' ? serviceIds : [target]
    const selected = targets.map((id) => current.services.find((service) => service.id === id)?.container)
    if (selected.some((container) => !container)) throw new DockerEngineError('目标服务的 Compose 容器不存在')
    // Fire the requests in parallel. This is important when `server` itself is
    // selected: the daemon receives the restart request before this process is
    // terminated by Docker.
    await Promise.all(selected.map((container) => engineRequest<void>(socketPath, 'POST', `/containers/${encodeURIComponent(container!.id)}/restart?t=10`)))
  }

  return { enabled, projectName, status, restart }
}
