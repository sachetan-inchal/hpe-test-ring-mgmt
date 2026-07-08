# HPE SAN Ring Management — Local Desktop Setup Guide

This guide walks you through setting up the databases, dependencies, and running the HPE SAN Ring Management Tool locally **without Docker**, using **Neo4j Desktop** and **MongoDB Compass**.

---

## 🛠️ Step 1: Install Core Prerequisites

Ensure the following tools are installed on your system:
1. **Python 3.10+** (Ensure you check the box **"Add Python to PATH"** during installation).
2. **Node.js (LTS Version)** (Includes `npm`).

---

## 💾 Step 2: Database Setup

### A. MongoDB Community Server & Compass
1. Download and install [MongoDB Enterprise Server](https://www.mongodb.com/try/download/enterprise) (runs automatically as a background service). 
2.
3. Download and install [MongoDB Compass](https://www.mongodb.com/products/tools/compass) to view collections.
4. Open MongoDB Compass, click **Connect** to connect to default `mongodb://localhost:27017`.
5. No usernames/passwords are needed for a default local MongoDB setup.

### B. Neo4j Desktop
1. Download and install [Neo4j Desktop](https://neo4j.com/download/).
2. Open Neo4j Desktop and create a new **Project**.
3. Inside the project, click **Add** ➡️ **Local DBMS**.
4. Choose **version 5.x** (or 4.x), name it `HPE SAN Graph`, and set the password to: `hpe_san_password`.
5. Click **Create** and wait for the database to initialize.
6. Click **Start** to run the DBMS. It will now listen on `bolt://localhost:7687` and `http://localhost:7474`.

---

## ⚙️ Step 3: Configure Environment Variables

1. Navigate to the project root folder.
2. Duplicate `.env.example` and rename it to `.env`.
3. Open `.env` in a text editor and ensure the database settings match your local instances:
   ```env
   # MongoDB Connection
   MONGO_URI=mongodb://localhost:27017/hpe-san-tool

   # Neo4j Connection
   NEO4J_URI=bolt://localhost:7687
   NEO4J_USER=neo4j
   NEO4J_PASS=hpe_san_password  # Must match the password set in Neo4j Desktop!
   ```

---

## 📦 Step 4: Install Dependencies

Open a terminal or PowerShell in the **project root folder** and execute the following:

1. **Python packages**:
   ```powershell
   pip install -r requirements.txt
   ```

2. **Root Node.js packages**:
   ```powershell
   npm install
   ```

3. **Dashboard UI packages**:
   ```powershell
   cd dashboard
   npm install
   cd ..
   ```

4. **Chatbot Service packages**:
   ```powershell
   cd chatbot-service
   npm install
   cd ..
   ```

---

## 🚀 Step 5: Start the Application

You can start all services simultaneously with a single command. In the **project root folder**, run:

```powershell
npm start
```

This single command automatically orchestrates:
- **Python Simulator** running on port `5001`.
- **Master API** running on port `5005`.
- **Chatbot Node Backend** running on port `5000`.
- **Vite React UI** running on port `3000`.

---

## 🔍 Step 6: Verify and Connect

Open your browser and navigate to:
- **Vite React UI**: [http://localhost:3000](http://localhost:3000) (Click **Sign Up** to create an Admin account).
- **Neo4j Browser**: [http://localhost:7474](http://localhost:7474) (Login: `neo4j` / `hpe_san_password`).
- **Master API Explorer**: [http://localhost:5005/tester](http://localhost:5005/tester) (Useful for quick API checks).
