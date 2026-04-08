import { Model } from "@nozbe/watermelondb";
import { date, field, readonly, text } from "@nozbe/watermelondb/decorators";

// Photo 对应本地 `photos` 表中的一张动态图片记录。
export default class Photo extends Model {
  static table = "photos";

  // spaceId 指向这张图片所属的旅行空间。
  // @ts-ignore
  @text("space_id") spaceId;

  // postId 把图片关联回所属动态。
  // @ts-ignore
  @text("post_id") postId;

  // uploaderId 记录是哪位成员上传了这张图片。
  // @ts-ignore
  @text("uploader_id") uploaderId;

  // localUri 保存离线展示时使用的本地沙盒文件路径。
  // @ts-ignore
  @text("local_uri") localUri;

  // remoteUrl 在存在网络来源时保存原始图片地址。
  // @ts-ignore
  @text("remote_url") remoteUrl;

  // shotedAt 记录图片拍摄或被挂到旅程里的时间。
  // @ts-ignore
  @date("shoted_at") shotedAt;

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
