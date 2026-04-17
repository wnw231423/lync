import { appSchema, tableSchema } from "@nozbe/watermelondb";

// schema 定义了 docs/data-design.md 中约定的本地离线数据表结构。
export default appSchema({
  // version 要与 migrations 的最新版本保持一致。
  version: 7,
  tables: [
    tableSchema({
      // users 只保留文档要求的用户主键与昵称；头像改由前端本地文件管理。
      name: "users",
      columns: [
        { name: "nickname", type: "string" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      // spaces 保存旅行空间主记录。
      name: "spaces",
      columns: [
        { name: "name", type: "string" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      // space_members 保存空间与用户之间的成员关系。
      name: "space_members",
      columns: [
        { name: "space_id", type: "string", isIndexed: true },
        { name: "user_id", type: "string", isIndexed: true },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      // expenses 保存旅行过程中的账单数据。
      name: "expenses",
      columns: [
        { name: "space_id", type: "string", isIndexed: true },
        { name: "payer_id", type: "string" },
        { name: "amount", type: "number" },
        { name: "description", type: "string" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      // photos 只保留同步元数据；本地文件路径统一由 photo_id 推导。
      name: "photos",
      columns: [
        { name: "space_id", type: "string", isIndexed: true },
        { name: "uploader_id", type: "string" },
        { name: "remote_url", type: "string", isOptional: true },
        { name: "post_id", type: "string", isIndexed: true },
        { name: "shoted_at", type: "number" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      // posts 只保存动态主记录；作者信息由图片或首条评论推导。
      name: "posts",
      columns: [
        { name: "space_id", type: "string", isIndexed: true },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
    tableSchema({
      // comments 既承载动态正文，也承载后续评论。
      name: "comments",
      columns: [
        { name: "space_id", type: "string", isIndexed: true },
        { name: "post_id", type: "string", isIndexed: true },
        { name: "content", type: "string" },
        { name: "commenter_id", type: "string" },
        { name: "commented_at", type: "number" },
        { name: "created_at", type: "number" },
        { name: "updated_at", type: "number" },
      ],
    }),
  ],
});
