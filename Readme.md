# ZKTeco API Server

A Node.js server that manages communication with ZKTeco biometric devices for user registration and face recognition.

## System Requirements

- Node.js v18 or higher
- Linux/Ubuntu system packages:
  ```sh
  sudo apt-get update
  sudo apt-get install -y python build-essential node-gyp sqlite3 libsqlite3-dev
  ```

## Prerequisites

- Node.js v18.20.4 or higher
- NPM package manager
- Required system libraries for SQLite3
- The following npm packages:
  - express: ^4.18.2
  - moment: ^2.30.1
  - sqlite3: ^5.1.7
  - multer: ^1.4.5-lts.1
  - sharp: ^0.32.6
  - cors: ^2.8.5

## Installation

1. Clone the repository:

```sh
git clone <repository-url>
cd zkteco
```

2. Install system dependencies:

```sh
sudo apt-get update
sudo apt-get install -y python build-essential node-gyp sqlite3 libsqlite3-dev
```

3. Install Node.js dependencies:

```sh
npm install
```

If you encounter SQLite3 issues:

```sh
# Clean existing installations
rm -rf node_modules package-lock.json
npm cache clean --force

# Rebuild SQLite3
npm install sqlite3 --build-from-source
```

## Project Setup

The server will automatically:

- Create SQLite database file (database.sqlite)
- Initialize required tables
- Set up upload directory for temporary files

## Database Schema

The server automatically creates these tables:

- **KeyValueStore**:

  - key (TEXT PRIMARY KEY)
  - value (TEXT)
  - userpin (INTEGER)
  - date_created (TEXT)

- **Users**:

  - id (INTEGER PRIMARY KEY)
  - name (TEXT)
  - email (TEXT UNIQUE)
  - photo (TEXT)

- **Commands**:

  - id (INTEGER PRIMARY KEY)
  - command (TEXT)
  - executed (BOOLEAN)
  - created_at (DATETIME)

- **Devices**:
  - id (INTEGER PRIMARY KEY)
  - command (TEXT)
  - executed (BOOLEAN)
  - created_at (DATETIME)

## Running the Server

```sh
node server.js
```

The server will start on port 3000 by default.

## API Endpoints

### Device Communication

- `GET /iclock/cdata` - Device initialization and options
- `POST /iclock/cdata` - Process device data
- `GET /iclock/getrequest` - Handle command queue requests
- `POST /iclock/devicecmd` - Process command results

### User Management

- `POST /api/register-user` - Register new user with face photo
  - Required fields: name, userPin
  - Optional: photo (file) or base64 (string)
- `POST /api/delete-user/:id` - Delete user by ID
- `GET /users` - Get all users

### Command Management

- `POST /api/add-command` - Add new command
- `GET /command/:id` - Get command status

## Technical Notes

- Photo Processing:

  - Uploads are automatically optimized using Sharp
  - Face photos are resized to 300x300 pixels
  - JPG format with 70% quality and 4:4:4 chroma subsampling
  - Temporary files are automatically cleaned up

- Security:

  - CORS is enabled for all origins by default
  - Supports credentials in requests
  - Allows GET, HEAD, PUT, PATCH, POST, and DELETE methods

- Data Management:
  - Implements command queue system for device operations
  - Automatic cleanup of old records
  - Base64 encoding for photo storage

## Error Handling

If you encounter SQLite3 related errors:

1. Ensure all system dependencies are installed
2. Try rebuilding the SQLite3 module
3. Check database file permissions
4. Verify Node.js version compatibility

## Development

For development with auto-reload:

```sh
npm run dev
```
