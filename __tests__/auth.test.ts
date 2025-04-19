import request from 'supertest';
import { app } from '../src/services/express_app'; // Decoupled app from index.ts permanently
import { userModel } from '../src/services/database';
import mongoose from "mongoose";
import { MongoMemoryServer } from 'mongodb-memory-server';

// Mocking logger to prevent console output during tests
jest.mock('../src/services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

let mongoServer: MongoMemoryServer;
let dbUri: string;

// Setup in-memory MongoDB server
beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) {
    mongoServer = await MongoMemoryServer.create();
    dbUri = mongoServer.getUri();
    await mongoose.connect(dbUri);
  }
});

// Clean up after tests
afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

// Clear data between tests for all describe blocks
beforeEach(async () => {
  // Clear all collections more reliably
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

describe('Authentication Tests', () => {
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
      expect(response.body.username).toBe('testuser'); // Ensure the username is returned correctly
    });

    it('should detect duplicate registration and return an error', async () => {
      await request(app)
        .post('/auth/register')
        .send({
          username: 'jesmineting',
          password: 'jesmine123',
          email: 'jesmine@example.com',
          phone: '8221139',
        });

      const response = await request(app)
        .post('/auth/register')
        .send({
          username: 'jesmineting',
          password: 'jesmine123',
          email: 'jesmine@example.com',
          phone: '8221139',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain("User already exists");
    });

    it('should register a user with non-English characters in username and email', async () => {
      const response = await request(app)
        .post('/auth/register')
        .send({
          username: '测试用户', // Non-English username
          password: 'password123',
          email: '测试用户@example.com', // Non-English email
          phone: '1234345654345690',
        });
    
      expect(response.status).toBe(201); // Expect successful registration
      expect(response.body.message).toContain("Registration successful");
      expect(response.body.username).toBe('测试用户'); // Ensure the username is returned correctly
    });
  });


  describe('Login Functionality', () => {
    it('should fail to log in a user who is not registered', async () => {
      const response = await request(app)
        .post('/auth/login')
        .send({
          username: 'unregistereduser',
          password: 'password123',
        });
      
      console.log(response.body);
      expect(response.status).toBe(401); // 401 Unauthorized for invalid login
      expect(response.body.message).toContain("Invalid username or password.");
    });

    it('should log in a user successfully after registration', async () => {
      // Step 1: Register the user
      const registerResponse = await request(app)
        .post('/auth/register')
        .send({
          username: 'registereduser',
          password: 'password123',
          email: 'registereduser@example.com',
          phone: '1234567890',
        });
    
      expect(registerResponse.status).toBe(201); // Ensure registration was successful
      expect(registerResponse.body.message).toContain("Registration successful");
    
      // Step 2: Log in with the registered user
      const loginResponse = await request(app)
        .post('/auth/login')
        .send({
          username: 'registereduser',
          password: 'password123',
        });
    
      expect(loginResponse.status).toBe(200); // Ensure login was successful
      expect(loginResponse.body.login).toBe(true); // Check login success flag
      expect(loginResponse.body.username).toBe('registereduser'); // Ensure the correct username is returned
      expect(loginResponse.body.message).toContain("Login successful.");
    });
  });
});