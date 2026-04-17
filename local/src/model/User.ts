import { Model } from "@nozbe/watermelondb";
import { date, readonly, text } from "@nozbe/watermelondb/decorators";

// User 对应本地 `users` 表里持久化保存的一条旅行者资料记录。
export default class User extends Model {
  static table = "users";

  // nickname 表示空间列表、动态等场景里展示的昵称。
  // @ts-ignore
  @text("nickname") nickname;

  // createdAt 记录这条本地数据的创建时间。
  // @ts-ignore
  @readonly @date("created_at") createdAt;

  // updatedAt 记录这条本地数据最近一次变更时间。
  // @ts-ignore
  @readonly @date("updated_at") updatedAt;
}
