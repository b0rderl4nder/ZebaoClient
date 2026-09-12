import { appUrl } from './client'

export const OPERATOR_APP_PORT = 7862

/** One connection boundary for the scene-owned App, separate from daemon APIs. */
export function operatorPage(route: string) {
  return appUrl(OPERATOR_APP_PORT, `/#/${route.replace(/^[/#]+/, '')}`)
}

export async function operatorRequest<T>(path: string, init: RequestInit = {}, sceneConfig = false, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (init.signal?.aborted) abort()
  init.signal?.addEventListener('abort', abort, { once: true })
  const timeout = window.setTimeout(abort, Math.min(60000, Math.max(1000, timeoutMs)))
  try {
    const response = await fetch(sceneConfig ? appUrl(5173, `/operator-api${path}`) : appUrl(OPERATOR_APP_PORT, path), {
      ...init,
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload || payload.ok === false) {
      const reasons: Record<string, string> = {
        scene_not_found: '此场景已不存在，请重新读取场景列表。',
        scene_revision_not_found: '这个历史版本已不可用，请重新读取历史。',
        last_scene_cannot_delete: '至少需要保留一个场景，请先创建替代场景。',
        scene_has_agenda_entries: '此场景仍被日程引用，请先解除关联。',
        replacement_scene_required: '删除当前场景前请选择替代场景。',
        replacement_scene_not_found: '替代场景不可用，请重新选择。',
        person_name_already_exists: '已有同名人员，请直接编辑或关联已有档案。',
        person_name_required: '请填写姓名。',
        person_name_invalid: '这个档案名称不可用，请换一个名称。',
        person_not_found: '此人员不存在或已删除，请返回列表。',
        person_permission_invalid: '授权项不可用，请重新读取能力清单。',
        voice_pipeline_busy: '机器人正在交谈，请在空闲时保存链路。',
        cloud_omni_not_configured: '云端兼容链路尚未配置，不能切换。',
        aliyun_native_omni_not_configured: '请先填写云端 Omni 的连接与密钥，再切换。',
        empty_aliyun_native_omni_key: '首次配置需要服务密钥。',
        invalid_aliyun_native_omni_ws_url: '服务地址无效，请填写正确的 WebSocket 地址。',
        prompt_slot_not_found: '此提示词用途已不存在，请重新读取。',
        prompt_variant_not_found: '此版本已不存在，请重新读取。',
        prompt_slot_read_only: '此提示词由外部服务维护，只能查看。',
        prompt_default_cannot_delete: '默认版本不可删除，可新建自定义版本。',
        prompt_text_required: '请填写提示词内容。',
        prompt_text_too_long: '提示词超出此用途的长度限制。',
        prompt_variable_missing: '缺少必要模板变量，请保留编辑框下方列出的变量。',
        prompt_variable_invalid: '存在不支持的模板变量，请检查花括号中的名称。',
        prompt_template_invalid: '模板格式不正确，请检查变量花括号。',
      }
      throw new Error(reasons[String(payload?.error || '')] || '机器人未能完成请求，请检查应用状态后重试。')
    }
    return payload as T
  } catch (error) {
    if (init.signal?.aborted) throw error
    if (controller.signal.aborted) throw new Error('连接超时，请重试。')
    if (error instanceof TypeError) throw new Error('无法连接机器人应用，请检查设备连接。')
    throw error
  } finally {
    window.clearTimeout(timeout)
    init.signal?.removeEventListener('abort', abort)
  }
}
