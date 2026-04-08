import {
  addColumns,
  createTable,
  schemaMigrations,
  unsafeExecuteSql,
} from "@nozbe/watermelondb/Schema/migrations";

// migrations 负责把旧版本本地数据库升级到当前最新的规范化结构。
export default schemaMigrations({
  migrations: [
    {
      // v2 是最早把账单、图片和动态主表补齐到可用状态的一次升级。
      toVersion: 2,
      steps: [
        addColumns({
          table: "expenses",
          columns: [{ name: "payer_name", type: "string", isOptional: true }],
        }),
        addColumns({
          table: "photos",
          columns: [{ name: "post_id", type: "string", isOptional: true }],
        }),
        createTable({
          name: "posts",
          columns: [
            { name: "space_id", type: "string", isIndexed: true },
            { name: "uploader_id", type: "string" },
            { name: "uploader_name", type: "string", isOptional: true },
            { name: "text", type: "string", isOptional: true },
            { name: "created_at", type: "number" },
            { name: "updated_at", type: "number" },
          ],
        }),
      ],
    },
    {
      // v3 引入早期的 post_comments 表，为旧数据升级保留兼容路径。
      toVersion: 3,
      steps: [
        createTable({
          name: "post_comments",
          columns: [
            { name: "space_id", type: "string", isIndexed: true },
            { name: "post_id", type: "string", isIndexed: true },
            { name: "author_id", type: "string" },
            { name: "author_name", type: "string", isOptional: true },
            { name: "text", type: "string" },
            { name: "created_at", type: "number" },
            { name: "updated_at", type: "number" },
          ],
        }),
      ],
    },
    {
      // v4 开始补充用户资料表，让个人信息页有本地持久化落点。
      toVersion: 4,
      steps: [
        createTable({
          name: "users",
          columns: [
            { name: "user_id", type: "string", isIndexed: true },
            { name: "nickname", type: "string" },
            { name: "avatar_local_uri", type: "string", isOptional: true },
            { name: "avatar_remote_url", type: "string", isOptional: true },
            { name: "created_at", type: "number" },
            { name: "updated_at", type: "number" },
          ],
        }),
      ],
    },
    {
      // v5 按 docs/data-design.md 收敛到当前规范化结构，并清理旧表字段。
      toVersion: 5,
      steps: [
        addColumns({
          table: "users",
          columns: [{ name: "deleted_at", type: "number", isOptional: true }],
        }),
        createTable({
          name: "space_members",
          columns: [
            { name: "space_id", type: "string", isIndexed: true },
            { name: "user_id", type: "string", isIndexed: true },
            { name: "created_at", type: "number" },
            { name: "updated_at", type: "number" },
            { name: "deleted_at", type: "number", isOptional: true },
          ],
        }),
        addColumns({
          table: "spaces",
          columns: [
            { name: "name", type: "string" },
            { name: "updated_at", type: "number" },
          ],
        }),
        addColumns({
          table: "expenses",
          columns: [{ name: "deleted_at", type: "number", isOptional: true }],
        }),
        addColumns({
          table: "photos",
          columns: [
            { name: "local_uri", type: "string", isOptional: true },
            { name: "shoted_at", type: "number" },
            { name: "deleted_at", type: "number", isOptional: true },
          ],
        }),
        addColumns({
          table: "posts",
          columns: [
            { name: "poster_id", type: "string" },
            { name: "deleted_at", type: "number", isOptional: true },
          ],
        }),
        createTable({
          name: "comments",
          columns: [
            { name: "content", type: "string" },
            { name: "commenter_id", type: "string" },
            { name: "post_id", type: "string", isIndexed: true },
            { name: "commented_at", type: "number" },
            { name: "created_at", type: "number" },
            { name: "updated_at", type: "number" },
            { name: "deleted_at", type: "number", isOptional: true },
          ],
        }),
        unsafeExecuteSql(`
          update "users"
          set "id" = "user_id"
          where "user_id" is not null
            and "user_id" != ''
            and "id" != "user_id";
          update "spaces"
          set "id" = "space_id"
          where "space_id" is not null
            and "space_id" != ''
            and "id" != "space_id";
          update "spaces"
          set "name" = case
              when "title" is not null and "title" != '' then "title"
              else "name"
            end,
            "updated_at" = case
              when "update_at" is not null and "update_at" != 0 then "update_at"
              else "created_at"
            end;
          update "photos"
          set "local_uri" = case
              when "local_path" is not null and "local_path" != '' then "local_path"
              else "remote_url"
            end,
            "shoted_at" = case
              when "created_at" is not null and "created_at" != 0 then "created_at"
              else strftime('%s','now') * 1000
            end;
          update "posts"
          set "poster_id" = case
              when "uploader_id" is not null and "uploader_id" != '' then "uploader_id"
              else "poster_id"
            end;
          insert or ignore into "comments" (
            "id",
            "_status",
            "_changed",
            "content",
            "commenter_id",
            "post_id",
            "commented_at",
            "created_at",
            "updated_at",
            "deleted_at"
          )
          select
            "id",
            coalesce("_status", 'synced'),
            coalesce("_changed", ''),
            coalesce("text", ''),
            coalesce("author_id", ''),
            coalesce("post_id", ''),
            case
              when "created_at" is not null and "created_at" != 0 then "created_at"
              else strftime('%s','now') * 1000
            end,
            coalesce("created_at", strftime('%s','now') * 1000),
            coalesce("updated_at", coalesce("created_at", strftime('%s','now') * 1000)),
            null
          from "post_comments";
        `),
      ],
    },
  ],
});
