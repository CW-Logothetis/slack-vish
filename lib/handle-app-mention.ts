import { AppMentionEvent } from "@slack/web-api";
import { client, getThread } from "./slack-utils";
import { generateResponse } from "./generate-response";

const updateStatusUtil = async (
  initialStatus: string,
  event: AppMentionEvent,
) => {
  const initialMessage = await client.chat.postMessage({
    channel: event.channel,
    thread_ts: event.thread_ts ?? event.ts,
    text: initialStatus,
  });

  if (!initialMessage || !initialMessage.ts)
    throw new Error("Failed to post initial message");

  const updateMessage = async (status: string) => {
    await client.chat.update({
      channel: event.channel,
      ts: initialMessage.ts as string,
      text: status,
    });
  };
  return updateMessage;
};

export async function handleNewAppMention(
  event: AppMentionEvent,
  botUserId: string,
) {
  console.log("Handling app mention");
  if (event.bot_id || event.bot_id === botUserId || event.bot_profile) {
    console.log("Skipping app mention");
    return;
  }
  console.log(event)

  const { thread_ts, channel } = event;
  const updateMessage = await updateStatusUtil("is thinking...", event);

  try {
    if (thread_ts) {
      console.log("Getting thread");
      const messages = await getThread(channel, thread_ts, botUserId);
      const result = await generateResponse(messages, updateMessage);
      await updateMessage(result);
    } else {
      console.log("Generating response");
      const result = await generateResponse(
        [{ role: "user", content: event.text }],
        updateMessage,
      );
      await updateMessage(result);
    }
  } catch (error) {
    console.error("Error in handleNewAppMention:", error);
    await updateMessage(`Error: Failed to generate response. ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
