import { buildHttpErrorMessage, getApiBaseUrl } from "@/sync/api";

type BindSpaceParams = {
  userId: string;
  spaceId: string;
};

export async function bindSpaceOnServer({ userId, spaceId }: BindSpaceParams) {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/spaces`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": userId,
    },
    body: JSON.stringify({
      space_id: spaceId,
    }),
  });

  if (!response.ok) {
    throw new Error(await buildHttpErrorMessage("Bind space", response));
  }
}
