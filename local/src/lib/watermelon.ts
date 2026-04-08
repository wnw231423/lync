import type Model from "@nozbe/watermelondb/Model";

// assignModelId 在模型创建完成前，先把业务主键写进 Watermelon 原始记录。
export function assignModelId(record: Model, id: string) {
  // @ts-ignore
  record._raw.id = id;
}

// assignTimestamps 用毫秒时间戳补齐 Watermelon 原始记录上的时间字段。
export function assignTimestamps(
  record: Model,
  createdAt: number,
  updatedAt: number = createdAt,
) {
  // @ts-ignore
  record._raw.created_at = createdAt;
  // @ts-ignore
  record._raw.updated_at = updatedAt;
}

// dateToTimestamp 把 Watermelon 日期对象和数字时间统一转换成毫秒值。
export function dateToTimestamp(value: Date | number | null | undefined) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return value;
  }
  return 0;
}
