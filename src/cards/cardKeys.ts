/**
 * 卡牌的键盘处理（纯函数，不含组件）：卡面按钮的 Enter / 空格激活，以及选牌面板判断按键是否落在控件上。
 * 与组件分开放，组件文件只导出组件（快速刷新要求）；L1 见 Card.test.tsx。
 */
import type { KeyboardEvent } from 'react'

/**
 * 卡面作为按钮时的键盘激活，与原生 <button> 一致用 Enter 与空格。键被这张牌吃掉：
 * 不滚动页面，也不再冒泡到 window 上的全局快捷键（选牌面板的 Enter、比赛页的空格 gogo），
 * 否则一次按键会同时选牌又触发别的动作。按住不放的自动重复不重复激活。
 */
export function activateOnKey(
  e: Pick<KeyboardEvent, 'key' | 'repeat' | 'preventDefault' | 'stopPropagation'>,
  activate: () => void,
): void {
  if (e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  e.stopPropagation()
  if (!e.repeat) activate()
}

/** 按键目标是否是一个自己响应 Enter 的按钮；全局 Enter 只服务「鼠标悬停看中、焦点不在控件上」 */
export function onControl(target: EventTarget | null): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null
  return typeof el?.closest === 'function' && el.closest('button, [role="button"]') != null
}
