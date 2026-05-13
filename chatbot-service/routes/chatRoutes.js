import express from 'express';
import { getRecentChats, getChatById, sendMessage, guestSendMessage } from '../controllers/chatController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.route('/guest-message').post(guestSendMessage);
router.route('/').get(protect, getRecentChats);
router.route('/message').post(protect, sendMessage);
router.route('/:id').get(protect, getChatById);

export default router;
