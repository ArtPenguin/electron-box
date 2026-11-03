/**
 * 打字机渲染器（渲染进程，无依赖）
 *
 * 作用：模型返回的增量文本是「成块到达」的（一个 chunk 可能含好几个字），
 *      直接追加会出现「一卡一卡」的跳字。这里把增量先入队，再按固定节奏
 *      逐字写入 DOM，从而获得稳定、自然的打字效果。
 *
 * 用法：
 *   const typewriter = createTypewriter(bubbleEl, { onUpdate: scrollToBottom })
 *   typewriter.push('你好')   // 每收到一段增量就调用一次
 *   typewriter.flush()        // 流结束：立刻补齐剩余字符
 */
const TICK_MS = 16 // 约 60 帧/秒，肉眼可见逐字效果
const MAX_TICKS = 45 // 积压时的追赶节奏：约 0.7s 内排空，避免末尾「瞬间闪现」

export interface Typewriter {
  /** 追加一段增量文本（收到流式 token 时调用） */
  push: (delta: string) => void
  /** 流结束：停止定时器并立即渲染剩余字符 */
  flush: () => void
}

export interface TypewriterOptions {
  /** 每次写入后回调（用于滚动到底部） */
  onUpdate?: () => void
}

/** @param el 承载文字的元素 */
export function createTypewriter (el: HTMLElement, options: TypewriterOptions = {}): Typewriter {
  const { onUpdate } = options
  const textNode = document.createTextNode('')
  el.appendChild(textNode)

  const pending: string[] = [] // 待渲染字符（按码点拆分，避免拆坏 emoji 等代理对）
  let timer: ReturnType<typeof setInterval> | null = null

  const notify = (): void => {
    if (typeof onUpdate === 'function') onUpdate()
  }

  function stop (): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  /** 把队列中的字符一次性写出 */
  function drain (): void {
    if (!pending.length) return
    textNode.appendData(pending.join(''))
    pending.length = 0
    notify()
  }

  function tick (): void {
    if (!pending.length) {
      stop()
      return
    }
    const step = Math.max(1, Math.ceil(pending.length / MAX_TICKS))
    textNode.appendData(pending.splice(0, step).join(''))
    notify()
    if (!pending.length) stop()
  }

  return {
    push (delta: string): void {
      if (!delta) return
      for (const char of delta) pending.push(char)
      if (!timer) {
        timer = setInterval(tick, TICK_MS)
        tick() // 首批字符立即出现，避免首字延迟
      }
    },
    flush (): void {
      stop()
      drain()
    },
  }
}
