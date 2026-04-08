import { Model } from "@nozbe/watermelondb";
import { date, readonly, text } from "@nozbe/watermelondb/decorators";

// Space 对应本地 `spaces` 表中的一个旅行空间。
export default class Space extends Model {
  static table = "spaces";

  // name 表示给用户展示的旅行空间名称。
  // @ts-ignore
  @text("name") name;

  // createdAt 记录这条本地数据的创建时间。
  // @ts-ignore
  @readonly @date("created_at") createdAt;

  // updatedAt 记录这条本地数据最近一次变更时间。
  // @ts-ignore
  @readonly @date("updated_at") updatedAt;
}
