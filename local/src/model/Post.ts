import { Model } from "@nozbe/watermelondb";
import { date, field, readonly, text } from "@nozbe/watermelondb/decorators";

// Post 对应本地 `posts` 表中的一条动态主记录。
export default class Post extends Model {
  static table = "posts";

  // posterId 记录是哪位成员发布了这条动态。
  // @ts-ignore
  @text("poster_id") posterId;

  // createdAt 记录这条本地数据的创建时间。
  // @ts-ignore
  @readonly @date("created_at") createdAt;

  // updatedAt 记录这条本地数据最近一次变更时间。
  // @ts-ignore
  @readonly @date("updated_at") updatedAt;

  // deletedAt 用于软删除标记，方便后续同步时识别删除状态。
  // @ts-ignore
  @field("deleted_at") deletedAt;
}
