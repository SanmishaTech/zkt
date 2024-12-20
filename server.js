const express = require("express");
const moment = require("moment");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const fs = require("fs");
const { randomUUID } = require("crypto");

// Initialize Express app
const app = express();
let logger = console.log;

// Command queue for device operations
let deviceCommandQueue = new Map(); // Map to store commands for each device
let currentCommandIndex = new Map(); // Track current command index for each device

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

// Middleware to parse JSON and URL-encoded data
const upload = multer({ storage });

app.use(express.json()); // Parses application/json
app.use(express.urlencoded({ extended: true })); // Parses application/x-www-form-urlencoded

const dbPath = path.join(__dirname, "database.sqlite");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
  } else {
    console.log("Connected to SQLite database.");
  }
});

db.run(
  `CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  photo TEXT
);`,
  (err) => {
    if (err) {
      console.error("Error creating table:", err.message);
    }
  }
);

// Create commands table
db.run(
  `CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command TEXT NOT NULL,
  executed BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`,
  (err) => {
    if (err) {
      console.error("Error creating commands table:", err.message);
    }
  }
);

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

function convertToGMT(date) {
  if (!(date instanceof Date)) {
    throw new Error("Input must be a Date object");
  }

  return date.toUTCString(); // Converts the date to a human-readable GMT string
}

// Example usage:
const now = new Date();
logger(convertToGMT(now));

// Route to add a user with photo (as base64)
app.post("/users", upload.single("photo"), (req, res) => {
  console.log("Request Body:", req.body);
  console.log("Request File:", req.file);

  const { name, email } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: "Photo upload is required." });
  }

  // Convert photo to Base64
  const photoBuffer = fs.readFileSync(req.file.path);
  const photoBase64 = photoBuffer.toString("base64");

  const query = `INSERT INTO users (name, email, photo) VALUES (?, ?, ?)`;
  db.run(query, [name, email, photoBase64], function (err) {
    if (err) {
      res.status(400).json({ error: err.message });
    } else {
      fs.unlinkSync(req.file.path);
      res.status(201).json({
        message: "User added successfully",
        userId: this.lastID,
      });
    }
  });
});

// Route to fetch all users
app.get("/users", (req, res) => {
  const query = `SELECT * FROM users`;
  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(200).json(rows);
    }
  });
});

app.get("/iclock/cdata", (req, res) => {
  const now = new Date();

  try {
    logger("cdata endpoint hit");

    // Extract and validate the SN parameter
    console.log(req.query);
    console.log(req.headers);
    const { SN } = req.query;
    if (!SN || typeof SN !== "string") {
      logger("SN query parameter missing or invalid");
      return res
        .status(400)
        .send("Bad Request: SN is required and must be a string");
    }

    // Create the response body (use \n for line breaks)
    const body = `GET OPTION FROM:${SN}\nATTLOGStamp=None\nOPERLOGStamp=9999\nATTPHOTOStamp=None\nErrorDelay=30\nDelay=10\nTransTimes=00:00;14:05\nTransInterval=1\nTransFlag=TransData AttLog OpLog AttPhoto EnrollUser ChgUser EnrollFP\nChgFP UserPic\nTimeZone=8\nRealtime=0\nEncrypt=0`;

    const contentLength = Buffer.byteLength(body, "utf-8");

    // Prepare response headers
    res.set({
      "Content-Type": "text/plain",
      "Content-Length": contentLength,
      Pragma: "no-cache",
      Connection: "close",
      "Cache-Control": "no-store",
      Date: convertToGMT(now),
      Server: "nginx/1.6.0",
    });

    // Log response info
    logger("Response Size:", contentLength);
    logger("Response Date:", convertToGMT(now));

    // Send response
    return res.status(200).send(body);
  } catch (error) {
    logger("Error occurred:", error);
    return res.status(500).send("Internal Server Error");
  }
});

app.get("/users", (req, res) => {
  const query = `SELECT * FROM users`;
  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(200).json(rows);
    }
  });
});

app.get("/iclock/getrequest", (req, res) => {
  logger("getrequest endpoint hit");

  // Get next unexecuted command
  db.get(
    "SELECT id, command FROM commands WHERE executed = 0 ORDER BY created_at ASC LIMIT 1",
    [],
    (err, row) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).send("Error");
      }

      if (!row) {
        // No more commands, send OK
        return res.status(200).send("OK");
      }

      // Mark command as executed
      db.run(
        "UPDATE commands SET executed = 1 WHERE id = ?",
        [row.id],
        (updateErr) => {
          if (updateErr) {
            console.error("Error updating command status:", updateErr);
          }
        }
      );

      res.set({
        "Content-Type": "text/plain",
        Pragma: "no-cache",
        Connection: "close",
        "Cache-Control": "no-store",
        Date: convertToGMT(new Date()),
        Server: "nginx/1.6.0",
      });

      return res.status(200).send(row.command);
    }
  );
});

// POST endpoint for iclock/cdata
app.post("/iclock/cdata", (req, res) => {
  logger("POST cdata endpoint hit");
  console.log("Request body:", req.query);
  console.log("request Headers for post iclock", req.headers);

  // Always respond with OK
  res.status(200).send("OK");
});

// Endpoint to handle device command results
app.post("/iclock/devicecmd", (req, res) => {
  logger("devicecmd endpoint hit");
  const cmdStatus = req.headers["cmd-status"];
  console.log("Request body:", req.headers, cmdStatus);

  // console.log("Command execution status:", cmdStatus);
  console.log("Request body:", req.body);

  res.status(200).send("OK");
});

// API to queue new user registration with face
app.post("/api/register-user", upload.single("photo"), async (req, res) => {
  const { name, userPin, photo } = req.body;

  if (!req.file || !name || !userPin) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // Convert photo to Base64
    const photoBuffer = fs.readFileSync(req.file.path);
    const photoBase64 = photoBuffer.toString("base64");
    console.log(photo);

    // Create commands
    const commands = [
      `C:${new Date()}:DATA USER PIN=${userPin}\tName=${name}`,
      `C:${new Date()}:DATA UPDATE BIODATA PIN=${userPin}\tFID=1\tNo=0\tIndex=0\tType=9\tmajorVer=5\tminorVer=622\tFormat=0\tSize=${
        photoBuffer.length
      }\tValid=1\tTMP=${photo}`,
    ];

    // Store commands in database
    const stmt = db.prepare("INSERT INTO commands (command) VALUES (?)");
    for (const cmd of commands) {
      stmt.run([cmd], (err) => {
        // Wrap cmd in an array
        if (err) {
          console.error("Error inserting command:", err);
        } else {
          console.log("Command inserted:", "insearted");
        }
      });
    }
    stmt.finalize();

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.status(200).json({
      message: "User registration queued successfully",
      commands: commands.length,
    });
  } catch (error) {
    console.error("Error processing registration:", error);
    res.status(500).json({ error: "Failed to process registration" });
  }
});

app.post("/api/add-command", express.json(), (req, res) => {
  const { command } = req.body;

  if (!command) {
    return res.status(400).json({ error: "Command is required" });
  }

  const query = "INSERT INTO commands (command) VALUES (?)";
  db.run(query, [command], function (err) {
    if (err) {
      console.error("Error inserting command:", err);
      return res.status(500).json({ error: "Failed to insert command" });
    } else {
      console.log("Command inserted:", command);
      return res.status(201).json({
        message: "Command added successfully",
        commandId: this.lastID,
      });
    }
  });
});

const PORT = 3000;

app.listen(PORT, () => {
  logger(`Server is running on http://localhost:${PORT}`);
});

process.on("SIGINT", () => {
  db.close((err) => {
    if (err) {
      console.error("Error closing database:", err.message);
    } else {
      console.log("Database connection closed.");
    }
    process.exit(0);
  });
});
