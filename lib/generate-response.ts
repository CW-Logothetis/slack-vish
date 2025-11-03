import { google } from '@ai-sdk/google';
import { generateText, ModelMessage } from 'ai';
import { expertFinderManual } from '../docs/expert-finder-user-manual';

export const generateResponse = async (
  messages: ModelMessage[],
  updateStatus?: (status: string) => void,
) => {
  console.log(messages)
  try {
    const { text } = await generateText({
      model: google('gemini-2.5-flash'),
      system: `You are a Slack bot assistant. Keep your responses concise and to the point.
      - Users generally report bugs or provide feedback on the search agent feature. They sometimes ask questions about the search agent feature.
      - First check the last 100 messsages from the feedback channel including all thread discussions.
      - If you find a previous answer in the 100 messages for questions, bug reports or feedback, then repeat the previous response.
      - If you cannot find an answer in the conversation history then check the docs in ${expertFinderManual}.
      - If you can't find an answer in the 100 messages or the docs, then inform the user that someone in the team will get back to them as soon as possible.
      - Do not tag users.
      - Current date is: ${new Date().toISOString().split('T')[0]},
      - **IMPORTANT**: use the conversation history, then the docs, to see if you can answer the question or provide the information requested.
      - If you can't find the information requested in the conversation history or the docs, you MUST inform the user that: 
      "I can't find the answer so please wait for someone in the team to get back to you as soon as possible."`,
      messages,
    });

    // Convert markdown to Slack mrkdwn format
    return text.replace(/\[(.*?)\]\((.*?)\)/g, '<$2|$1>').replace(/\*\*/g, '*');
  } catch (error) {
    console.error("Error in generateResponse:", error);
    // Return a fallback response when LLM fails
    return "I encountered an issue processing your request. Someone from the team will get back to you shortly.";
  }
};

