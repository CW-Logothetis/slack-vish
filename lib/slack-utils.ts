import { WebClient } from '@slack/web-api';
import { ModelMessage } from 'ai'
import crypto from 'crypto'

const signingSecret = process.env.SLACK_SIGNING_SECRET!

export const client = new WebClient(process.env.SLACK_BOT_TOKEN);

// See https://api.slack.com/authentication/verifying-requests-from-slack
export async function isValidSlackRequest({
  request,
  rawBody,
}: {
  request: Request
  rawBody: string
}) {
  // console.log('Validating Slack request')
  const timestamp = request.headers.get('X-Slack-Request-Timestamp')
  const slackSignature = request.headers.get('X-Slack-Signature')
  // console.log(timestamp, slackSignature)

  if (!timestamp || !slackSignature) {
    console.log('Missing timestamp or signature')
    return false
  }

  // Prevent replay attacks on the order of 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 60 * 5) {
    console.log('Timestamp out of range')
    return false
  }

  const base = `v0:${timestamp}:${rawBody}`
  const hmac = crypto
    .createHmac('sha256', signingSecret)
    .update(base)
    .digest('hex')
  const computedSignature = `v0=${hmac}`

  // Prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(computedSignature),
    Buffer.from(slackSignature)
  )
}

export const verifyRequest = async ({
  requestType,
  request,
  rawBody,
}: {
  requestType: string;
  request: Request;
  rawBody: string;
}) => {
  const validRequest = await isValidSlackRequest({ request, rawBody });
  if (!validRequest || requestType !== "event_callback") {
    return new Response("Invalid request", { status: 400 });
  }
};

export const updateStatusUtil = (channel: string, thread_ts: string) => {
  return async (status: string) => {
    await client.assistant.threads.setStatus({
      channel_id: channel,
      thread_ts: thread_ts,
      status: status,
    });
  };
};

export async function getThread(
  channel_id: string,
  thread_ts: string,
  botUserId: string,
): Promise<ModelMessage[]> {
  const { messages } = await client.conversations.replies({
    channel: channel_id,
    ts: thread_ts,
    limit: 50,
  });

  // Ensure we have messages

  if (!messages) throw new Error("No messages found in thread");

  const result = messages
    .map((message) => {
      const isBot = !!message.bot_id;
      if (!message.text) return null;

      // For app mentions, remove the mention prefix
      // For IM messages, keep the full text
      let content = message.text;
      if (!isBot && content.includes(`<@${botUserId}>`)) {
        content = content.replace(`<@${botUserId}> `, "");
      }

      return {
        role: isBot ? "assistant" : "user",
        content: content,
      } as ModelMessage;
    })
    .filter((msg): msg is ModelMessage => msg !== null);

  return result;
}

export const getBotId = async () => {
  const { user_id: botUserId } = await client.auth.test();

  if (!botUserId) {
    throw new Error("botUserId is undefined");
  }
  return botUserId;
};

export async function getChannelHistory(
  channel_id: string,
  botUserId: string,
): Promise<ModelMessage[]> {
  try {
    // Fetch the last 100 messages from the channel
    const { messages: topLevelMessages } = await client.conversations.history({
      channel: channel_id,
      limit: 100,
    });

    if (!topLevelMessages || topLevelMessages.length === 0) {
      console.log("No messages found in channel");
      return [];
    }

    // Use a Set to track message timestamps and avoid duplicates
    const seenTimestamps = new Set<string>();
    const allMessages: ModelMessage[] = [];

    // Process messages in reverse to get chronological order
    for (const message of topLevelMessages.reverse()) {
      // Add top-level message
      if (message.text && !message.subtype && message.ts) {
        if (!seenTimestamps.has(message.ts)) {
          const isBot = !!message.bot_id;
          let content = message.text;
          
          // Remove bot mention prefix for non-bot messages
          if (!isBot && content.includes(`<@${botUserId}>`)) {
            content = content.replace(`<@${botUserId}> `, "");
          }

          allMessages.push({
            role: isBot ? "assistant" : "user",
            content: content,
          } as ModelMessage);
          seenTimestamps.add(message.ts);
        }
      }

      // If message has replies (is a thread), fetch them
      if (message.thread_ts && message.reply_count && message.reply_count > 0) {
        try {
          const { messages: threadMessages } = await client.conversations.replies({
            channel: channel_id,
            ts: message.thread_ts,
            limit: 100,
          });

          if (threadMessages) {
            // Skip the first message (it's the parent message we already added)
            for (const threadMessage of threadMessages.slice(1)) {
              if (threadMessage.text && !(threadMessage as any).subtype && threadMessage.ts) {
                if (!seenTimestamps.has(threadMessage.ts)) {
                  const isBot = !!threadMessage.bot_id;
                  let content = threadMessage.text;
                  
                  // Remove bot mention prefix for non-bot messages
                  if (!isBot && content.includes(`<@${botUserId}>`)) {
                    content = content.replace(`<@${botUserId}> `, "");
                  }

                  allMessages.push({
                    role: isBot ? "assistant" : "user",
                    content: content,
                  } as ModelMessage);
                  seenTimestamps.add(threadMessage.ts);
                }
              }
            }
          }
        } catch (error) {
          console.error(`Error fetching thread for message ${message.thread_ts}:`, error);
          // Continue processing other messages if thread fetch fails
        }
      }
    }

    return allMessages;
  } catch (error) {
    console.error("Error in getChannelHistory:", error);
    throw error;
  }
}
