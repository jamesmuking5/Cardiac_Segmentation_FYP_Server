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
    });
  });

});