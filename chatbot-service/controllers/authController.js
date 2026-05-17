import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

export const registerUser = async (req, res) => {
  try {
    const {
      username,
      password,
      team = 'team-alpha',
      cluster = 'cluster-1',
      managedTeams = [],
      managedClusters = []
    } = req.body;
    let role = req.body.role || 'team_member';
    if (username && username.toLowerCase().includes('admin')) {
      role = 'admin';
    }
    const userExists = await User.findOne({ username });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }
    const user = await User.create({
      username,
      password,
      role,
      team,
      cluster,
      managedTeams: Array.isArray(managedTeams) ? managedTeams : [],
      managedClusters: Array.isArray(managedClusters) ? managedClusters : []
    });
    if (user) {
      res.status(201).json({
        _id: user._id,
        username: user.username,
        role: user.role,
        team: user.team,
        cluster: user.cluster,
        managedTeams: user.managedTeams || [],
        managedClusters: user.managedClusters || [],
        token: generateToken(user._id),
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (user && (await user.matchPassword(password))) {
      res.json({
        _id: user._id,
        username: user.username,
        role: user.role || 'team_member',
        team: user.team || 'team-alpha',
        cluster: user.cluster || 'cluster-1',
        managedTeams: user.managedTeams || [],
        managedClusters: user.managedClusters || [],
        token: generateToken(user._id),
      });
    } else {
      res.status(401).json({ message: 'Invalid username or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const logoutUser = (req, res) => {
  res.json({ message: 'Logged out successfully' });
};
