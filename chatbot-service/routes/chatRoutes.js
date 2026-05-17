import express from 'express';
import { getRecentChats, getChatById, sendMessage, guestSendMessage, deleteChat } from '../controllers/chatController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.route('/guest-message').post(guestSendMessage);
router.route('/').get(protect, getRecentChats);
router.route('/message').post(protect, sendMessage);
router.route('/:id')
  .get(protect, getChatById)
  .delete(protect, deleteChat);

export default router;
