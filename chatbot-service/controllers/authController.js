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
      name = '',
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
      name,
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
        name: user.name || '',
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
        name: user.name || '',
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

export const updateUserProfile = async (req, res) => {
  try {
    const { userId, team, managedTeams } = req.body;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (team !== undefined) user.team = team;
    if (managedTeams !== undefined) {
      user.managedTeams = Array.isArray(managedTeams) ? managedTeams : (managedTeams ? [managedTeams] : []);
    }
    await user.save();
    res.json({
      _id: user._id,
      username: user.username,
      name: user.name || '',
      role: user.role,
      team: user.team,
      cluster: user.cluster,
      managedTeams: user.managedTeams || [],
      managedClusters: user.managedClusters || [],
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const listUsers = async (req, res) => {
  try {
    const users = await User.find({}, '-password'); // Exclude password hashes
    res.json({ users });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const adminUpdateUser = async (req, res) => {
  try {
    const { userId, role, team, managedTeams } = req.body;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (role !== undefined) user.role = role;
    if (team !== undefined) user.team = team;
    if (managedTeams !== undefined) {
      user.managedTeams = Array.isArray(managedTeams) ? managedTeams : (managedTeams ? [managedTeams] : []);
    }
    await user.save();
    res.json({ status: 'ok', user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
