# ZKTeco API Server

A Node.js server that manages communication with ZKTeco biometric devices for user registration and face recognition.

## Prerequisites

- Node.js v14 or higher
- NPM package manager
- The following npm packages:
  - express
  - moment
  - sqlite3
  - multer
  - sharp
  - cors

## Installation

1. Clone the repository
2. Install dependencies:
```sh
npm install
```

## Project Setup

1. Create required directories:
```sh
mkdir uploads
```

2. The server will automatically:
- Create SQLite database file (database.sqlite)
- Initialize required tables
- Set up upload directory for temporary files

## Required Database Tables

The server automatically creates these tables:
- KeyValueStore: Stores device commands and user data
- Users: Stores user information
- Commands: Stores pending device commands
- Devices: Stores device information

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

## Notes

- Photo uploads are automatically optimized using Sharp
- Face photos are resized to 300x300 pixels
- All uploads are temporarily stored and automatically cleaned up
- The server implements a command queue system for device operations
- CORS is enabled for all origins by default