import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export const generateAIResponse = async (history, currentPrompt, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      // Convert history format to gemini format
      const formattedHistory = history.map(msg => ({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));

      const chat = model.startChat({
        history: formattedHistory,
        generationConfig: {
          maxOutputTokens: 2048,
        },
      });

      const result = await chat.sendMessage(currentPrompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error(`Gemini API Error (Attempt ${attempt}/${maxRetries}):`, error);
      
      // If it's the last attempt, throw the error
      if (attempt === maxRetries) {
        throw new Error(`Failed to generate AI response after ${maxRetries} attempts: ${error.message}`);
      }
      
      // If it's a rate limit or service unavailable error, wait before retrying
      if (error.message.includes('503') || error.message.includes('429') || error.message.includes('service unavailable')) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10 seconds
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // For other errors, don't retry
        throw new Error(`Failed to generate AI response: ${error.message}`);
      }
    }
  }
};
