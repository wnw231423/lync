import { Model } from "@nozbe/watermelondb";
import { date, field, readonly, text } from "@nozbe/watermelondb/decorators";

// Expense 对应本地 `expenses` 表中的一条账单记录。
export default class Expense extends Model {
  static table = "expenses";

  // spaceId 指向这笔账单所属的旅行空间。
  // @ts-ignore
  @text("space_id") spaceId;

  // payerId 记录这笔账单由哪位成员付款。
  // @ts-ignore
  @text("payer_id") payerId;

  // amount 以“分”为单位存储金额，避免浮点计算误差。
  // @ts-ignore
  @field("amount") amount;

  // description 保存给用户看的账单名称。
  // @ts-ignore
  @text("description") description;

  // createdAt 记录这条本地数据的创建时间。
  // @ts-ignore
  @readonly @date("created_at") createdAt;

  // updatedAt 记录这条本地数据最近一次变更时间。
  // @ts-ignore
  @readonly @date("updated_at") updatedAt;
}
