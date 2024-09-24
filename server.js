const path = require("path");
const http = require("http");
const express = require("express");
const socketio = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const formatMessage = require("./include/messages");
const {
  userJoin,
  getCurrentUser,
  userLeave,
  getRoomUsers,
} = require("./include/users");

const Groq = require('groq-sdk');

const groq = new Groq({
  apiKey: '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',
  dangerouslyAllowBrowser: true // Enable browser usage (not recommended for production)
});

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = socketio(server);

// Set static folder
app.use(express.static(path.join(__dirname, "public")));

// Set up SQLite database
const dbPath = path.join(__dirname, "messages.db");
const db = new sqlite3.Database(dbPath);

// Create tables for messages and users if they don't already exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    time TEXT NOT NULL,
    ai_response TEXT DEFAULT NULL -- Add column for AI response
  )`, (err) => {
    if (err) {
      console.error("Error creating messages table:", err.message);
    } else {
      console.log("Messages table created or already exists.");
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    room TEXT NOT NULL
  )`, (err) => {
    if (err) {
      console.error("Error creating users table:", err.message);
    } else {
      console.log("Users table created or already exists.");
    }
  });
});

// Chat bot name
const botName = "Bot";
const AI_ROOM_NAME = "AI Chat Bot"; // Define AI chat room name

// Run when client connects
io.on("connection", (socket) => {
  console.log('A user connected');

  // Join a room
  socket.on("joinRoom", ({ username, room }) => {
    const user = userJoin(socket.id, username, room);
    socket.join(user.room);

    // Insert user into the database
    db.run(`INSERT INTO users (id, username, room) VALUES (?, ?, ?)`,
      [user.id, user.username, user.room],
      (err) => {
        if (err) {
          console.error("Error inserting user into database:", err.message);
        }
      }
    );

    // Welcome current user
    socket.emit("message", formatMessage(botName, "Welcome to ChatHaven!"));

    // Broadcast when a user connects
    socket.broadcast
      .to(user.room)
      .emit("message", formatMessage(botName, `${user.username} has joined the chat`));

    // Send users and room info
    io.to(user.room).emit("roomUsers", {
      room: user.room,
      users: getRoomUsers(user.room),
    });
  });

  // Listen for chat messages
  socket.on("chatMessage", (msg) => {
    const user = getCurrentUser(socket.id);
    const message = formatMessage(user.username, msg);

    // Store the message in the database
    db.run(`INSERT INTO messages (username, text, time) VALUES (?, ?, ?)`, 
      [user.username, message.text, message.time], 
      (err) => {
        if (err) {
          console.error("Error inserting message into database:", err.message);
        }
      }
    );

    // Emit the message to the room
    io.to(user.room).emit("message", message);
  });

  // Listen for typing event
  socket.on("typing", () => {
    const user = getCurrentUser(socket.id);
    socket.broadcast.to(user.room).emit("typing", user.username);
  });

  // Listen for stopTyping event
  socket.on("stopTyping", () => {
    const user = getCurrentUser(socket.id);
    socket.broadcast.to(user.room).emit("stopTyping", user.username);
  });

  // Runs when client disconnects
  socket.on("disconnect", () => {
    const user = userLeave(socket.id);
    if (user) {
      // Remove user from the database
      db.run(`DELETE FROM users WHERE id = ?`, [user.id], (err) => {
        if (err) {
          console.error("Error removing user from database:", err.message);
        }
      });

      io.to(user.room).emit(
        "message",
        formatMessage(botName, `${user.username} has left the chat`)
      );

      // Send updated user list
      io.to(user.room).emit("roomUsers", {
        room: user.room,
        users: getRoomUsers(user.room),
      });
    }
  });

  // Listen for AI messages
  socket.on("aiMessage", async (msg) => {
    const user = getCurrentUser(socket.id);
    
    // Check if the user is in the AI Chat Bot room
    if (user.room === AI_ROOM_NAME) {
      // Use Groq to get AI response
      try {
          const chatCompletion = await groq.chat.completions.create({
              "messages": [
                  {
                      "role": "user",
                      "content": msg // Pass the user message to the AI
                  }
              ],
              "model": "llama3-8b-8192",
              "temperature": 1,
              "max_tokens": 1024,
              "top_p": 1,
              "stream": false // Set to true if you want streaming responses
          });

          // Emit the AI response back to the room
          const aiResponse = chatCompletion.choices[0].message.content;
          
          // Store the AI response in the database
          db.run(`INSERT INTO messages (username, text, time, ai_response) VALUES (?, ?, ?, ?)`, 
            ["AI", msg, new Date().toISOString(), aiResponse], 
            (err) => {
              if (err) {
                console.error("Error inserting AI message into database:", err.message);
              }
            }
          );

          io.to(user.room).emit("message", formatMessage("AI", aiResponse)); // Format the AI response
      } catch (error) {
          console.error("Error fetching AI response:", error);
      }
    }
  });

  // Listen for data updates
  socket.on('updateData', (data) => {
    // Broadcast the update to all clients
    socket.broadcast.emit('dataUpdated', data);
  });
});

// Set the port
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
