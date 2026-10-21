/** 北京时间格式化：项目所有"本地日/本地时刻"口径的唯一来源。 */

/** 返回 'YYYY-MM-DDTHH:mm:ss'（北京时间，无时区后缀）。 */
export function localShanghaiInput(value = new Date().toISOString()) {
  const d = new Date(value);
  return new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 19);
}

/** 返回 'YYYY-MM-DD'（北京时间自然日）。 */
export function shanghaiDate(value = new Date().toISOString()) {
  return localShanghaiInput(value).slice(0, 10);
}

/** 返回 'HH:mm'（北京时间）。 */
export function shanghaiTime(value = new Date().toISOString()) {
  return localShanghaiInput(value).slice(11, 16);
}

/** 带 +08:00 偏移的完整时刻，用于 measuredAt。 */
export function shanghaiOffsetStamp(value = new Date().toISOString()) {
  return `${localShanghaiInput(value)}+08:00`;
}
