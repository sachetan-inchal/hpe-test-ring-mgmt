import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    default: ''
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['team_member', 'manager', 'director', 'senior_manager', 'admin'],
    default: 'team_member'
  },
  team: {
    type: String,
    default: 'team-alpha'
  },
  cluster: {
    type: String,
    default: 'cluster-1'
  },
  managedTeams: {
    type: [String],
    default: []
  },
  managedClusters: {
    type: [String],
    default: []
  }
}, { timestamps: true });

// Hash password before saving
userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method to compare password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);
export default User;
