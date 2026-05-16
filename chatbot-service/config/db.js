import mongoose from 'mongoose';

const connectDB = async () => {
  console.log(`Attempting to connect to MongoDB: ${process.env.MONGO_URI}`);
  let retries = 10;
  while (retries > 0) {
    try {
      const conn = await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
      });
      console.log(`MongoDB Connected: ${conn.connection.host}`);
      return;
    } catch (error) {
      retries--;
      console.error(`MongoDB connection failed. Retrying... (${retries} left)`);
      if (retries === 0) {
        console.error(`\n${'='.repeat(60)}`);
        console.error(`DATABASE CONNECTION ERROR: ${error.message}`);
        console.error(`${'='.repeat(60)}`);
        console.error(`(Backend will continue running without DB connection)`);
      } else {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
};

export default connectDB;
