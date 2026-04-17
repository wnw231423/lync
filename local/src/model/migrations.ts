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
    {
      // v6 严格对齐最新 docs：本地去掉 deleted_at，posts/comments 增加 space_id，头像移出数据库。
      toVersion: 6,
      steps: [
        addColumns({
          table: "comments",
          columns: [{ name: "space_id", type: "string", isOptional: true }],
        }),
        unsafeExecuteSql(`
          create table if not exists "users_v6" (
            "id" text primary key not null,
            "_changed" text not null,
            "_status" text not null,
            "nickname" text not null,
            "created_at" integer not null,
            "updated_at" integer not null
          );
          insert or replace into "users_v6" (
            "id",
            "_changed",
            "_status",
            "nickname",
            "created_at",
            "updated_at"
          )
          select
            "id",
            coalesce("_changed", ''),
            coalesce("_status", 'synced'),
            coalesce("nickname", ''),
            coalesce("created_at", strftime('%s','now') * 1000),
            coalesce("updated_at", coalesce("created_at", strftime('%s','now') * 1000))
          from "users";
          drop table "users";
          alter table "users_v6" rename to "users";

          create table if not exists "spaces_v6" (
            "id" text primary key not null,
            "_changed" text not null,
            "_status" text not null,
            "name" text not null,
            "created_at" integer not null,
            "updated_at" integer not null
          );
          insert or replace into "spaces_v6" (
            "id",
            "_changed",
            "_status",
            "name",
            "created_at",
            "updated_at"
          )
          select
            "id",
            coalesce("_changed", ''),
            coalesce("_status", 'synced'),
            coalesce("name", ''),
            coalesce("created_at", strftime('%s','now') * 1000),
            coalesce("updated_at", coalesce("created_at", strftime('%s','now') * 1000))
          from "spaces";
          drop table "spaces";
          alter table "spaces_v6" rename to "spaces";

          create table if not exists "space_members_v6" (
            "id" text primary key not null,
            "_changed" text not null,
            "_status" text not null,
            "space_id" text not null,
            "user_id" text not null,
            "created_at" integer not null,
            "updated_at" integer not null
          );
          insert or replace into "space_members_v6" (
            "id",
            "_changed",
            "_status",
            "space_id",
            "user_id",
            "created_at",
            "updated_at"
          )
          select
            "id",
            coalesce("_changed", ''),
            coalesce("_status", 'synced'),
            coalesce("space_id", ''),
            coalesce("user_id", ''),
            coalesce("created_at", strftime('%s','now') * 1000),
            coalesce("updated_at", coalesce("created_at", strftime('%s','now') * 1000))
          from "space_members";
          drop table "space_members";
          alter table "space_members_v6" rename to "space_members";
          create index if not exists "space_members_space_id_index" on "space_members" ("space_id");
          create index if not exists "space_members_user_id_index" on "space_members" ("user_id");

          create table if not exists "expenses_v6" (
            "id" text primary key not null,
            "_changed" text not null,
            "_status" text not null,
            "space_id" text not null,
            "payer_id" text not null,
            "amount" integer not null,
            "description" text not null,
            "created_at" integer not null,
            "updated_at" integer not null
          );
          insert or replace into "expenses_v6" (
            "id",
            "_changed",
            "_status",
            "space_id",
            "payer_id",
            "amount",
            "description",
            "created_at",
            "updated_at"
          )
          select
            "id",
            coalesce("_changed", ''),
            coalesce("_status", 'synced'),
            coalesce("space_id", ''),
            coalesce("payer_id", ''),
            coalesce("amount", 0),
            coalesce("description", ''),
            coalesce("created_at", strftime('%s','now') * 1000),
            coalesce("updated_at", coalesce("created_at", strftime('%s','now') * 1000))
          from "expenses";
          drop table "expenses";
          alter table "expenses_v6" rename to "expenses";
          create index if not exists "expenses_space_id_index" on "expenses" ("space_id");

          create table if not exists "photos_v6" (
            "id" text primary key not null,
            "_changed" text not null,
            "_status" text not null,
            "space_id" text not null,
            "uploader_id" text not null,
            "local_uri" text,
            "remote_url" text,
            "post_id" text not null,
            "shoted_at" integer not null,
            "created_at" integer not null,
            "updated_at" integer not null
          );
          insert or replace into "photos_v6" (
            "id",
            "_changed",
            "_status",
            "space_id",
            "uploader_id",
            "local_uri",
            "remote_url",
            "post_id",
            "shoted_at",
            "created_at",
            "updated_at"
          )
          select
            "id",
            coalesce("_changed", ''),
            coalesce("_status", 'synced'),
            coalesce("space_id", ''),
            coalesce("uploader_id", ''),
            nullif(coalesce("local_uri", ''), ''),
            nullif(coalesce("remote_url", ''), ''),
            coalesce("post_id", ''),
            coalesce("shoted_at", coalesce("created_at", strftime('%s','now') * 1000)),
            coalesce("created_at", strftime('%s','now') * 1000),
            coalesce("updated_at", coalesce("created_at", strftime('%s','now') * 1000))
          from "photos";
          drop table "photos";
          alter table "photos_v6" rename to "photos";
          create index if not exists "photos_space_id_index" on "photos" ("space_id");
          create index if not exists "photos_post_id_index" on "photos" ("post_id");

          create table if not exists "posts_v6" (
            "id" text primary key not null,
            "_changed" text not null,
            "_status" text not null,
            "space_id" text not null,
            "created_at" integer not null,
            "updated_at" integer not null
          );
          insert or replace into "posts_v6" (
            "id",
            "_changed",
            "_status",
            "space_id",
            "created_at",
            "updated_at"
          )
          select
            "id",
            coalesce("_changed", ''),
            coalesce("_status", 'synced'),
            coalesce(
              nullif("space_id", ''),
              (
                select "space_id"
                from "photos"
                where "photos"."post_id" = "posts"."id"
                order by "photos"."shoted_at" asc
                limit 1
              ),
              ''
            ),
            coalesce("created_at", strftime('%s','now') * 1000),
            coalesce("updated_at", coalesce("created_at", strftime('%s','now') * 1000))
          from "posts";
          drop table "posts";
          alter table "posts_v6" rename to "posts";
          create index if not exists "posts_space_id_index" on "posts" ("space_id");

          create table if not exists "comments_v6" (
            "id" text primary key not null,
            "_changed" text not null,
            "_status" text not null,
            "space_id" text not null,
            "post_id" text not null,
            "content" text not null,
            "commenter_id" text not null,
            "commented_at" integer not null,
            "created_at" integer not null,
            "updated_at" integer not null
          );
          insert or replace into "comments_v6" (
            "id",
            "_changed",
            "_status",
            "space_id",
            "post_id",
            "content",
            "commenter_id",
            "commented_at",
            "created_at",
            "updated_at"
          )
          select
            "id",
            coalesce("_changed", ''),
            coalesce("_status", 'synced'),
            coalesce(
              nullif("space_id", ''),
              (
                select "space_id"
                from "posts"
                where "posts"."id" = "comments"."post_id"
                limit 1
              ),
              (
                select "space_id"
                from "photos"
                where "photos"."post_id" = "comments"."post_id"
                order by "photos"."shoted_at" asc
                limit 1
              ),
              ''
            ),
            coalesce("post_id", ''),
            coalesce("content", ''),
            coalesce("commenter_id", ''),
            coalesce("commented_at", coalesce("created_at", strftime('%s','now') * 1000)),
            coalesce("created_at", strftime('%s','now') * 1000),
            coalesce("updated_at", coalesce("created_at", strftime('%s','now') * 1000))
          from "comments";
          drop table "comments";
          alter table "comments_v6" rename to "comments";
          create index if not exists "comments_space_id_index" on "comments" ("space_id");
          create index if not exists "comments_post_id_index" on "comments" ("post_id");

          drop table if exists "post_comments";
        `),
      ],
    },
  ],
});
