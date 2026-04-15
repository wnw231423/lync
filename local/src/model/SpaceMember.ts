import { Model } from "@nozbe/watermelondb";
import { date, readonly, text } from "@nozbe/watermelondb/decorators";

// SpaceMember 对应用户和旅行空间之间的多对多关系记录。
export default class SpaceMember extends Model {
  static table = "space_members";

  // spaceId 指向所属的旅行空间。
  // @ts-ignore
  @text("space_id") spaceId;

  // userId 指向该空间里的成员用户。
  // @ts-ignore
  @text("user_id") userId;

  // createdAt 记录这条本地数据的创建时间。
  // @ts-ignore
  @readonly @date("created_at") createdAt;

  // updatedAt 记录这条本地数据最近一次变更时间。
  // @ts-ignore
  @readonly @date("updated_at") updatedAt;
}
