import { Model } from "@nozbe/watermelondb";
import { date, field, readonly, text } from "@nozbe/watermelondb/decorators";

// User 对应本地 `users` 表里持久化保存的一条旅行者资料记录。
export default class User extends Model {
  static table = "users";

  // nickname 表示空间列表、动态等场景里展示的昵称。
  // @ts-ignore
  @text("nickname") nickname;

  // avatarLocalUri 指向设备上选中的本地沙盒头像文件。
  // @ts-ignore
  @text("avatar_local_uri") avatarLocalUri;

  // avatarRemoteUrl 在没有本地头像时保存一个可回退使用的网络头像地址。
  // @ts-ignore
  @text("avatar_remote_url") avatarRemoteUrl;

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
