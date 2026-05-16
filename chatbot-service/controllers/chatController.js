import Chat from '../models/Chat.js';
import { generateAIResponse } from '../utils/aiProvider.js';

export const getRecentChats = async (req, res) => {
  try {
    const chats = await Chat.find({ user: req.user._id })
      .select('-messages')
      .sort({ updatedAt: -1 });
    res.json(chats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getChatById = async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id);
    if (chat && chat.user.toString() === req.user._id.toString()) {
      res.json(chat);
    } else {
      res.status(404).json({ message: 'Chat not found or unauthorized' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const sendMessage = async (req, res) => {
  const { chatId, message } = req.body;
  try {
    let chat;
    if (chatId) {
      chat = await Chat.findById(chatId);
      if (!chat || chat.user.toString() !== req.user._id.toString()) {
        return res.status(404).json({ message: 'Chat not found' });
      }
    } else {
      chat = await Chat.create({
        user: req.user._id,
        title: message.substring(0, 30) + '...',
        messages: []
      });
    }

    const history = chat.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Add user message to DB
    chat.messages.push({ role: 'user', content: message });
    await chat.save();

    // Call Gemini API
    const aiResponseText = await generateAIResponse(history, message);

    // Add AI response to DB
    chat.messages.push({ role: 'model', content: aiResponseText });
    await chat.save();

    res.json({
      chatId: chat._id,
      title: chat.title,
      messages: chat.messages,
      response: aiResponseText
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const guestSendMessage = async (req, res) => {
  const { message, history = [] } = req.body;
  try {
    // Generate AI response without saving to DB
    const aiResponseText = await generateAIResponse(history, message);
    res.json({ role: 'model', content: aiResponseText });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
