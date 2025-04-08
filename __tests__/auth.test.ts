import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';           
import { app } from '../src/services/express_app';
import mongoose from "mongoose";
import { MongoMemoryServer } from 'mongodb-memory-server';
import http from 'http';

// Mocking logger to prevent console output during tests
jest.mock('../src/services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

let mongoServer: MongoMemoryServer;
let dbUri: string;
let server: http.Server;
let baseURL: string;

let axiosInstance: any; // Declare axiosInstance globally

const cookieJar = new CookieJar();

beforeAll(async () => {
  // Setup in-memory MongoDB server
  if (mongoose.connection.readyState !== 1) {
    mongoServer = await MongoMemoryServer.create();
    dbUri = mongoServer.getUri();
    await mongoose.connect(dbUri);
  }

  server = app.listen(0); // Start server on a random available port
  const port = (server.address() as any).port;
  baseURL = `http://localhost:${port}`;

  // Create axiosInstance after baseURL is set
  const instance = axios.create({
    baseURL,
    withCredentials: true,
    jar: cookieJar, // <- MUST be here
  });

  axiosInstance = wrapper(instance); // <- wrap it to enable cookie tracking
});

// Clean up after tests
afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
  if (server) {
    server.close();
  }
  axiosInstance = null; // Clear axiosInstance after tests
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
      const response = await axios.post(`${baseURL}/auth/register`, {
        username: 'testuser',
        password: 'password123',
        email: 'testuser@example.com',
        phone: '1234345654345690',
      });

      expect(response.status).toBe(201); 
      expect(response.data.message).toContain("Registration successful");
      expect(response.data.username).toBe('testuser'); // Ensure the username is returned correctly
    });

    it('should detect duplicate registration and return an error', async () => {
      await axios.post(`${baseURL}/auth/register`, {
        username: 'jesmineting',
        password: 'jesmine123',
        email: 'jesmine@example.com',
        phone: '8221139',
      });

      try {
        await axios.post(`${baseURL}/auth/register`, {
          username: 'jesmineting',
          password: 'jesmine123',
          email: 'jesmine@example.com',
          phone: '8221139',
        });
      } catch (error: any) {
        expect(error.response.status).toBe(400);
        expect(error.response.data.message).toContain("User already exists");
      }
    });

    it('should register a user with non-English characters in username and email', async () => {
      const response = await axios.post(`${baseURL}/auth/register`, {
        username: '测试用户', 
        password: 'password123',
        email: '测试用户@example.com',
        phone: '1234345654345690',
      });

      expect(response.status).toBe(201);
      expect(response.data.message).toContain("Registration successful");
      expect(response.data.username).toBe('测试用户'); // Ensure the username is returned correctly
    });
  });

  describe('Login Functionality', () => {
    it('should fail to log in a user who is not registered', async () => {
      try {
        await axios.post(`${baseURL}/auth/login`, {
          username: 'unregistereduser',
          password: 'password123',
        });
      } catch (error: any) {
        expect(error.response.status).toBe(401);
        expect(error.response.data.message).toContain("Invalid username or password.");
      }
    });

    it('should register and log in successfully', async () => {
      // Step 1: Register the user
      const registerResponse = await axiosInstance.post('/auth/register', {
        username: 'testuser',
        password: 'password123',
        email: 'testuser@example.com',
        phone: '1234567890',
      });
    
      expect(registerResponse.status).toBe(201); 
      expect(registerResponse.data.message).toContain("Registration successful");
      expect(registerResponse.data.username).toBe('testuser'); 
    
      // Step 2: Log in with the registered user
      const loginResponse = await axiosInstance.post('/auth/login', {
        username: 'testuser',
        password: 'password123',
      });
    
      expect(loginResponse.status).toBe(200); // Ensure login was successful
      expect(loginResponse.data.login).toBe(true);
      expect(loginResponse.data.username).toBe('testuser');
      expect(loginResponse.data.message).toContain("Login successful.");
    });
  });
  
  describe('Logout Functionality', () => {
    it('should fail to log out when no session is found', async () => {
      try {
        // Attempt to log out without being logged in
        await axiosInstance.post('/auth/logout');
      } catch (error: any) {
        // Ensure the response status is 401 (Unauthorized)
        expect(error.response.status).toBe(401);
        // Ensure the error message matches the expected output
        expect(error.response.data.message).toContain("User not logged in");
      }
    }, 10000);
  });
});