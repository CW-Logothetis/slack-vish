import type {
  AssistantThreadStartedEvent,
  GenericMessageEvent,
} from "@slack/web-api";
import { client, getThread, updateStatusUtil, getChannelHistory } from "./slack-utils";
import { generateResponse } from "./generate-response";

export async function assistantThreadMessage(
  event: AssistantThreadStartedEvent,
) {
  const { channel_id, thread_ts } = event.assistant_thread;
  console.log(`Thread started: ${channel_id} ${thread_ts}`);
  console.log(JSON.stringify(event));

  await client.chat.postMessage({
    channel: channel_id,
    thread_ts: thread_ts,
    text: "Hello, I'm an AI assistant built with the AI SDK by Vercel!",
  });

  await client.assistant.threads.setSuggestedPrompts({
    channel_id: channel_id,
    thread_ts: thread_ts,
    prompts: [
      {
        title: "Get the weather",
        message: "What is the current weather in London?",
      },
      {
        title: "Get the news",
        message: "What is the latest Premier League news from the BBC?",
      },
    ],
  });
}

export async function handleNewAssistantMessage(
  event: GenericMessageEvent,
  botUserId: string,
) {
  if (
    event.bot_id ||
    event.bot_id === botUserId ||
    event.bot_profile ||
    !event.thread_ts
  )
    return;

  const { thread_ts, channel } = event;
  const updateStatus = updateStatusUtil(channel, thread_ts);
  updateStatus("is thinking...");

  const messages = await getThread(channel, thread_ts, botUserId);
  const result = await generateResponse(messages, updateStatus);

  await client.chat.postMessage({
    channel: channel,
    thread_ts: thread_ts,
    text: result,
    unfurl_links: false,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: result,
        },
      },
    ],
  });

  updateStatus("");
}

export async function handleFeedbackChannelMessage(
  event: GenericMessageEvent,
  botUserId: string,
) {
  console.log("Handling feedback channel message");
  
  const { channel, ts, text } = event;
  
  if (!text) {
    console.log("No text in message, skipping");
    return;
  }

  try {
    const disclaimer = "IMPORTANT: I'm a bot. I hoped I helped, but one of the team will still reply ASAP...";
    
    // Post initial thinking status
    const initialMessage = await client.chat.postMessage({
      channel: channel,
      thread_ts: ts,
      text: "... thinking...I'll try to give a quick answer, but I'm not the Real Slim Vi-shady so I might be wrong... thinking...",
    });

    if (!initialMessage || !initialMessage.ts) {
      throw new Error("Failed to post initial message");
    }

    // Get channel history for context
    const channelHistory = await getChannelHistory(channel, botUserId);
    
    // Generate LLM response with channel history as context
    const llmResponse = await generateResponse(channelHistory);

    // Combine disclaimer with LLM response
    const fullResponse = `${llmResponse}\n\n${disclaimer}`;

    // Update with final response
    await client.chat.update({
      channel: channel,
      ts: initialMessage.ts as string,
      text: fullResponse,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: fullResponse,
          },
        },
      ],
    });

    console.log("Feedback channel message handled successfully");
  } catch (error) {
    console.error("Error in handleFeedbackChannelMessage:", error);
    await client.chat.postMessage({
      channel: channel,
      thread_ts: ts,
      text: `Error: Failed to generate response. ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}
