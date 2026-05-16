import mongoose from 'mongoose';

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 10s or infinite buffering
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`\n${'='.repeat(60)}`);
    console.error(`DATABASE CONNECTION ERROR: ${error.message}`);
    console.error(`${'='.repeat(60)}`);
    console.error(`1. Check if <db_password> in .env is correct.`);
    console.error(`2. Check if your IP is whitelisted in MongoDB Atlas (Network Access).`);
    console.error(`3. If using local Docker, ensure the mongo container is running.`);
    console.error(`${'='.repeat(60)}\n`);
    console.error(`(Backend will continue running without DB connection to allow testing)`);
  }
};

export default connectDB;
