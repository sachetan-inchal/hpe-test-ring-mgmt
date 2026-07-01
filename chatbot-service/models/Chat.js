import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'model'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  agentSteps: {
    type: Array,
    default: []
  }
}, { _id: false });

const chatSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    default: 'New Chat'
  },
  messages: [messageSchema]
}, { timestamps: true });

const Chat = mongoose.model('Chat', chatSchema);
export default Chat;
