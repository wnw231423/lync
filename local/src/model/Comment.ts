import { Model } from "@nozbe/watermelondb";
import { date, field, readonly, text } from "@nozbe/watermelondb/decorators";

// Comment 对应本地 `comments` 表中的一条动态评论记录。
export default class Comment extends Model {
  static table = "comments";

  // content 保存评论正文内容。
  // @ts-ignore
  @text("content") content;

  // commenterId 记录是哪位成员写下了这条评论。
  // @ts-ignore
  @text("commenter_id") commenterId;

  // postId 把评论关联回所属动态。
  // @ts-ignore
  @text("post_id") postId;

  // commentedAt 记录评论逻辑上的发布时间。
  // @ts-ignore
  @date("commented_at") commentedAt;

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
