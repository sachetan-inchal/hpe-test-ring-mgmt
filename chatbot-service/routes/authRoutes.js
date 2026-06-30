import express from 'express';
import { registerUser, loginUser, logoutUser, updateUserProfile, listUsers, adminUpdateUser } from '../controllers/authController.js';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/logout', logoutUser);
router.post('/update', updateUserProfile);
router.get('/users', listUsers);
router.post('/users/update', adminUpdateUser);

export default router;
