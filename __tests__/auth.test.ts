jest.setTimeout(60000); // Set timeout to 60 seconds

import request from 'supertest';
import { app } from '../src/index'; // Assuming the Express app is exported from index.ts
import { userModel } from '../src/services/database';
import mongoose from "mongoose"; // Import mongoose

describe('Authentication Tests', () => {
  beforeAll(async () => {
    console.log("Clearing database...");

    // Clear the database before running tests
    await userModel.deleteMany({});
  });

  afterAll(async () => {
    console.log("Cleaning up database and closing connection...");

    // Clean up the database
    await userModel.deleteMany({});
    
    // Close the Mongoose connection
    await mongoose.connection.close();
  });

  describe('Register Functionality', () => {
    it('should register a new user successfully', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          username: 'testuser',
          password: 'password123',
          email: 'testuser@example.com',
          phone: '1234345654345690',
        });

      expect(response.status).toBe(201); // 201 Created for successful registration
      expect(response.body.message).toContain("Registration successful");
    });
  });
  
// describe('Register Functionality - Additional Tests', () => {
//   it('should return 400 if required fields are missing', async () => {
//     const response = await request(app)
//       .post('/auth/register')
//       .send({
//         username: 'testuser',
//         email: 'testuser@example.com',
//       }); // Missing password and phone

//     expect(response.status).toBe(400);
//     expect(response.body.message).toContain("Missing required fields");
//   });

//   it('should return 400 if username, email, or phone already exists', async () => {
//     // Create a user first
//     await userModel.create({
//       username: 'duplicateuser',
//       password: await bcrypt.hash('password123', 10),
//       email: 'duplicate@example.com',
//       phone: '1234567890',
//       role: 'user',
//     });

//     const response = await request(app)
//       .post('/auth/register')
//       .send({
//         username: 'duplicateuser',
//         password: 'password123',
//         email: 'duplicate@example.com',
//         phone: '1234567890',
//       });

//     expect(response.status).toBe(400);
//     expect(response.body.message).toContain("User with the provided username, email, or phone already exists");
//   });

//   it('should return 201 for successful registration with different valid inputs', async () => {
//     const response = await request(app)
//       .post('/auth/register')
//       .send({
//         username: 'newuser',
//         password: 'securepassword',
//         email: 'newuser@example.com',
//         phone: '9876543210',
//       });

//     expect(response.status).toBe(201);
//     expect(response.body.message).toContain("Registration successful");
//   });

//   it('should handle internal server errors gracefully', async () => {
//     jest.spyOn(userModel.prototype, 'save').mockImplementationOnce(() => {
//       throw new Error('Database error');
//     });

//     const response = await request(app)
//       .post('/auth/register')
//       .send({
//         username: 'erroruser',
//         password: 'password123',
//         email: 'erroruser@example.com',
//         phone: '1234567890',
//       });

//     expect(response.status).toBe(500);
//     expect(response.body.message).toContain("Internal error");
//   });
// });
});