const express = require("express");
const moment = require("moment");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const multer = require("multer");
const fs = require("fs");
const { randomUUID } = require("crypto");
const sharp = require("sharp");

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

db.run(`
  CREATE TABLE IF NOT EXISTS KeyValueStore (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);

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

db.run(
  `CREATE TABLE IF NOT EXISTS Devices (
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

function setKeyValue(key, value) {
  const serializedValue = JSON.stringify(value); // Convert to JSON string
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO KeyValueStore (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, serializedValue],
      function (err) {
        if (err) reject(err);
        else resolve("Key-Value pair set successfully.");
      }
    );
  });
}

function getValueByKey(key) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT value FROM KeyValueStore WHERE key = ?`,
      [key],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? JSON.parse(row.value) : null); // Convert back from JSON
      }
    );
  });
}

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
app.get("/users", async (req, res) => {
  deviceCommandQueue["123"] = "123";
  console.log(deviceCommandQueue);

  const query = `SELECT * FROM users`;
  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(200).json(rows);
    }
  });
});

app.get("/iclock/cdata", async (req, res) => {
  const now = new Date();

  try {
    logger("cdata endpoint hit");

    // Extract and validate the SN parameter
    // console.log(req.query);
    // console.log(req.headers);
    const { SN } = req.query;

    if (!SN || typeof SN !== "string") {
      logger("SN query parameter missing or invalid");
      return res
        .status(400)
        .send("Bad Request: SN is required and must be a string");
    }

    console.log(SN);
    const existsdevice = await getValueByKey(SN);
    if (!existsdevice) {
      setKeyValue(SN, {
        commands: [],
      });
    }

    // Create the response body (use \n for line breaks)
    const body = `GET OPTION FROM:${SN}\nATTLOGStamp=None\nOPERLOGStamp=9999\nATTPHOTOStamp=None\nErrorDelay=30\nDelay=10\nTransTimes=00:00;14:05\nTransInterval=1\nTransFlag=TransData AttLog OpLog AttPhoto EnrollUser ChgUser EnrollFP\nChgFP UserPic\nTimeZone=8\nRealtime=1\nEncrypt=0`;

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

function storeCommands(commands, callback) {
  const stmt = db.prepare("INSERT INTO commands (command) VALUES (?)");
  const ids = [];

  for (const cmd of commands) {
    stmt.run([cmd], function (err) {
      if (err) {
        console.error("Error inserting command:", err);
        callback(err, null);
        return;
      }
      ids.push(this.lastID); // Collect the ID of the inserted command

      // Check if all commands have been processed
      if (ids.length === commands.length) {
        callback(null, ids);
      }
    });
  }
  stmt.finalize();
}
app.get("/command/:id", (req, res) => {
  const { id } = req.params;
  db.get("SELECT * FROM commands WHERE id = ?", [id], (err, row) => {
    if (err) {
      console.error("Error fetching command:", err);
      res.status(500).send("Internal Server Error");
    } else if (!row) {
      res.status(404).send("Command not found");
    } else {
      res.json(row);
    }
  });
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

app.get("/iclock/getrequest", async (req, res) => {
  logger("getrequest endpoint hit");
  const { SN } = req.query;
  console.log(SN);

  // Get next unexecuted command
  // db.get(
  //   "SELECT id, command FROM commands WHERE executed = 0 ORDER BY created_at ASC LIMIT 1",
  //   [],
  //   (err, row) => {
  //     if (err) {
  //       console.error("Database error:", err);
  //       return res.status(500).send("Error");
  //     }

  //     if (!row) {
  //       // No more commands, send OK
  //       return res.status(200).send("OK");
  //     }

  //     // Mark command as executed
  //     db.run(
  //       "UPDATE commands SET executed = 1 WHERE id = ?",
  //       [row.id],
  //       (updateErr) => {
  //         if (updateErr) {
  //           console.error("Error updating command status:", updateErr);
  //         }
  //       }
  //     );

  //     res.set({
  //       "Content-Type": "text/plain",
  //       Pragma: "no-cache",
  //       Connection: "close",
  //       "Cache-Control": "no-store",
  //       Date: convertToGMT(new Date()),
  //       Server: "nginx/1.6.0",
  //     });
  //     // console.log("This is command", row.command);

  //     return res.status(200).send(row.command);
  //   }
  // );
  const command = await getValueByKey("commands");
  let commandtobeexecuted;
  const currentDevice = await getValueByKey(SN);

  if (
    command &&
    Array.isArray(command) &&
    Array.isArray(currentDevice.commands)
  ) {
    // Deduplicate both command and currentDevice.commands
    const uniqueCommands = [...new Set(command)];
    const executedCommands = new Set(currentDevice.commands);

    // Find commands that are not yet executed
    const nonExecutedCommands = uniqueCommands.filter(
      (cmd) => !executedCommands.has(cmd)
    );

    if (nonExecutedCommands.length > 0) {
      commandtobeexecuted = nonExecutedCommands[0];

      // Update currentDevice.commands with unique values only
      const updatedCommands = [
        ...new Set([...currentDevice.commands, commandtobeexecuted]),
      ];
      await setKeyValue(SN, { commands: updatedCommands });
    }
  }
  // console.log(commandtobeexecuted);

  res.set({
    "Content-Type": "text/plain",
    Pragma: "no-cache",
    Connection: "close",
    "Cache-Control": "no-store",
    Date: convertToGMT(new Date()),
    Server: "nginx/1.6.0",
  });
  return res.status(200).send(commandtobeexecuted);
});

// POST endpoint for iclock/cdata
app.post("/iclock/cdata", (req, res) => {
  logger("POST cdata endpoint hit");
  // console.log("Request body:", req.query);
  // console.log("request Headers for post iclock", req.headers);

  // Always respond with OK
  res.status(200).send("OK");
});

// Endpoint to handle device command results
app.post("/iclock/devicecmd", async (req, res) => {
  logger("devicecmd endpoint hit");
  res.set({
    Date: convertToGMT(new Date()),
    "Content-Length": 2,
  });

  try {
    console.log("Entered the try block");

    // Wrap the data and end events in a Promise to properly await them
    const body = await new Promise((resolve, reject) => {
      let body = [];

      req.on("data", (chunk) => {
        body.push(chunk);
      });

      req.on("end", () => {
        try {
          body = Buffer.concat(body).toString(); // Convert to string if text-based
          console.log(body); // Log raw body
          resolve(body); // Resolve the Promise when done
        } catch (error) {
          reject(error); // Reject if there's an error processing the body
        }
      });

      req.on("error", (err) => {
        reject(err); // Reject if there's an error with the request
      });
    });

    // Optional: Perform operations with body here if needed.
    console.log("Processed body:", body);

    // Send response after processing
    res.status(200).send("OK");
  } catch (error) {
    console.error("Error in request handling:", error);
    res.status(500).send("Error processing request");
  }
});

app.post("/api/delete-user/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const commands = [`c:122:DATA DELETE USER PIN=${id}`];

    storeCommands(commands, (err, ids) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Error inserting commands", error: err });
      }

      res.status(200).json({
        message: "User Deleted Successfully",
        commands: commands.length,
        databaseId: ids, // Return all inserted IDs
        UserId: id,
      });
    });
    // const query = `DELETE FROM users WHERE id = ?`;
    // db.run(query, [id], (err) => {
    //   if (err) {
    //     console.error("Error deleting user:", err);
    //     return res.status(500).json({ error: "Failed to delete user" });
    //   }

    //   res.status(200).json({ message: "User deleted successfully" });
    // });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// API to queue new user registration with face
app.post("/api/register-user", upload.single("photo"), async (req, res) => {
  const { name, userPin } = req.body;

  if (!req.file || !name || !userPin) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // Process and optimize the photo using sharp with JPG format
    const optimizedPhotoPath = path.join(
      uploadDir,
      `optimized-${req.file.filename}`
    );
    await sharp(req.file.path)
      .resize(300, 300)
      .toFormat("jpg") // Explicitly set output format to JPEG
      .jpeg({
        quality: 70,
        chromaSubsampling: "4:4:4", // Maintain color quality
      })
      .toFile(optimizedPhotoPath);

    // Convert optimized photo to Base64
    const photoBuffer = fs.readFileSync(optimizedPhotoPath);
    const photoBase64 = photoBuffer.toString("base64");

    // Clean up both original and optimized uploaded files

    fs.unlinkSync(req.file.path);
    fs.unlinkSync(optimizedPhotoPath);

    const commands = [
      `C:223123:DATA USER PIN=${userPin}\tName=${name}`,
      `C:333123:DATA UPDATE BIOPHOTO PIN=${userPin}\tFID=1\tNo=0\tIndex=0\tType=2\tFormat=0\tSize=${photoBuffer.length}\tContent=${photoBase64}`,
      // `C:213:CLEAR DATA `,
    ];

    const allcommands = await getValueByKey("commands");
    console.log("This is allcommands", allcommands);

    if (!allcommands) {
      setKeyValue("commands", commands);
    } else {
      setKeyValue("commands", [...allcommands, ...commands]);
    }
    res.status(200).json({
      message: "Commands queued successfully",
      commands: commands.length,
      // ids: ids, // Return all inserted IDs
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
