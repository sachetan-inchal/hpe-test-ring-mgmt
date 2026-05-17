import mongoose from 'mongoose';

const MONGO_URI = "mongodb+srv://hpeuser:hpeuserpassword@cluster0.2xwbcdn.mongodb.net/?appName=Cluster0";

const UserSchema = new mongoose.Schema({
  username: String,
  role: String,
  team: String,
  cluster: String,
  managedTeams: [String],
  managedClusters: [String],
});

const User = mongoose.model('User', UserSchema);

async function run() {
  await mongoose.connect(MONGO_URI);
  const users = await User.find({});
  console.log("Total users:", users.length);
  for (const u of users) {
    console.log(`User: ${u.username}, Role: ${u.role}, Team: ${u.team}, Cluster: ${u.cluster}, ManagedTeams: ${u.managedTeams}, ManagedClusters: ${u.managedClusters}`);
  }
  await mongoose.disconnect();
}

run().catch(console.error);
