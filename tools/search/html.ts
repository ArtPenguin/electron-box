/**
 * HTML / XML 文本处理小工具（供各搜索提供方共用，避免重复实现）
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** 还原实体（&amp; / &#39; / &#x27; / &nbsp; 等） */
export function decodeEntities (text: unknown): string {
  return String(text || '').replace(/&(#?[0-9a-z]+);/gi, (raw, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? raw
    const isHex = code[1] === 'x' || code[1] === 'X'
    const value = Number.parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10)
    const valid = Number.isInteger(value) && value >= 0 && value <= 0x10ffff
    return valid ? String.fromCodePoint(value) : raw
  })
}

/**
 * 清洗为单行可读文本：先还原实体再去标签，最后压缩空白。
 *
 * 说明：标签（如 360 的关键词高亮 <em>）直接删除而非替换为空格，
 *      否则中文标题会被拆成「黑神话悟空 发售日期」这种带空隙的形式。
 */
export function toPlainText (text: unknown): string {
  return decodeEntities(text)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
