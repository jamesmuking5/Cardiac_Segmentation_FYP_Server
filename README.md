## Overview

VisHeart is a Node.js + Express.js backend server designed to support cardiac segmentation for NIFTI and DICOM medical imaging formats. This project serves as the backend infrastructure for cardiac segmentation analysis, providing user authentication, file management, and segmentation processing capabilities.

## Current Features

- **User Management System**
  - User registration and authentication
  - Role-based access control (user/admin)
  - Secure password storage with bcrypt

- **Database Integration**
  - MongoDB connection with Mongoose ODM
  - User data schema and persistence
  - File metadata storage schema

- **Logging System**
  - Advanced Winston logging with daily rotation
  - Separate log files for errors, warnings, and general information
  - Colorized console output for better readability

- **Development Environment**
  - TypeScript configuration
  - Unit testing with Jest
  - In-memory MongoDB server for testing

## Project Structure

```
├── __tests__/                # Test files
├── logs/                     # Application logs
│   └── winston_logger/       # Winston rotating logs
├── src/                      # Source code
│   ├── index.ts              # Main application entry point
│   └── services/             # Service modules
│       ├── database.ts       # Database connection and operations
│       └── logger.ts         # Logging service
├── dist/                     # Compiled JavaScript (generated)
├── .env                      # Environment variables (not tracked in git)
├── jest.config.js            # Jest testing configuration
├── package.json              # Dependencies and scripts
└── tsconfig.json             # TypeScript configuration
```

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/jamesmuking5/Cardiac_Segmentation_FYP_Server.git
   cd Cardiac_Segmentation_FYP_Server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a .env file in the root directory with the following variables:
   ```
   PORT=3000
   MONGODB_URI=mongodb://127.0.0.1:27017/visheart
   ADMIN_PASS=securepassword
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

## Usage

### Development

- Start the development server with hot-reloading:
  ```bash
  npm run dev
  ```

### Testing

- Run the test suite:
  ```bash
  npm test
  ```

### Production

- Build the project:
  ```bash
  npm run build
  ```

- Start the production server:
  ```bash
  npm start
  ```

## Planned Features

### Short-term Roadmap

1. **File Upload System**
   - NIFTI and DICOM file upload endpoints
   - File validation and integrity checking
   - Secure storage options

2. **API Endpoints**
   - RESTful API for user management
   - File management endpoints (upload, download, metadata)
   - Authentication and authorization middleware

3. **Segmentation Processing**
   - Integration with segmentation algorithms
   - Job queue for processing tasks
   - Result storage and retrieval

### Long-term Roadmap

1. **Advanced Segmentation Features**
   - Multiple segmentation algorithms support
   - Segmentation comparison tools
   - Batch processing capabilities

2. **Analytics Dashboard**
   - Usage statistics
   - Processing time metrics
   - User activity tracking

3. **Enhanced Security**
   - OAuth integration
   - API key management
   - Rate limiting

4. **Scalability Improvements**
   - Containerization with Docker
   - Kubernetes deployment options
   - Cloud storage integration

## Technical Details

### Database Schema

The server currently implements two main schemas:

1. **User Schema**
   - Username, password (hashed), email, phone, and role
   - Unique constraints on username, email, and phone
   - Role-based permissions (user/admin)

2. **File Schema**
   - Filename, filepath, filetype (MIME type)
   - File hash and size for integrity and validation
   - Creation metadata (date, user)

### Authentication

- Password hashing using bcrypt
- Default admin account creation on first run
- Token-based authentication (planned)

### Logging

- Daily rotating log files based off `winston` library
- Separate files for errors, warnings, and general information
- Colorized console output for development

## License

This project is licensed under the MIT License - see the LICENSE file for details.

Similar code found with 2 license types