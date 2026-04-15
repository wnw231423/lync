import * as FileSystem from "expo-file-system/legacy";

const EXPENSE_SPLIT_DIR = "expense-splits";

function getExpenseSplitFilePath(spaceId: string) {
  if (!FileSystem.documentDirectory) {
    return "";
  }

  const cleanSpaceId = spaceId.trim();
  if (!cleanSpaceId) {
    return "";
  }

  const baseDir = FileSystem.documentDirectory.endsWith("/")
    ? FileSystem.documentDirectory
    : `${FileSystem.documentDirectory}/`;
  return `${baseDir}${EXPENSE_SPLIT_DIR}/${cleanSpaceId}.json`;
}

async function ensureExpenseSplitDir(spaceId: string) {
  const filePath = getExpenseSplitFilePath(spaceId);
  if (!filePath) {
    return;
  }

  const normalized = filePath.replace(/\\/g, "/");
  const lastSlashIndex = normalized.lastIndexOf("/");
  if (lastSlashIndex < 0) {
    return;
  }

  const parentDir = normalized.slice(0, lastSlashIndex);
  const info = await FileSystem.getInfoAsync(parentDir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(parentDir, { intermediates: true });
  }
}

function normalizeParticipantIds(participantIds: string[]) {
  return Array.from(
    new Set(participantIds.map((item) => item.trim()).filter(Boolean)),
  );
}

export type ExpenseSplitMap = Record<string, string[]>;

export async function readExpenseSplitSelections(spaceId: string) {
  const filePath = getExpenseSplitFilePath(spaceId);
  if (!filePath) {
    return {} as ExpenseSplitMap;
  }

  const info = await FileSystem.getInfoAsync(filePath);
  if (!info.exists) {
    return {} as ExpenseSplitMap;
  }

  try {
    const raw = await FileSystem.readAsStringAsync(filePath);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: ExpenseSplitMap = {};
    for (const [expenseId, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) {
        continue;
      }
      result[expenseId] = normalizeParticipantIds(
        value.filter((item): item is string => typeof item === "string"),
      );
    }
    return result;
  } catch {
    return {} as ExpenseSplitMap;
  }
}

async function writeExpenseSplitSelections(
  spaceId: string,
  splitMap: ExpenseSplitMap,
) {
  const filePath = getExpenseSplitFilePath(spaceId);
  if (!filePath) {
    return;
  }

  await ensureExpenseSplitDir(spaceId);
  await FileSystem.writeAsStringAsync(
    filePath,
    JSON.stringify(splitMap, null, 2),
  );
}

export async function saveExpenseSplitSelection(params: {
  spaceId: string;
  expenseId: string;
  participantIds: string[];
}) {
  const cleanSpaceId = params.spaceId.trim();
  const cleanExpenseId = params.expenseId.trim();
  if (!cleanSpaceId || !cleanExpenseId) {
    return;
  }

  const splitMap = await readExpenseSplitSelections(cleanSpaceId);
  splitMap[cleanExpenseId] = normalizeParticipantIds(params.participantIds);
  await writeExpenseSplitSelections(cleanSpaceId, splitMap);
}

export async function deleteExpenseSplitSelection(
  spaceId: string,
  expenseId: string,
) {
  const cleanSpaceId = spaceId.trim();
  const cleanExpenseId = expenseId.trim();
  if (!cleanSpaceId || !cleanExpenseId) {
    return;
  }

  const splitMap = await readExpenseSplitSelections(cleanSpaceId);
  delete splitMap[cleanExpenseId];
  await writeExpenseSplitSelections(cleanSpaceId, splitMap);
}
