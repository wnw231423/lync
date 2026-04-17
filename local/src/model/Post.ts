import { Model } from "@nozbe/watermelondb";
import { date, readonly, text } from "@nozbe/watermelondb/decorators";

// Post 对应本地 `posts` 表中的一条动态主记录。
export default class Post extends Model {
  static table = "posts";

  // spaceId 标记这条动态属于哪个旅行空间。
  // @ts-ignore
  @text("space_id") spaceId;

  // createdAt 记录这条本地数据的创建时间。
  // @ts-ignore
  @readonly @date("created_at") createdAt;

  // updatedAt 记录这条本地数据最近一次变更时间。
  // @ts-ignore
  @readonly @date("updated_at") updatedAt;
}
