/**
 * 主进程跨工具事件总线（松耦合联动）
 *
 * 设计约定：
 * - 工具之间**只通过这里的事件**通信，禁止直接 import 对方模块内部函数；
 * - 发布方不关心有没有订阅者：事件无人接收时静默忽略，不能抛异常；
 * - 总线只存在于主进程；渲染进程想要联动，由主进程桥接后再经 IPC 推送。
 *
 * 当前事件：
 * - game-timer-start / game-timer-stop：进程监视器规则命中时发出，
 *   供游戏时长工具（若存在）接收以开始 / 停止计时。负载见 GameTimerEventPayload。
 */
import { EventEmitter } from 'node:events'

import type { GameTimerEventPayload } from './types/ipc'

export interface BusEventMap {
  'game-timer-start': GameTimerEventPayload
  'game-timer-stop': GameTimerEventPayload
}

export type BusEvent = keyof BusEventMap

/**
 * 类型安全的事件总线：发布 / 订阅都走显式声明的事件名与负载类型，
 * 避免字符串频道名在前后端漂移。
 */
class EventBus {
  private readonly emitter = new EventEmitter()

  /** 发布事件（无订阅者时不报错；订阅者内部异常不影响发布方，只记录到控制台） */
  emit<K extends BusEvent>(event: K, payload: BusEventMap[K]): void {
    const handlers = this.emitter.listeners(event) as Array<(payload: BusEventMap[K]) => void>
    for (const handler of handlers) {
      try {
        handler(payload)
      } catch (err) {
        // 联动是可选增强：消费方出错不能拖垮发布方与主流程
        console.error(`[bus] 事件 ${String(event)} 订阅者处理失败:`, err)
      }
    }
  }

  /** 订阅事件，返回取消订阅函数 */
  on<K extends BusEvent>(event: K, handler: (payload: BusEventMap[K]) => void): () => void {
    this.emitter.on(event, handler)
    return () => this.emitter.off(event, handler)
  }

  /** 移除某事件的全部订阅者（测试 / 调试用） */
  reset (): void {
    this.emitter.removeAllListeners()
  }
}

/** 全局单例总线（主进程生命周期内唯一） */
export const bus = new EventBus()
