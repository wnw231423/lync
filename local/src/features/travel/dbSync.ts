// dbSync 负责把 mock 聚合快照摊平并同步进 WatermelonDB，供页面按表查询。
import { database } from "@/model";
import Comment from "@/model/Comment";
import Expense from "@/model/Expense";
import Photo from "@/model/Photo";
import Post from "@/model/Post";
import Space from "@/model/Space";
import SpaceMember from "@/model/SpaceMember";
import User from "@/model/User";
import { assignModelId, assignTimestamps } from "@/lib/watermelon";
import type { SpaceData } from "@/features/travel/mockApp";

// resolveExistingRecord 优先读取当前活跃记录。
// 如果同 id 的记录已在本地被软删除，则交给调用方决定是否跳过重建。
async function resolveExistingRecord<T>(
  collection: { find: (id: string) => Promise<any> },
  recordMap: Map<string, T>,
  id: string,
) {
  const cached = recordMap.get(id);
  if (cached) {
    return { record: cached, deleted: false as const };
  }

  try {
    const record = await collection.find(id);
    if (record?._raw?._status === "deleted") {
      return { record: null, deleted: true as const };
    }

    recordMap.set(id, record as T);
    return { record: record as T, deleted: false as const };
  } catch {
    return { record: null, deleted: false as const };
  }
}

// syncMockSpaceToDatabase 把当前空间的 mock 聚合数据同步到本地 WatermelonDB。
export async function syncMockSpaceToDatabase(space: SpaceData) {
  await database.write(async () => {
    const userCollection = database.collections.get<User>("users");
    const spaceCollection = database.collections.get<Space>("spaces");
    const spaceMemberCollection =
      database.collections.get<SpaceMember>("space_members");
    const expenseCollection = database.collections.get<Expense>("expenses");
    const postCollection = database.collections.get<Post>("posts");
    const photoCollection = database.collections.get<Photo>("photos");
    const commentCollection = database.collections.get<Comment>("comments");

    const [
      existingUsers,
      existingSpaces,
      existingSpaceMembers,
      existingExpenses,
      existingPosts,
      existingPhotos,
      existingComments,
    ] = await Promise.all([
      userCollection.query().fetch(),
      spaceCollection.query().fetch(),
      spaceMemberCollection.query().fetch(),
      expenseCollection.query().fetch(),
      postCollection.query().fetch(),
      photoCollection.query().fetch(),
      commentCollection.query().fetch(),
    ]);

    const userMap = new Map(existingUsers.map((item) => [item.id, item]));
    const spaceMap = new Map(existingSpaces.map((item) => [item.id, item]));
    const spaceMemberMap = new Map(
      existingSpaceMembers.map((item) => [item.id, item]),
    );
    const expenseMap = new Map(existingExpenses.map((item) => [item.id, item]));
    const postMap = new Map(existingPosts.map((item) => [item.id, item]));
    const photoMap = new Map(existingPhotos.map((item) => [item.id, item]));
    const commentMap = new Map(existingComments.map((item) => [item.id, item]));

    for (const user of space.users) {
      const { record: existing, deleted } = await resolveExistingRecord(
        userCollection,
        userMap,
        user.id,
      );

      if (deleted) {
        continue;
      }

      if (existing) {
        await existing.update((row) => {
          row.nickname = user.nickname;
          assignTimestamps(row, user.created_at, user.updated_at);
        });
        continue;
      }

      const created = await userCollection.create((row) => {
        assignModelId(row, user.id);
        row.nickname = user.nickname;
        assignTimestamps(row, user.created_at, user.updated_at);
      });
      userMap.set(created.id, created);
    }

    const { record: existingSpace, deleted: deletedSpace } =
      await resolveExistingRecord(spaceCollection, spaceMap, space.space.id);
    if (deletedSpace) {
      return;
    }

    if (existingSpace) {
      await existingSpace.update((row) => {
        row.name = space.space.name;
        assignTimestamps(row, space.space.created_at, space.space.updated_at);
      });
    } else {
      const created = await spaceCollection.create((row) => {
        assignModelId(row, space.space.id);
        row.name = space.space.name;
        assignTimestamps(row, space.space.created_at, space.space.updated_at);
      });
      spaceMap.set(created.id, created);
    }

    const activeSpaceMemberIds = new Set(
      space.spaceMembers.map((item) => item.id),
    );
    for (const member of space.spaceMembers) {
      const { record: existing, deleted } = await resolveExistingRecord(
        spaceMemberCollection,
        spaceMemberMap,
        member.id,
      );

      if (deleted) {
        continue;
      }

      if (existing) {
        await existing.update((row) => {
          row.spaceId = member.space_id;
          row.userId = member.user_id;
          assignTimestamps(row, member.created_at, member.updated_at);
        });
        continue;
      }

      const created = await spaceMemberCollection.create((row) => {
        assignModelId(row, member.id);
        row.spaceId = member.space_id;
        row.userId = member.user_id;
        assignTimestamps(row, member.created_at, member.updated_at);
      });
      spaceMemberMap.set(created.id, created);
    }

    for (const [memberId, existingMember] of spaceMemberMap.entries()) {
      if (existingMember.spaceId !== space.space.id) {
        continue;
      }
      if (activeSpaceMemberIds.has(memberId)) {
        continue;
      }
      await existingMember.markAsDeleted();
      spaceMemberMap.delete(memberId);
    }

    for (const expense of space.expenses) {
      const { record: existing, deleted } = await resolveExistingRecord(
        expenseCollection,
        expenseMap,
        expense.id,
      );

      if (expense.deleted_at) {
        if (existing) {
          await existing.markAsDeleted();
          expenseMap.delete(expense.id);
        }
        continue;
      }

      if (deleted) {
        continue;
      }

      if (existing) {
        await existing.update((row) => {
          row.spaceId = expense.space_id;
          row.payerId = expense.payer_id;
          row.amount = Math.round(expense.amount * 100);
          row.description = expense.description;
          assignTimestamps(row, expense.created_at, expense.updated_at);
        });
        continue;
      }

      const created = await expenseCollection.create((row) => {
        assignModelId(row, expense.id);
        row.spaceId = expense.space_id;
        row.payerId = expense.payer_id;
        row.amount = Math.round(expense.amount * 100);
        row.description = expense.description;
        assignTimestamps(row, expense.created_at, expense.updated_at);
      });
      expenseMap.set(created.id, created);
    }

    for (const post of space.posts) {
      const { record: existing, deleted } = await resolveExistingRecord(
        postCollection,
        postMap,
        post.id,
      );

      if (post.deleted_at) {
        if (existing) {
          await existing.markAsDeleted();
          postMap.delete(post.id);
        }
        continue;
      }

      if (deleted) {
        continue;
      }

      if (existing) {
        await existing.update((row) => {
          row.spaceId = post.space_id;
          assignTimestamps(row, post.created_at, post.updated_at);
        });
        continue;
      }

      const created = await postCollection.create((row) => {
        assignModelId(row, post.id);
        row.spaceId = post.space_id;
        assignTimestamps(row, post.created_at, post.updated_at);
      });
      postMap.set(created.id, created);
    }

    for (const photo of space.photos) {
      const { record: existing, deleted } = await resolveExistingRecord(
        photoCollection,
        photoMap,
        photo.id,
      );

      if (photo.deleted_at) {
        if (existing) {
          await existing.markAsDeleted();
          photoMap.delete(photo.id);
        }
        continue;
      }

      // 如果本地已经删掉了这张图，就不要再从 mock 里重建，避免复活旧图片。
      if (deleted) {
        continue;
      }

      if (existing) {
        await existing.update((row) => {
          row.spaceId = photo.space_id;
          row.uploaderId = photo.uploader_id;
          row.localUri = photo.local_uri;
          row.remoteUrl = photo.remote_url;
          row.postId = photo.post_id;
          row.shotedAt = new Date(photo.shoted_at);
          assignTimestamps(row, photo.created_at, photo.updated_at);
        });
        continue;
      }

      const created = await photoCollection.create((row) => {
        assignModelId(row, photo.id);
        row.spaceId = photo.space_id;
        row.uploaderId = photo.uploader_id;
        row.localUri = photo.local_uri;
        row.remoteUrl = photo.remote_url;
        row.postId = photo.post_id;
        row.shotedAt = new Date(photo.shoted_at);
        assignTimestamps(row, photo.created_at, photo.updated_at);
      });
      photoMap.set(created.id, created);
    }

    for (const comment of space.comments) {
      const { record: existing, deleted } = await resolveExistingRecord(
        commentCollection,
        commentMap,
        comment.id,
      );

      if (comment.deleted_at) {
        if (existing) {
          await existing.markAsDeleted();
          commentMap.delete(comment.id);
        }
        continue;
      }

      if (deleted) {
        continue;
      }

      if (existing) {
        await existing.update((row) => {
          row.spaceId = comment.space_id;
          row.content = comment.content;
          row.commenterId = comment.commenter_id;
          row.postId = comment.post_id;
          row.commentedAt = new Date(comment.commented_at);
          assignTimestamps(row, comment.created_at, comment.updated_at);
        });
        continue;
      }

      const created = await commentCollection.create((row) => {
        assignModelId(row, comment.id);
        row.spaceId = comment.space_id;
        row.content = comment.content;
        row.commenterId = comment.commenter_id;
        row.postId = comment.post_id;
        row.commentedAt = new Date(comment.commented_at);
        assignTimestamps(row, comment.created_at, comment.updated_at);
      });
      commentMap.set(created.id, created);
    }
  });
}
